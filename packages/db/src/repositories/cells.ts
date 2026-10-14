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
  type Stage,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import {
  OUTCOME_STATUSES,
  PROVIDER_IDS,
  SKIP_REASONS,
  STAGES,
  TERMINAL_STATUSES,
} from '../internal/enums.js';
import {
  CELL_KEY_SQL,
  CELL_WHERE,
  keyParams,
  type OutcomeDbRow,
  toCellKey,
  toOutcome,
} from '../internal/outcomeRow.js';
import { nullableOneOf, oneOf, readDate } from '../internal/read.js';
import { storeRollUps } from '../internal/rollUps.js';
import { assertErrorReason, assertInt, RowRejected } from '../internal/validate.js';
import type { RepoOptions } from '../types.js';

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
}
