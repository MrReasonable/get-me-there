import {
  type Buckets,
  type Cell,
  type CellKey,
  type CellOutcome,
  type CellOutcomeStatus,
  type Clock,
  cellKeyString,
  type IsoDate,
  type NoDataReason,
  type ProviderId,
  type RollUp,
  type SelectionReason,
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import {
  MANUAL_RETRYABLE,
  NO_DATA_REASONS,
  NON_RETRYABLE,
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
import { nextOutcome, readOutcome, storeOutcome } from '../internal/outcomeWrite.js';
import { nullableOneOf, oneOf, readDate } from '../internal/read.js';
import { writeReusedCopies } from '../internal/reuseCopy.js';
import { storeRollUps } from '../internal/rollUps.js';
import { writeTileRows } from '../internal/tileWrite.js';
import { assertErrorReason, assertInt, assertProviderAllowed, RowRejected } from '../internal/validate.js';
import { writeVerifiedCellRows } from '../internal/verifiedCellWrite.js';
import type { RepoOptions, ReuseCriteria, ReusedCopy, TileWrite, VerifiedCellWrite } from '../types.js';

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

// retriedOnResume lives in internal/resumeRule.ts so reuseCopy can call it without importing this file (a cycle).
export { retriedOnResume } from '../internal/resumeRule.js';

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
   * Spec §7 atomic unit: one tile's prices, outcomes and roll-ups (internal/tileWrite.ts). Validation first, then one
   * transaction; any SQL failure inside rolls the whole tile back.
   */
  writeTile(executionId: string, providerId: ProviderId, w: TileWrite): void {
    writeTileRows(this.db, this.clock, this.opts.allowSynthetic, executionId, providerId, w);
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

  /**
   * Spec §8.1 "before planning": not_run, error and skipped outcomes of cells departing on or before `today` become
   * skipped:departed, so a resume never re-fetches a flight that has left, whatever its outcome (ruling 1, ssr I1; the
   * error's attempts and last_error stay as evidence). priced, empty and no_data are untouched.
   */
  markDeparted(executionId: string, today: IsoDate): number {
    return this.db.transaction(() => {
      const changes = this.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = 'skipped', reason = 'departed' WHERE execution_id = @executionId AND departure_date <= @today AND (status IN ('not_run', 'error') OR (status = 'skipped' AND reason <> 'departed'))`,
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
   * and roll-up (internal/verifiedCellWrite.ts).
   */
  writeVerifiedCell(executionId: string, providerId: ProviderId, w: VerifiedCellWrite): void {
    writeVerifiedCellRows(this.db, this.clock, this.opts.allowSynthetic, executionId, providerId, w);
  }

  /**
   * Spec §7 atomic unit "each reused cell's outcome + copied prices + roll-up" (internal/reuseCopy.ts): every copy is
   * re-checked against what the database holds and the reuse criteria before anything is written.
   */
  copyReused(
    executionId: string,
    providerId: ProviderId,
    copies: ReusedCopy[],
    criteria: ReuseCriteria,
  ): void {
    writeReusedCopies(
      this.db,
      this.clock,
      this.opts.allowSynthetic,
      executionId,
      providerId,
      copies,
      criteria,
    );
  }
}
