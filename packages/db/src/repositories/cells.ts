import {
  type Buckets,
  type Cell,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type Clock,
  cellKeyString,
  type IsoDate,
  isPartialExpansion,
  type NoDataReason,
  type ProviderId,
  type RollUp,
  type SelectionReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import { readSnapshot } from '../internal/definitionRow.js';
import {
  NO_DATA_REASONS,
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
import {
  assertOutcomeProvenance,
  assertOutcomeReason,
  DELETE_FRESH_PRICE_SQL,
  DELETE_REUSED_PRICE_SQL,
  nextOutcome,
  readOutcome,
  SELECT_OUTCOME_SQL,
  storeOutcome,
  TILE_STATUSES,
} from '../internal/outcomeWrite.js';
import {
  type CalendarPriceDbRow,
  insertCalendarPrice,
  toCalendarPriceRow,
  validateCalendarPrice,
} from '../internal/priceRow.js';
import { nullableOneOf, oneOf, readDate } from '../internal/read.js';
import { storeRollUps } from '../internal/rollUps.js';
import {
  assertErrorReason,
  assertInt,
  assertIsoDateTime,
  assertProviderAllowed,
  assertProviderKind,
  RowRejected,
} from '../internal/validate.js';
import type {
  CalendarPriceInsert,
  CalendarPriceRow,
  RepoOptions,
  ReuseCriteria,
  ReusedCopy,
  TileWrite,
  VerifiedCellWrite,
} from '../types.js';
import { ExecutionsRepo } from './executions.js';
import { ItinerariesRepo } from './itineraries.js';

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

/** prov-005: every field a reused copy carries must agree before anything is written (rule reuse-source). */
function assertReusable(
  providerId: ProviderId,
  { cell, outcome, price }: ReusedCopy,
  allowSynthetic: boolean,
): void {
  const key = cellKeyString(cell);
  const refuse = (why: string) => new RowRejected('reuse-source', `${key}: ${why} (spec §8.1)`);
  if (outcome.status !== 'priced' && outcome.status !== 'empty' && outcome.status !== 'no_data')
    throw refuse(`only priced, empty or no_data outcomes are reused, got ${outcome.status}`);
  if (outcome.providerId !== providerId || outcome.stage !== 'discovery')
    throw refuse(
      `a ${outcome.providerId} ${outcome.stage} outcome cannot be reused for ${providerId} discovery`,
    );
  if (cellKeyString(outcome) !== key) throw refuse(`the outcome is for ${cellKeyString(outcome)}`);
  if (
    outcome.fetchedAt === null ||
    outcome.cabin === null ||
    outcome.pointOfSale === null ||
    outcome.sourceKind === null
  )
    throw refuse('the outcome carries no provenance');
  assertProviderKind(providerId, outcome.sourceKind, allowSynthetic);
  if ((outcome.status === 'priced') !== (price !== null))
    throw refuse(`a ${outcome.status} outcome with${price === null ? 'out' : ''} a price`);
  if (price === null) return;
  if (cellKeyString(price.cell) !== key) throw refuse(`the price is for ${cellKeyString(price.cell)}`);
  if (price.providerId !== providerId) throw refuse(`the price is from ${price.providerId}`);
  if (price.fetchedAt !== outcome.fetchedAt || price.pricePence !== outcome.minPence)
    throw refuse('the price and the outcome disagree on fetched_at or amount');
  if (
    price.cabin !== outcome.cabin ||
    price.pointOfSale !== outcome.pointOfSale ||
    price.sourceKind !== outcome.sourceKind
  )
    throw refuse('the price and the outcome disagree on cabin, point of sale or source kind');
}

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
    for (const p of discoveryProviders) assertProviderAllowed(p, this.opts.allowSynthetic);
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
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
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
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
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
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
    // why: the one terminal write without assertOutcomeReason; an untyped caller's other reason would otherwise surface
    // as a raw provenance CHECK failure instead of a named refusal (prov-M4).
    if (!NO_DATA_REASONS.some((r) => r === reason))
      throw new RowRejected('outcome-reason', `markNoData takes a NoDataReason, got ${String(reason)}`);
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
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
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
      if (o.sourceKind !== null) assertProviderKind(providerId, o.sourceKind, this.opts.allowSynthetic);
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
      for (const o of w.outcomes) {
        const existing = this.current(executionId, o, 'discovery', providerId);
        const params = { ...keyParams(executionId, o), providerId };
        this.db.raw.prepare(DELETE_REUSED_PRICE_SQL).run(params);
        const price = prices.get(cellKeyString(o));
        if (price !== undefined) {
          // why: brief ruling 3, fresh on fresh priced keeps the minimum (core's merge picks the same source):
          // a lower price replaces the stored fresh row, an equal or higher one is not written.
          const freshPriced = existing.status === 'priced' && existing.reusedFromExecutionId === null;
          if (!freshPriced) insertCalendarPrice(this.db, executionId, price);
          else if (existing.minPence !== null && price.pricePence < existing.minPence) {
            this.db.raw.prepare(DELETE_FRESH_PRICE_SQL).run(params);
            insertCalendarPrice(this.db, executionId, price);
          }
        }
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
      new ExecutionsRepo(this.db, this.clock).resetAutoResume(executionId);
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
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
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
    return readOutcome(this.db, executionId, c, stage, providerId);
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
    for (const p of verificationProviders) assertProviderAllowed(p, this.opts.allowSynthetic);
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

  /**
   * Spec §7 atomic unit: one verified cell's itineraries, segments, offers, observations, outcome, best_observation_id
   * and roll-up. Merged like writeTile (ruling 3); best_observation_id is the cheapest observation written (ruling 13).
   */
  writeVerifiedCell(executionId: string, providerId: ProviderId, w: VerifiedCellWrite): void {
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
    if (w.outcome.sourceKind !== null)
      assertProviderKind(providerId, w.outcome.sourceKind, this.opts.allowSynthetic);
    const key = cellKeyString(w.cell);
    const o = w.outcome;
    const offers = w.itineraries.flatMap((i) => i.offers.map((x) => ({ ...x, itinerary: i.itinerary })));
    if (cellKeyString(o) !== key)
      throw new RowRejected('cell-mismatch', `outcome is for ${cellKeyString(o)}, not ${key}`);
    if (o.status !== 'priced' && o.status !== 'empty' && o.status !== 'error')
      throw new RowRejected('verified-status', `a verified cell is priced, empty or error; got ${o.status}`);
    if (o.status === 'priced' && offers.length === 0)
      throw new RowRejected('priced-needs-offer', `${key} is priced with no offer (spec §5.4)`);
    if (o.status !== 'priced' && offers.length > 0)
      throw new RowRejected('offers-need-priced', `${key} has offers but status ${o.status}`);
    if (o.status === 'error') assertErrorReason(o.reason);
    else {
      assertOutcomeProvenance(o);
      assertOutcomeReason(o);
    }
    for (const x of offers) {
      if (cellKeyString(x.itinerary) !== key)
        throw new RowRejected(
          'cell-mismatch',
          `itinerary ${x.itinerary.hash} is for ${cellKeyString(x.itinerary)}, not ${key}`,
        );
      if (x.offer.itineraryHash !== x.itinerary.hash || x.offer.providerId !== providerId)
        throw new RowRejected(
          'offer-mismatch',
          `offer does not belong to itinerary ${x.itinerary.hash} from ${providerId}`,
        );
      const p = x.observation.provenance;
      if (
        p.providerId !== providerId ||
        p.cabin !== o.cabin ||
        p.pointOfSale !== o.pointOfSale ||
        p.sourceKind !== o.sourceKind
      )
        throw new RowRejected(
          'outcome-price-mismatch',
          `${key} observation provenance differs from its outcome (ruling 5)`,
        );
    }
    // why: the per-observation flag and the outcome reason describe the same truncation; a cell must not roll up as
    // complete while its observations say expansion was partial, or the reverse (prov-M6).
    if (
      o.status === 'priced' &&
      offers.some((x) => x.observation.partialExpansion) !== isPartialExpansion(o.reason)
    )
      throw new RowRejected(
        'partial-expansion',
        `${key} reason ${String(o.reason)} disagrees with its observations' partialExpansion flags`,
      );
    if (offers.length > 0) {
      const cheapest = Math.min(...offers.map((x) => x.observation.pricePence));
      const oldest = offers.map((x) => x.observation.provenance.fetchedAt).sort()[0];
      if (o.minPence !== cheapest)
        throw new RowRejected(
          'min-pence',
          `${key} min_pence ${String(o.minPence)} differs from the cheapest offer ${cheapest}`,
        );
      if (o.fetchedAt !== oldest)
        throw new RowRejected(
          'outcome-price-mismatch',
          `${key} outcome fetchedAt must be its oldest observation's (spec §2)`,
        );
    }
    const itineraries = new ItinerariesRepo(this.db, this.clock, this.opts);
    this.db.transaction(() => {
      let best: { id: number; pence: number } | null = null;
      for (const x of offers) {
        itineraries.upsertItinerary(x.itinerary);
        const { observationId: id } = itineraries.recordObservation(x.offer, {
          ...x.observation,
          executionId,
        });
        if (best === null || x.observation.pricePence < best.pence)
          best = { id, pence: x.observation.pricePence };
      }
      const existing = this.current(executionId, w.cell, 'verification', providerId);
      // why: an error carries no fetched data, so it stores no provenance, as writeTileError does (prov-M5).
      const provenance =
        o.status === 'error' ? { fetchedAt: null, cabin: null, pointOfSale: null, sourceKind: null } : {};
      const incoming: CellOutcome = {
        ...existing,
        ...o,
        ...provenance,
        minPence: best?.pence ?? null,
        attempts: existing.attempts,
        reusedFromExecutionId: null,
      };
      storeOutcome(this.db, nextOutcome(existing, incoming, o.status === 'error'));
      if (best !== null) {
        this.db.raw
          .prepare(
            `UPDATE search_cells SET best_observation_id = @bestId WHERE ${CELL_WHERE} AND (best_observation_id IS NULL OR (SELECT price_pence FROM price_observations WHERE id = search_cells.best_observation_id) > @bestPence)`,
          )
          .run({ ...keyParams(executionId, w.cell), bestId: best.id, bestPence: best.pence });
      }
      storeRollUps(this.db, executionId, 'verification', [w.cell]);
      if (o.status !== 'error') new ExecutionsRepo(this.db, this.clock).resetAutoResume(executionId);
    });
  }

  /**
   * Spec §7 atomic unit "each reused cell's outcome + copied prices + roll-up" (one transaction for the batch).
   * Copies keep the original fetched_at and provenance; reused_from_execution_id is always the execution that
   * fetched the price, even when the source is itself a reused copy.
   */
  copyReused(
    executionId: string,
    providerId: ProviderId,
    copies: ReusedCopy[],
    criteria: ReuseCriteria,
  ): void {
    assertProviderAllowed(providerId, this.opts.allowSynthetic);
    assertIsoDateTime('newerThan', criteria.newerThan);
    for (const copy of copies) {
      assertReusable(providerId, copy, this.opts.allowSynthetic);
      if (copy.price !== null) validateCalendarPrice(copy.price, this.opts.allowSynthetic, false);
    }
    this.db.transaction(() => {
      for (const { cell, outcome, price } of copies) {
        const key = { ...keyParams(executionId, cell), stage: 'discovery', providerId };
        const target = this.db.raw
          .prepare<Record<string, unknown>, OutcomeDbRow>(SELECT_OUTCOME_SQL)
          .get(key);
        if (target?.status !== 'not_run')
          throw new RowRejected(
            'reuse-target',
            `${cellKeyString(cell)} in ${executionId} is ${target?.status ?? 'missing'}, not not_run`,
          );
        // why: what is written is what the database holds (prov-r3-001), never the caller's objects.
        const { stored, held } = this.assertSourceStored(
          executionId,
          providerId,
          { cell, outcome, price },
          criteria,
        );
        const reusedFrom = stored.reusedFromExecutionId ?? stored.executionId;
        storeOutcome(this.db, {
          ...stored,
          ...keyParams(executionId, cell),
          executionId,
          stage: 'discovery',
          providerId,
          attempts: 0,
          lastError: null,
          reusedFromExecutionId: reusedFrom,
        });
        if (held !== null)
          insertCalendarPrice(this.db, executionId, { ...held, reusedFromExecutionId: reusedFrom });
      }
      storeRollUps(
        this.db,
        executionId,
        'discovery',
        copies.map((c) => c.cell),
      );
      // why: spec §7 "reset when a tile or cell commits"; a run that progresses only by reuse is progressing (dm-M1).
      if (copies.length > 0) new ExecutionsRepo(this.db, this.clock).resetAutoResume(executionId);
    });
  }

  /**
   * prov-r2-001: the copy must be what the database holds. The source outcome is re-read by its keys and the price by
   * its id; both must equal the values supplied, and the source must be a non-child execution of the target's
   * definition fetched in the target's cabin, at the criteria's point of sale and source kind and after its cutoff
   * (spec §8.1, §9 Layer A). This is the one path that writes a price without a
   * provider call, so it trusts no caller; copyReused writes the re-read rows it returns.
   */
  private assertSourceStored(
    targetExecutionId: string,
    providerId: ProviderId,
    { cell, outcome, price }: ReusedCopy,
    criteria: ReuseCriteria,
  ): { stored: CellOutcome; held: CalendarPriceRow | null } {
    const refuse = (why: string) =>
      new RowRejected('reuse-source', `${cellKeyString(cell)}: ${why} (spec §8.1)`);
    const src = this.db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow & { definition_id: string; is_child: number }>(
        `SELECT o.*, e.definition_id, e.is_child FROM cell_outcomes o JOIN search_executions e ON e.id = o.execution_id
         WHERE o.execution_id = @executionId AND o.origin = @origin AND o.destination = @destination AND o.departure_date = @departureDate AND o.return_date = @returnDate
           AND o.stage = 'discovery' AND o.provider_id = @providerId`,
      )
      .get({ ...keyParams(outcome.executionId, cell), providerId });
    if (src === undefined) throw refuse(`no stored outcome in ${outcome.executionId}`);
    const target = this.db.raw
      .prepare<[string], { definition_id: string; definition_snapshot_json: string }>(
        'SELECT definition_id, definition_snapshot_json FROM search_executions WHERE id = ?',
      )
      .get(targetExecutionId);
    if (src.is_child !== 0 || target === undefined || src.definition_id !== target.definition_id)
      throw refuse('the source is not a parent execution of the same definition');
    const stored = toOutcome(src);
    // why: spec §9 Layer A "refuse on a cabin change": the definition's cabin may have been edited since the source ran (prov-r3-002).
    const targetCabin = readSnapshot(
      'search_executions.definition_snapshot_json',
      target.definition_snapshot_json,
    ).cabin;
    if (stored.cabin !== targetCabin)
      throw refuse(`the source was fetched in ${String(stored.cabin)}, the target searches ${targetCabin}`);
    // why: spec §8.1 reuse matches point of sale and source kind and takes only sources newer than the cutoff; this
    // path trusts no caller, so it re-applies the criteria reuseCandidates used (prov-M3).
    if (stored.pointOfSale !== criteria.pointOfSale || stored.sourceKind !== criteria.sourceKind)
      throw refuse(
        `the source is ${String(stored.pointOfSale)}/${String(stored.sourceKind)}, not ${criteria.pointOfSale}/${criteria.sourceKind}`,
      );
    if (stored.fetchedAt === null || stored.fetchedAt <= criteria.newerThan)
      throw refuse(`the source was fetched at ${String(stored.fetchedAt)}, not after ${criteria.newerThan}`);
    const same = (a: CellOutcome) =>
      [
        a.status,
        a.reason,
        a.fetchedAt,
        a.minPence,
        a.cabin,
        a.pointOfSale,
        a.sourceKind,
        a.reusedFromExecutionId,
      ].join('|');
    if (same(stored) !== same(outcome)) throw refuse('the supplied outcome differs from the stored one');
    if (price === null) return { stored, held: null };
    const p = this.db.raw
      .prepare<[number], CalendarPriceDbRow>('SELECT * FROM calendar_prices WHERE id = ?')
      .get(price.id);
    if (p === undefined) throw refuse(`calendar price ${price.id} does not exist`);
    const held = toCalendarPriceRow(p);
    const fxKey = (x: CalendarPriceRow) =>
      x.fx.converted ? `1|${x.fx.rateNano}|${x.fx.rateDate}|${x.fx.source}` : '0';
    const priceKey = (x: CalendarPriceRow) =>
      [
        x.executionId,
        x.providerId,
        cellKeyString(x.cell),
        x.pricePence,
        x.priceNativeMinor,
        x.currencyNative,
        fxKey(x),
        x.fetchedAt,
        x.providerObservedAt,
        x.maxAgeHours,
        x.vendorLink,
        x.cabin,
        x.pointOfSale,
        x.sourceKind,
        x.reusedFromExecutionId,
      ].join('|');
    if (held.executionId !== outcome.executionId || priceKey(held) !== priceKey(price))
      throw refuse('the supplied price differs from the stored one');
    return { stored, held };
  }
}
