import {
  type Buckets,
  type Cell,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type Clock,
  cellKeyString,
  type IsoDate,
  mergeWithinProvider,
  type NoDataReason,
  type ProviderId,
  type RollUp,
  type SelectionReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import {
  OUTCOME_STATUSES,
  PROVIDER_IDS,
  SELECTION_REASONS,
  SKIP_REASONS,
  STAGES,
  TERMINAL_STATUSES,
} from '../internal/enums.js';
import {
  CELL_KEY_SQL,
  CELL_WHERE,
  type CellKeyDbRow,
  keyParams,
  type OutcomeDbRow,
  toCellKey,
  toOutcome,
} from '../internal/outcomeRow.js';
import { insertCalendarPrice, validateCalendarPrice } from '../internal/priceRow.js';
import { nullableOneOf, oneOf, readDate } from '../internal/read.js';
import { storeRollUps } from '../internal/rollUps.js';
import { assertErrorReason, assertInt, RowRejected } from '../internal/validate.js';
import type { CalendarPriceInsert, RepoOptions, TileWrite } from '../types.js';

interface CellDbRow {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  discovery_status: string | null;
  discovery_reason: string | null;
  discovery_min_pence: number | null;
  verification_status: string | null;
  verification_reason: string | null;
  verification_min_pence: number | null;
}
interface BucketRow {
  priced: number;
  empty: number;
  no_data: number;
  error: number;
  skipped: number;
  not_run: number;
  reused: number;
  total: number;
}
const BUCKET_COLUMNS = `COALESCE(SUM(status = 'priced'), 0) AS priced, COALESCE(SUM(status = 'empty'), 0) AS empty, COALESCE(SUM(status = 'no_data'), 0) AS no_data,
  COALESCE(SUM(status = 'error'), 0) AS error, COALESCE(SUM(status = 'skipped'), 0) AS skipped, COALESCE(SUM(status = 'not_run'), 0) AS not_run,
  COALESCE(SUM(reused_from_execution_id IS NOT NULL), 0) AS reused, COUNT(*) AS total`;
const toBuckets = (r: BucketRow | undefined): Buckets => ({
  priced: r?.priced ?? 0,
  empty: r?.empty ?? 0,
  no_data: r?.no_data ?? 0,
  error: r?.error ?? 0,
  skipped: r?.skipped ?? 0,
  not_run: r?.not_run ?? 0,
  reused: r?.reused ?? 0,
});
const isTerminal = (s: CellOutcomeStatus) => TERMINAL_STATUSES.some((t) => t === s);
/** Fields `setOutcome` may carry (ruling 4); identity fields are ignored, every other data field is refused. */
const DATA_FIELDS = [
  'lastError',
  'fetchedAt',
  'minPence',
  'cabin',
  'pointOfSale',
  'sourceKind',
  'reusedFromExecutionId',
] as const satisfies ReadonlyArray<keyof CellOutcome>;
const CLEARED =
  'fetched_at = NULL, min_pence = NULL, cabin = NULL, point_of_sale = NULL, source_kind = NULL, reused_from_execution_id = NULL';

/** A non-terminal target and its reason, per spec §3 (ruling 4, prov-009). */
function assertNonTerminalTarget(status: CellOutcomeStatus, reason: string | null): void {
  if (isTerminal(status))
    throw new RowRejected(
      'terminal-outcome',
      `${status} is written only by writeTile, writeVerifiedCell, copyReused or markNoData`,
    );
  if (status === 'skipped' && (reason === null || !SKIP_REASONS.some((r) => r === reason)))
    throw new RowRejected(
      'skip-reason',
      `a skipped outcome needs a skip reason (spec §3), got ${String(reason)}`,
    );
  if (status === 'error') assertErrorReason(reason);
  // why: spec §3 reason never holds a vendor message; not_run carries none (prov-r3-003).
  if (status === 'not_run' && reason !== null)
    throw new RowRejected('outcome-reason', `a not_run outcome carries no reason, got ${reason}`);
}

type Incoming = TileWrite['outcomes'][number];
const SELECT_OUTCOME_SQL = `SELECT * FROM cell_outcomes WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`;
const UPDATE_OUTCOME_SQL = `
UPDATE cell_outcomes SET status = @status, reason = @reason, last_error = @lastError, fetched_at = @fetchedAt, min_pence = @minPence,
  cabin = @cabin, point_of_sale = @pointOfSale, source_kind = @sourceKind, attempts = @attempts, reused_from_execution_id = @reusedFromExecutionId
WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`;
const DELETE_REUSED_PRICE_SQL = `DELETE FROM calendar_prices WHERE ${CELL_WHERE} AND provider_id = @providerId AND reused_from_execution_id IS NOT NULL`;
const TILE_STATUSES = ['priced', 'empty', 'no_data'] as const;

/**
 * The outcome to store when `incoming` (fresh) meets `existing` (ruling 3, spec §6.6). Over not_run, skipped or a reused
 * copy the fresh outcome replaces the row (an error never does: it only counts an attempt); fresh on fresh goes through
 * core's mergeWithinProvider. Attempts are the existing count plus one when this pass failed.
 */
function nextOutcome(existing: CellOutcome, incoming: CellOutcome, failedPass: boolean): CellOutcome {
  const attempts = existing.attempts + (failedPass ? 1 : 0);
  if (existing.status === 'not_run' || existing.status === 'skipped') return { ...incoming, attempts };
  // why: an error never displaces a stronger result, reused or fresh (plan merge rule, prov-r2-003): the existing outcome
  // stays, with its reused price row, and only the attempt is counted. Decided here so it does not hang on core's reading.
  if (incoming.status === 'error' && existing.status !== 'error') return { ...existing, attempts };
  if (existing.reusedFromExecutionId !== null) return { ...incoming, attempts };
  const merged = mergeWithinProvider(existing, incoming);
  // why: when the merge keeps an error, the newest vendor message is the useful one; status, reason and minPence stay core's.
  return {
    ...merged,
    attempts,
    lastError:
      merged.status === 'error' && incoming.status === 'error' ? incoming.lastError : merged.lastError,
  };
}

function storeOutcome(db: Db, o: CellOutcome): void {
  db.raw.prepare(UPDATE_OUTCOME_SQL).run({
    ...keyParams(o.executionId, o),
    stage: o.stage,
    providerId: o.providerId,
    status: o.status,
    reason: o.reason,
    lastError: o.lastError === null ? null : stripUrlsInText(o.lastError),
    fetchedAt: o.fetchedAt,
    minPence: o.minPence,
    cabin: o.cabin,
    pointOfSale: o.pointOfSale,
    sourceKind: o.sourceKind,
    attempts: o.attempts,
    reusedFromExecutionId: o.reusedFromExecutionId,
  });
}

/**
 * Spec §3: `reason` never holds a vendor message (prov-r2-004). A fetched outcome's reason is closed per status:
 * priced → null | 'partial-expansion', empty → null, no_data → null | 'cabin-not-offered'.
 */
function assertOutcomeReason(o: { status: CellOutcomeStatus; reason: string | null } & CellKey): void {
  const allowed: Partial<Record<CellOutcomeStatus, ReadonlyArray<string | null>>> = {
    priced: [null, 'partial-expansion'],
    empty: [null],
    no_data: [null, 'cabin-not-offered'],
  };
  if (!(allowed[o.status] ?? []).includes(o.reason))
    throw new RowRejected(
      'outcome-reason',
      `${cellKeyString(o)} ${o.status} cannot carry reason ${String(o.reason)}`,
    );
}

/** Ruling 5: a fetched terminal outcome carries the provenance reuse matches on. */
function assertOutcomeProvenance(o: Incoming): void {
  if (o.fetchedAt === null || o.cabin === null || o.pointOfSale === null || o.sourceKind === null)
    throw new RowRejected(
      'outcome-provenance',
      `${cellKeyString(o)} ${o.status} needs fetchedAt, cabin, pointOfSale and sourceKind`,
    );
}

/** Spec §7 "Resume": reasons never retried automatically; a manual resume re-admits auth, quota, parse. */
const NON_RETRYABLE = [
  'auth',
  'quota',
  'parse',
  'no-return-legs',
  'fx-unavailable',
  'currency-unsupported',
  'unknown-airport-tz',
] as const;
const MANUAL_RETRYABLE = ['auth', 'quota', 'parse'] as const;
const sqlList = (xs: readonly string[]) => xs.map((r) => `'${r}'`).join(', ');

/**
 * Spec §7 resume selection for one (stage, provider). `skipped:budget` is returned; the engine keeps it only when
 * headroom exists (WP7). `priced | empty | no_data` are never returned.
 */
export const RESUMABLE_SQL = `
SELECT origin, destination, departure_date, return_date FROM cell_outcomes
WHERE execution_id = @executionId AND stage = @stage AND provider_id = @providerId AND (
  status = 'not_run'
  OR (status = 'error' AND attempts < 3 AND (reason IS NULL OR reason NOT IN (${sqlList(NON_RETRYABLE)})))
  OR (status = 'skipped' AND reason = 'budget')
  OR (@manual = 1 AND ((status = 'skipped' AND reason = 'provider_disabled') OR (status = 'error' AND reason IN (${sqlList(MANUAL_RETRYABLE)}))))
)
ORDER BY origin, destination, departure_date, return_date`;

/**
 * Spec §7 `search_cells` + `cell_outcomes` and the stored roll-ups. Every method that changes an outcome stores the
 * affected roll-ups, computed by core's `rollUp`, in the same transaction.
 */
export class CellsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: RepoOptions,
  ) {}

  /** Spec §7 atomic unit "seeding search_cells + discovery cell_outcomes at start". */
  seed(executionId: string, cells: Cell[], discoveryProviders: ProviderId[]): void {
    const insertCell = this.db.raw.prepare(
      `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date, discovery_status, verification_selected) VALUES (@executionId, @origin, @destination, @departureDate, @returnDate, @status, 0)`,
    );
    const insertOutcome = this.db.raw.prepare(
      `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, attempts) VALUES (@executionId, @origin, @destination, @departureDate, @returnDate, 'discovery', @providerId, 'not_run', 0)`,
    );
    const status = discoveryProviders.length > 0 ? 'not_run' : null;
    this.db.transaction(() => {
      for (const c of cells) {
        insertCell.run({ ...keyParams(executionId, c), status });
        for (const providerId of discoveryProviders)
          insertOutcome.run({ ...keyParams(executionId, c), providerId });
      }
    });
  }

  outcomes(
    executionId: string,
    filter: { stage?: Stage; providerId?: ProviderId; cells?: CellKey[] } = {},
  ): CellOutcome[] {
    return this.db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow>(
        `SELECT * FROM cell_outcomes WHERE execution_id = @executionId AND (@stage IS NULL OR stage = @stage) AND (@providerId IS NULL OR provider_id = @providerId)
           AND (@keys IS NULL OR ${CELL_KEY_SQL} IN (SELECT value FROM json_each(@keys)))
         ORDER BY origin, destination, departure_date, return_date, stage, provider_id`,
      )
      .all({
        executionId,
        stage: filter.stage ?? null,
        providerId: filter.providerId ?? null,
        keys: filter.cells === undefined ? null : JSON.stringify(filter.cells.map(cellKeyString)),
      })
      .map(toOutcome);
  }

  /**
   * Moves one outcome to `not_run`, `error` or `skipped` (abort, budget skip, normalisation error) and stores the cell's
   * roll-up, in one transaction. Never touches a priced, empty or no_data row (ruling 4).
   */
  setOutcome(
    executionId: string,
    cell: CellKey,
    stage: Stage,
    providerId: ProviderId,
    patch: Partial<CellOutcome> & { incrementAttempts?: boolean },
  ): void {
    for (const f of DATA_FIELDS)
      if (f in patch && f !== 'lastError')
        throw new RowRejected(
          'outcome-field',
          `setOutcome cannot write ${f}; data comes with writeTile, writeVerifiedCell or copyReused`,
        );
    const key = { ...keyParams(executionId, cell), stage, providerId };
    this.db.transaction(() => {
      const current = this.db.raw
        .prepare<Record<string, unknown>, OutcomeDbRow>(
          `SELECT * FROM cell_outcomes WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`,
        )
        .get(key);
      if (current === undefined)
        throw new RowRejected(
          'missing',
          `no ${stage} outcome for ${providerId} at ${cellKeyString(cell)} in ${executionId}`,
        );
      const existing = toOutcome(current);
      if (isTerminal(existing.status))
        throw new RowRejected(
          'terminal-outcome',
          `${cellKeyString(cell)} is ${existing.status}; spec §7 never rewrites priced, empty or no_data`,
        );
      const status = patch.status ?? existing.status;
      const reason = patch.reason !== undefined ? patch.reason : existing.reason;
      assertNonTerminalTarget(status, reason);
      if (patch.attempts !== undefined) assertInt('attempts', patch.attempts);
      const attempts = (patch.attempts ?? existing.attempts) + (patch.incrementAttempts === true ? 1 : 0);
      const lastError =
        patch.lastError !== undefined
          ? patch.lastError === null
            ? null
            : stripUrlsInText(patch.lastError)
          : existing.lastError;
      this.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = @status, reason = @reason, attempts = @attempts, last_error = @lastError, ${CLEARED} WHERE ${CELL_WHERE} AND stage = @stage AND provider_id = @providerId`,
        )
        .run({ ...key, status, reason, attempts, lastError });
      storeRollUps(this.db, executionId, stage, [cell]);
    });
  }

  /** Moves every outcome of one (stage, provider) in `from` to a non-terminal `to` (provider disabled, budget skip). Returns the count. */
  setOutcomesForProvider(
    executionId: string,
    stage: Stage,
    providerId: ProviderId,
    from: CellOutcomeStatus[],
    to: { status: CellOutcomeStatus; reason: string | null },
  ): number {
    if (from.some(isTerminal))
      throw new RowRejected(
        'terminal-outcome',
        'priced, empty and no_data outcomes are never rewritten (spec §7)',
      );
    assertNonTerminalTarget(to.status, to.reason);
    return this.db.transaction(() => {
      const changes = this.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = @status, reason = @reason, ${CLEARED} WHERE execution_id = @executionId AND stage = @stage AND provider_id = @providerId AND status IN (SELECT value FROM json_each(@from))`,
        )
        .run({
          executionId,
          stage,
          providerId,
          from: JSON.stringify(from),
          status: to.status,
          reason: to.reason,
        }).changes;
      if (changes > 0) storeRollUps(this.db, executionId, stage);
      return changes;
    });
  }

  /** Spec §8.1 cabin-not-offered: the provider is not called; its not_run outcomes become no_data with the reason. */
  markNoData(executionId: string, stage: Stage, providerId: ProviderId, reason: NoDataReason): number {
    return this.db.transaction(() => {
      const changes = this.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = 'no_data', reason = @reason WHERE execution_id = @executionId AND stage = @stage AND provider_id = @providerId AND status = 'not_run'`,
        )
        .run({ executionId, stage, providerId, reason }).changes;
      if (changes > 0) storeRollUps(this.db, executionId, stage);
      return changes;
    });
  }

  rollUps(executionId: string): Map<string, { discovery: RollUp; verification: RollUp }> {
    const out = new Map<string, { discovery: RollUp; verification: RollUp }>();
    for (const r of this.db.raw
      .prepare<[string], CellDbRow>(
        'SELECT * FROM search_cells WHERE execution_id = ? ORDER BY origin, destination, departure_date, return_date',
      )
      .all(executionId)) {
      out.set(cellKeyString(toCellKey(r)), {
        discovery: {
          status: nullableOneOf('search_cells.discovery_status', OUTCOME_STATUSES, r.discovery_status),
          reason: r.discovery_reason,
          minPence: r.discovery_min_pence,
        },
        verification: {
          status: nullableOneOf('search_cells.verification_status', OUTCOME_STATUSES, r.verification_status),
          reason: r.verification_reason,
          minPence: r.verification_min_pence,
        },
      });
    }
    return out;
  }

  /** The six buckets of spec §3 plus `reused` for one stage and provider. */
  buckets(executionId: string, stage: Stage, providerId: ProviderId): Buckets {
    return toBuckets(
      this.db.raw
        .prepare<Record<string, unknown>, BucketRow>(
          `SELECT ${BUCKET_COLUMNS} FROM cell_outcomes WHERE execution_id = @executionId AND stage = @stage AND provider_id = @providerId`,
        )
        .get({ executionId, stage, providerId }),
    );
  }

  /** Per departure date (View B): buckets per (stage, provider), dates ascending. */
  bucketsPerDay(
    executionId: string,
  ): Map<IsoDate, Array<{ stage: Stage; providerId: ProviderId; buckets: Buckets; total: number }>> {
    const out = new Map<
      IsoDate,
      Array<{ stage: Stage; providerId: ProviderId; buckets: Buckets; total: number }>
    >();
    const rows = this.db.raw
      .prepare<[string], BucketRow & { day: string; stage: string; providerId: string }>(
        `SELECT departure_date AS day, stage, provider_id AS providerId, ${BUCKET_COLUMNS} FROM cell_outcomes WHERE execution_id = ? GROUP BY departure_date, stage, provider_id ORDER BY departure_date, stage, provider_id`,
      )
      .all(executionId);
    for (const r of rows) {
      const day = readDate('cell_outcomes.departure_date', r.day);
      const list = out.get(day) ?? [];
      list.push({
        stage: oneOf('cell_outcomes.stage', STAGES, r.stage),
        providerId: oneOf('cell_outcomes.provider_id', PROVIDER_IDS, r.providerId),
        buckets: toBuckets(r),
        total: r.total,
      });
      out.set(day, list);
    }
    return out;
  }

  /**
   * Spec §7 atomic unit: one tile's prices, outcomes and roll-ups. Validation first (a malformed tile writes nothing);
   * any SQL failure inside rolls the whole tile back.
   */
  writeTile(executionId: string, providerId: ProviderId, w: TileWrite): void {
    assertInt('tileIndex', w.tileIndex);
    assertInt('discards', w.discards);
    const prices = new Map<string, CalendarPriceInsert>();
    for (const p of w.prices) {
      if (p.providerId !== providerId)
        throw new RowRejected('provider', `price from ${p.providerId} in a ${providerId} tile`);
      const key = cellKeyString(p.cell);
      if (prices.has(key))
        throw new RowRejected(
          'in-tile-conflict',
          `two prices for ${key} in one tile; the engine keeps one per cell (spec §5.6)`,
        );
      validateCalendarPrice(p, this.opts.allowSynthetic, true);
      prices.set(key, p);
    }
    const covered = new Set(w.cells.map(cellKeyString));
    const seen = new Set<string>();
    for (const o of w.outcomes) {
      const key = cellKeyString(o);
      if (!TILE_STATUSES.some((s) => s === o.status))
        throw new RowRejected(
          'tile-status',
          `a tile outcome is priced, empty or no_data; got ${o.status} (errors go through writeTileError)`,
        );
      if (!covered.has(key) || seen.has(key))
        throw new RowRejected('tile-partition', `${key} is outside the tile or repeated`);
      seen.add(key);
      assertOutcomeProvenance(o);
      assertOutcomeReason(o);
      const price = prices.get(key);
      if (o.status === 'priced' && price === undefined)
        throw new RowRejected(
          'priced-needs-price',
          `${key} is priced but the tile wrote no price for it (spec §3)`,
        );
      if (o.status !== 'priced' && price !== undefined)
        throw new RowRejected('price-needs-priced', `${key} has a price but its outcome is ${o.status}`);
      if (price !== undefined) {
        if (o.minPence !== price.pricePence)
          throw new RowRejected(
            'min-pence',
            `${key} min_pence ${String(o.minPence)} differs from its price ${price.pricePence}`,
          );
        if (
          o.fetchedAt !== price.fetchedAt ||
          o.cabin !== price.cabin ||
          o.pointOfSale !== price.pointOfSale ||
          o.sourceKind !== price.sourceKind
        ) {
          throw new RowRejected(
            'outcome-price-mismatch',
            `${key} outcome provenance differs from its price row (ruling 5)`,
          );
        }
      }
    }
    if (seen.size !== covered.size)
      throw new RowRejected('tile-partition', 'every covered cell needs exactly one outcome');
    for (const key of prices.keys())
      if (!seen.has(key)) throw new RowRejected('price-needs-priced', `${key} has a price but no outcome`);
    this.db.transaction(() => {
      for (const o of w.outcomes)
        this.db.raw.prepare(DELETE_REUSED_PRICE_SQL).run({ ...keyParams(executionId, o), providerId });
      for (const p of w.prices) insertCalendarPrice(this.db, executionId, p);
      for (const o of w.outcomes) {
        const existing = this.current(executionId, o, 'discovery', providerId);
        const incoming: CellOutcome = {
          ...existing,
          ...o,
          attempts: existing.attempts,
          reusedFromExecutionId: null,
        };
        storeOutcome(this.db, nextOutcome(existing, incoming, false));
        // why: per cell, so a later failure in the same tile also rolls back roll-ups already stored (test-011 pins it).
        storeRollUps(this.db, executionId, 'discovery', [o]);
      }
      this.db.raw.prepare('UPDATE search_executions SET auto_resume_count = 0 WHERE id = ?').run(executionId);
    });
  }

  /** Spec §8.1 "tile-error marks exactly its cells": error with the kind as reason, attempts + 1, merged through core. */
  writeTileError(
    executionId: string,
    providerId: ProviderId,
    cells: CellKey[],
    reason: string,
    lastError: string | null,
  ): void {
    assertErrorReason(reason);
    this.db.transaction(() => {
      for (const c of cells) {
        const existing = this.current(executionId, c, 'discovery', providerId);
        const incoming: CellOutcome = {
          ...existing,
          status: 'error',
          reason,
          lastError,
          fetchedAt: null,
          minPence: null,
          reusedFromExecutionId: null,
        };
        storeOutcome(this.db, nextOutcome(existing, incoming, true));
      }
      storeRollUps(this.db, executionId, 'discovery', cells);
    });
  }

  /** The current outcome row inside the caller's transaction; a missing seeded row is a rejection. */
  private current(executionId: string, c: CellKey, stage: Stage, providerId: ProviderId): CellOutcome {
    const r = this.db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow>(SELECT_OUTCOME_SQL)
      .get({ ...keyParams(executionId, c), stage, providerId });
    if (r === undefined)
      throw new RowRejected('missing', `no seeded ${stage} outcome for ${providerId} at ${cellKeyString(c)}`);
    return toOutcome(r);
  }

  /**
   * Spec §7 atomic unit "selection persistence + verification seeding": marks the selection, seeds one verification
   * outcome per cell of `allCells` × provider (selected → not_run, others → skipped:not_selected) and stores the
   * roll-ups. Selection runs once per execution (spec §6.7).
   */
  seedVerification(
    executionId: string,
    selected: Array<{ cell: CellKey; reason: SelectionReason }>,
    allCells: CellKey[],
    verificationProviders: ProviderId[],
  ): void {
    const all = new Set(allCells.map(cellKeyString));
    for (const s of selected)
      if (!all.has(cellKeyString(s.cell)))
        throw new RowRejected('selection-member', `${cellKeyString(s.cell)} is not among allCells`);
    this.db.transaction(() => {
      if (this.hasVerificationOutcomes(executionId))
        throw new RowRejected(
          'selection-once',
          `verification outcomes already exist for ${executionId}; selection runs once per execution`,
        );
      const inExecution =
        this.db.raw
          .prepare<Record<string, unknown>, { n: number }>(
            `SELECT COUNT(*) AS n FROM search_cells WHERE execution_id = @executionId AND ${CELL_KEY_SQL} IN (SELECT value FROM json_each(@keys))`,
          )
          .get({ executionId, keys: JSON.stringify([...all]) })?.n ?? 0;
      if (inExecution !== all.size)
        throw new RowRejected(
          'selection-member',
          `allCells names ${all.size - inExecution} cell(s) that are not cells of ${executionId}`,
        );
      this.db.raw
        .prepare(
          'UPDATE search_cells SET verification_selected = 0, selection_reason = NULL WHERE execution_id = ?',
        )
        .run(executionId);
      const mark = this.db.raw.prepare(
        `UPDATE search_cells SET verification_selected = 1, selection_reason = @reason WHERE ${CELL_WHERE}`,
      );
      for (const s of selected) mark.run({ ...keyParams(executionId, s.cell), reason: s.reason });
      const seed = this.db.raw.prepare(
        `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, reason, attempts)
         SELECT execution_id, origin, destination, departure_date, return_date, 'verification', @providerId,
                CASE WHEN verification_selected = 1 THEN 'not_run' ELSE 'skipped' END, CASE WHEN verification_selected = 1 THEN NULL ELSE 'not_selected' END, 0
         FROM search_cells WHERE execution_id = @executionId AND ${CELL_KEY_SQL} IN (SELECT value FROM json_each(@keys))`,
      );
      for (const providerId of verificationProviders)
        seed.run({ executionId, providerId, keys: JSON.stringify([...all]) });
      storeRollUps(this.db, executionId, 'verification', allCells);
    });
  }

  selected(executionId: string): Array<{ cell: CellKey; reason: SelectionReason }> {
    return this.db.raw
      .prepare<[string], CellKeyDbRow & { selection_reason: string }>(
        'SELECT origin, destination, departure_date, return_date, selection_reason FROM search_cells WHERE execution_id = ? AND verification_selected = 1 ORDER BY origin, destination, departure_date, return_date',
      )
      .all(executionId)
      .map((r) => ({
        cell: toCellKey(r),
        reason: oneOf('search_cells.selection_reason', SELECTION_REASONS, r.selection_reason),
      }));
  }

  /** Spec §7: resume re-runs selection only when no verification outcomes exist. */
  hasVerificationOutcomes(executionId: string): boolean {
    return (
      this.db.raw
        .prepare(
          `SELECT 1 AS present FROM cell_outcomes WHERE execution_id = ? AND stage = 'verification' LIMIT 1`,
        )
        .get(executionId) !== undefined
    );
  }

  resumable(executionId: string, stage: Stage, providerId: ProviderId, manual: boolean): CellKey[] {
    return this.db.raw
      .prepare<Record<string, unknown>, CellKeyDbRow>(RESUMABLE_SQL)
      .all({ executionId, stage, providerId, manual: manual ? 1 : 0 })
      .map(toCellKey);
  }

  /** Spec §8.1: not_run and skipped outcomes of cells departing on or before `today` become skipped:departed; priced/empty/no_data untouched. */
  markDeparted(executionId: string, today: IsoDate): number {
    return this.db.transaction(() => {
      const changes = this.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = 'skipped', reason = 'departed' WHERE execution_id = @executionId AND departure_date <= @today AND (status = 'not_run' OR (status = 'skipped' AND reason <> 'departed'))`,
        )
        .run({ executionId, today }).changes;
      if (changes > 0) {
        storeRollUps(this.db, executionId, 'discovery');
        storeRollUps(this.db, executionId, 'verification');
      }
      return changes;
    });
  }
}
