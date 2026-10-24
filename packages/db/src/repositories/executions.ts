import { randomUUID } from 'node:crypto';
import {
  type CellKey,
  type Clock,
  type Execution,
  type ExecutionStatus,
  type IsoDateTime,
  PAUSED_STATUSES,
  RESUMABLE_STATUSES,
  stripUrlsInText,
} from '@gmt/core';
import Database from 'better-sqlite3';
import type { Db } from '../client.js';
import { readSnapshot } from '../internal/definitionRow.js';
import { EXECUTION_STATUSES, SKIP_CODES, STAGES } from '../internal/enums.js';
import {
  nullableOneOf,
  oneOf,
  readDate,
  readEstimate,
  readIata,
  readNullableTime,
  readTime,
} from '../internal/read.js';
import { assertIsoDateTime, assertNullableIsoDateTime, RowRejected } from '../internal/validate.js';
import { ACTIVE_STATUS_SQL } from '../schema/checks.js';
import type { ExecutionCreateInput, ExecutionPatch } from '../types.js';

interface ExecutionDbRow {
  id: string;
  definition_id: string;
  is_child: number;
  child_origin: string | null;
  child_destination: string | null;
  child_departure_date: string | null;
  child_return_date: string | null;
  definition_snapshot_json: string;
  trigger: string;
  status: string;
  stage: string | null;
  estimate_json: string | null;
  cancel_requested: number;
  resume_after: string | null;
  auto_resume_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_text: string | null;
  scheduled_for: string | null;
  is_catch_up: number;
  browser_window_end: string | null;
  skip_code: string | null;
  paused_at: string | null;
}

function toExecution(r: ExecutionDbRow): Execution {
  const c = 'search_executions';
  const cell: CellKey | null =
    r.is_child === 1 &&
    r.child_origin !== null &&
    r.child_destination !== null &&
    r.child_departure_date !== null &&
    r.child_return_date !== null
      ? {
          origin: readIata(`${c}.child_origin`, r.child_origin),
          destination: readIata(`${c}.child_destination`, r.child_destination),
          departureDate: readDate(`${c}.child_departure_date`, r.child_departure_date),
          returnDate: readDate(`${c}.child_return_date`, r.child_return_date),
        }
      : null;
  return {
    id: r.id,
    definitionId: r.definition_id,
    isChild: r.is_child === 1,
    cell,
    snapshot: readSnapshot(`${c}.definition_snapshot_json`, r.definition_snapshot_json),
    status: oneOf(`${c}.status`, EXECUTION_STATUSES, r.status),
    stage: nullableOneOf(`${c}.stage`, STAGES, r.stage),
    estimate: r.estimate_json === null ? null : readEstimate(`${c}.estimate_json`, r.estimate_json),
    cancelRequested: r.cancel_requested === 1,
    resumeAfter: readNullableTime(`${c}.resume_after`, r.resume_after),
    autoResumeCount: r.auto_resume_count,
    startedAt: readNullableTime(`${c}.started_at`, r.started_at),
    finishedAt: readNullableTime(`${c}.finished_at`, r.finished_at),
    errorText: r.error_text,
    createdAt: readTime(`${c}.created_at`, r.created_at),
    trigger: oneOf(`${c}.trigger`, ['manual', 'schedule', 'tool'], r.trigger),
    scheduledFor: readNullableTime(`${c}.scheduled_for`, r.scheduled_for),
    isCatchUp: r.is_catch_up === 1,
    browserWindowEnd: readNullableTime(`${c}.browser_window_end`, r.browser_window_end),
    skipCode: nullableOneOf(`${c}.skip_code`, SKIP_CODES, r.skip_code),
    pausedAt: readNullableTime(`${c}.paused_at`, r.paused_at),
  };
}

/**
 * Spec §8.1 "Resume is a compare-and-set": the tick, the one-shot job, boot auto-resume and `/resume` all run this one
 * statement; exactly one caller sees `changes = 1`. It also clears the one-shot schedule, a stale cancel flag and the
 * finish time in the same step (dm-004), so a resumed run is never both running and cancel-requested.
 */
export const CLAIM_RESUME_SQL = `UPDATE search_executions SET status = 'running', resume_after = NULL, cancel_requested = 0, finished_at = NULL, paused_at = NULL WHERE id = ? AND status IN (${RESUMABLE_STATUSES.map((s) => `'${s}'`).join(', ')})`;

/** ExecutionsRepo.oldestInFlight's read, exported so a test can pin its query plan to the in-flight index. */
export const OLDEST_IN_FLIGHT_SQL = `SELECT id, definition_id, is_child, started_at, created_at FROM search_executions
  WHERE status IN ('pending', 'running') ORDER BY created_at, rowid LIMIT 1`;

/** Patch keys and their columns, a typed constant (ruling 15). */
const PATCH_COLUMNS = [
  ['stage', 'stage'],
  ['resumeAfter', 'resume_after'],
  ['errorText', 'error_text'],
  ['startedAt', 'started_at'],
  ['finishedAt', 'finished_at'],
  ['cancelRequested', 'cancel_requested'],
  ['estimate', 'estimate_json'],
  ['snapshot', 'definition_snapshot_json'],
  ['browserWindowEnd', 'browser_window_end'],
] as const satisfies ReadonlyArray<readonly [keyof ExecutionPatch, string]>;

function encode(key: keyof ExecutionPatch, patch: ExecutionPatch): unknown {
  switch (key) {
    case 'resumeAfter':
    case 'startedAt':
    case 'finishedAt':
    case 'browserWindowEnd': {
      const v = patch[key] ?? null;
      assertNullableIsoDateTime(key, v);
      return v;
    }
    case 'errorText':
      return patch.errorText === null || patch.errorText === undefined
        ? null
        : stripUrlsInText(patch.errorText);
    case 'cancelRequested':
      return patch.cancelRequested === true ? 1 : 0;
    case 'estimate':
      return patch.estimate === null || patch.estimate === undefined ? null : JSON.stringify(patch.estimate);
    case 'snapshot':
      if (patch.snapshot === undefined)
        throw new RowRejected('snapshot', 'a snapshot patch needs a snapshot');
      return JSON.stringify(patch.snapshot);
    case 'stage':
      return patch.stage ?? null;
  }
}

const PAUSED_SQL = PAUSED_STATUSES.map((st) => `'${st}'`).join(', ');

const SKIPPED: readonly ExecutionStatus[] = [
  'skipped_budget',
  'skipped_confirm',
  'skipped_window',
  'skipped_missed',
];

/** Spec §7 `search_executions`. Every write is a single statement or one transaction. */
export class ExecutionsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /**
   * Inserts an execution. A second active parent of the definition, or a second active child of the same cell, is
   * refused with `RowRejected` rule `active` (spec §7 partial unique indexes). A row standing for a scheduled firing goes
   * through `createForFiring` instead, so it can never bypass the firing unique index.
   */
  create(input: ExecutionCreateInput): Execution {
    if ((input.scheduledFor ?? null) !== null)
      throw new RowRejected('firing', 'a row for a scheduled firing is inserted with createForFiring');
    const e = this.insert(input, null);
    if (e === null) throw new RowRejected('missing', 'the execution was not inserted');
    return e;
  }

  /**
   * Spec §7 rev 36: inserts the row a scheduled start or skip writes for its firing, through the firing unique index with
   * `ON CONFLICT(definition_id, scheduled_for) WHERE is_child = 0 AND scheduled_for IS NOT NULL DO NOTHING`. Null when
   * another parent row already holds the firing (`changes() = 0`: the loser of a race, which records nothing). Never
   * `INSERT OR IGNORE`: the active-parent clash still throws `RowRejected` rule `active`, and a CHECK or NOT NULL failure
   * still throws.
   */
  createForFiring(input: ExecutionCreateInput & { scheduledFor: IsoDateTime }): Execution | null {
    return this.insert(input, input.scheduledFor);
  }

  private insert(input: ExecutionCreateInput, firing: IsoDateTime | null): Execution | null {
    if (input.isChild !== (input.cell !== null))
      throw new RowRejected('child-cell', 'a child execution carries a cell and a parent does not');
    assertNullableIsoDateTime('scheduledFor', firing);
    assertNullableIsoDateTime('browserWindowEnd', input.browserWindowEnd ?? null);
    const id = randomUUID();
    const now = this.clock.now();
    const c = input.cell;
    // why: the conflict target names the partial index's WHERE, so only a clash on the firing is swallowed (spec §7)
    const onConflict =
      firing === null
        ? ''
        : ' ON CONFLICT(definition_id, scheduled_for) WHERE is_child = 0 AND scheduled_for IS NOT NULL DO NOTHING';
    let changes: number;
    try {
      changes = this.db.raw
        .prepare(
          `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date, definition_snapshot_json, trigger, status, estimate_json, created_at, started_at, finished_at, scheduled_for, is_catch_up, browser_window_end, skip_code)
           VALUES (@id, @definitionId, @isChild, @o, @d, @dep, @ret, @snapshot, @trigger, @status, @estimate, @now, @startedAt, @finishedAt, @scheduledFor, @isCatchUp, @windowEnd, @skipCode)${onConflict}`,
        )
        .run({
          id,
          definitionId: input.definitionId,
          isChild: input.isChild ? 1 : 0,
          o: c?.origin ?? null,
          d: c?.destination ?? null,
          dep: c?.departureDate ?? null,
          ret: c?.returnDate ?? null,
          snapshot: JSON.stringify(input.snapshot),
          trigger: input.trigger,
          status: input.status,
          estimate: input.estimate === null ? null : JSON.stringify(input.estimate),
          now,
          startedAt: input.status === 'running' ? now : null,
          finishedAt: SKIPPED.includes(input.status) ? now : null,
          scheduledFor: firing,
          isCatchUp: input.isCatchUp === true ? 1 : 0,
          windowEnd: input.browserWindowEnd ?? null,
          skipCode: input.skipCode ?? null,
        }).changes;
    } catch (err) {
      // why: the partial unique indexes (spec §7 one active parent per definition, one active child per cell) are the
      // driver's to report; callers see the condition, never a SQLite code (code-architect review 3)
      if (err instanceof Database.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE')
        throw new RowRejected(
          'active',
          input.isChild
            ? 'this cell is already being verified'
            : 'another execution of this definition is active',
        );
      throw err;
    }
    return changes === 0 ? null : this.mustGet(id);
  }

  /** Spec §8.2: whether a parent row of the definition already holds this firing (a start or a skip). */
  firingTaken(definitionId: string, firing: IsoDateTime): boolean {
    return (
      this.db.raw
        .prepare(
          'SELECT 1 AS present FROM search_executions WHERE definition_id = ? AND is_child = 0 AND scheduled_for = ? LIMIT 1',
        )
        .get(definitionId, firing) !== undefined
    );
  }

  /**
   * Spec §8.2 rev 36 (decision 79), the coverage read: a firing is covered when a parent row already carries it in
   * `scheduled_for` (read first, through the covering firing index), or when any parent execution (manual and catch-up
   * included) was active at that instant or was created after it, except a catch-up that was paused at the firing: one
   * whose `paused_at` (the stored instant it stopped running, cleared only when it runs again) is at or before it. So a
   * catch-up in flight at a firing covers it like any run, and one paused there never does, decided from stored facts
   * rather than from whichever timer fires first after a wake (the engine's automatic resumes of a paused catch-up yield
   * to a later firing instead of resuming). `except` is a run the caller has just superseded for this firing (a late
   * live tick): replaced, it covers nothing. The definition's own `updated_at` and its runnable providers are the
   * engine's half.
   */
  coversFiring(definitionId: string, firing: IsoDateTime, except: string | null = null): boolean {
    assertIsoDateTime('firing', firing);
    if (this.firingTaken(definitionId, firing)) return true;
    return (
      this.db.raw
        .prepare(
          `SELECT 1 AS present FROM search_executions WHERE definition_id = @definitionId AND is_child = 0
             AND NOT (is_catch_up = 1 AND paused_at IS NOT NULL AND paused_at <= @firing) AND id IS NOT @except
             AND (created_at > @firing
                  OR (COALESCE(started_at, created_at) <= @firing AND (finished_at IS NULL OR finished_at >= @firing)))
           LIMIT 1`,
        )
        .get({ definitionId, firing, except }) !== undefined
    );
  }

  /**
   * Decision 83: a live-tick resume re-anchors a paused run to its firing and moves its browser window's end, in one
   * statement (the resume runs it inside its claim transaction), but only for a parent that is not a catch-up (a
   * catch-up names the firing it missed, which History shows) and only when no other parent row of the definition holds
   * that firing (`UPDATE … WHERE NOT EXISTS`); re-anchoring a row to the firing it already holds succeeds. False
   * (`changes() = 0`) leaves the row as it was, and the resume carries on under its old window.
   */
  reanchorFiring(id: string, firing: IsoDateTime, browserWindowEnd: IsoDateTime): boolean {
    assertIsoDateTime('firing', firing);
    assertIsoDateTime('browserWindowEnd', browserWindowEnd);
    return (
      this.db.raw
        .prepare(
          `UPDATE search_executions SET scheduled_for = @firing, browser_window_end = @end
             WHERE id = @id AND is_child = 0 AND is_catch_up = 0 AND NOT EXISTS (
               SELECT 1 FROM search_executions o WHERE o.definition_id = search_executions.definition_id AND o.is_child = 0
                 AND o.scheduled_for = @firing AND o.id <> search_executions.id)`,
        )
        .run({ id, firing, end: browserWindowEnd }).changes === 1
    );
  }

  get(id: string): Execution | null {
    const r = this.db.raw
      .prepare<[string], ExecutionDbRow>('SELECT * FROM search_executions WHERE id = ?')
      .get(id);
    return r === undefined ? null : toExecution(r);
  }

  /** Newest first by creation; `limit: 'all'` reads every one (the read routes, which must never drop a run). */
  listForDefinition(
    definitionId: string,
    opts: { limit: number | 'all'; includeChildren: boolean },
  ): Execution[] {
    return (
      this.db.raw
        .prepare<Record<string, unknown>, ExecutionDbRow>(
          `SELECT * FROM search_executions WHERE definition_id = @definitionId AND (@children = 1 OR is_child = 0) ORDER BY created_at DESC, rowid DESC LIMIT @limit`,
        )
        // why: SQLite reads a negative LIMIT as no limit
        .all({
          definitionId,
          children: opts.includeChildren ? 1 : 0,
          limit: opts.limit === 'all' ? -1 : opts.limit,
        })
        .map(toExecution)
    );
  }

  /**
   * Spec §10 `GET /api/executions/active` (decision 80, review R15/R16): the oldest execution with a pass in flight
   * (pending or running), a parent run or a single-cell verification alike: five columns of one row, found by one probe
   * of the partial index `search_executions_in_flight_idx` (no table scan, no snapshot decoded).
   */
  oldestInFlight(): {
    id: string;
    definitionId: string;
    isChild: boolean;
    startedAt: IsoDateTime | null;
    createdAt: IsoDateTime;
  } | null {
    const r = this.db.raw
      .prepare<
        [],
        { id: string; definition_id: string; is_child: number; started_at: string | null; created_at: string }
      >(OLDEST_IN_FLIGHT_SQL)
      .get();
    if (r === undefined) return null;
    return {
      id: r.id,
      definitionId: r.definition_id,
      isChild: r.is_child === 1,
      startedAt: readNullableTime('search_executions.started_at', r.started_at),
      createdAt: readTime('search_executions.created_at', r.created_at),
    };
  }

  /** Executions in any of the statuses, oldest first (boot auto-resume, one-shot re-registration). */
  listByStatus(statuses: ExecutionStatus[]): Execution[] {
    return this.db.raw
      .prepare<[string], ExecutionDbRow>(
        'SELECT * FROM search_executions WHERE status IN (SELECT value FROM json_each(?)) ORDER BY created_at, rowid',
      )
      .all(JSON.stringify(statuses))
      .map(toExecution);
  }

  activeParent(definitionId: string): Execution | null {
    const r = this.db.raw
      .prepare<[string], ExecutionDbRow>(
        `SELECT * FROM search_executions WHERE definition_id = ? AND is_child = 0 AND status IN (${ACTIVE_STATUS_SQL})`,
      )
      .get(definitionId);
    return r === undefined ? null : toExecution(r);
  }

  activeChild(definitionId: string, cell: CellKey): Execution | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, ExecutionDbRow>(
        `SELECT * FROM search_executions WHERE definition_id = @definitionId AND is_child = 1 AND status IN (${ACTIVE_STATUS_SQL})
         AND child_origin = @origin AND child_destination = @destination AND child_departure_date = @departureDate AND child_return_date = @returnDate`,
      )
      .get({ definitionId, ...cell });
    return r === undefined ? null : toExecution(r);
  }

  latestCompleted(definitionId: string): Execution | null {
    const r = this.db.raw
      .prepare<[string], ExecutionDbRow>(
        `SELECT * FROM search_executions WHERE definition_id = ? AND is_child = 0 AND status = 'completed' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(definitionId);
    return r === undefined ? null : toExecution(r);
  }

  /** Spec §8.1 compare-and-set. A claim that would make a second active run loses instead of throwing (`/resume` answers 409). */
  claimResume(id: string): boolean {
    try {
      return this.db.raw.prepare(CLAIM_RESUME_SQL).run(id).changes === 1;
    } catch (err) {
      if (err instanceof Database.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
      throw err;
    }
  }

  /**
   * Spec §8.2 rev 36: cancels a run whose pass is not running (paused or interrupted, PAUSED_STATUSES) in one guarded
   * statement, with its finish time and why; false when it is no longer in one of them (a resume claimed it first). The
   * scheduled start that supersedes a paused catch-up runs it inside its own immediate transaction.
   */
  cancelPaused(id: string, errorText: string): boolean {
    return (
      this.db.raw
        .prepare(
          `UPDATE search_executions SET status = 'cancelled', finished_at = @now, resume_after = NULL, error_text = @errorText WHERE id = @id AND status IN (${PAUSED_SQL})`,
        )
        .run({ id, now: this.clock.now(), errorText: stripUrlsInText(errorText) }).changes === 1
    );
  }

  setStatus(id: string, status: ExecutionStatus, patch: ExecutionPatch = {}): void {
    this.apply(id, status, patch);
  }

  patch(id: string, patch: ExecutionPatch): void {
    this.apply(id, null, patch);
  }

  requestCancel(id: string): void {
    this.apply(id, null, { cancelRequested: true });
  }

  /** Spec §8.1 "Boot order": `running` and `pending` created before this boot become `interrupted`, counting a crash restart. */
  bootSweep(bootAt: IsoDateTime): { interrupted: string[] } {
    assertIsoDateTime('bootAt', bootAt);
    const rows = this.db.raw
      .prepare<[string], { id: string }>(
        // why: decision 79 (review S1) — a run the process lost stopped running at its last recorded activity (its
        // newest ledger row, else its start), not at this boot, so a firing during the outage finds it paused there
        `UPDATE search_executions SET status = 'interrupted', auto_resume_count = auto_resume_count + 1,
           paused_at = COALESCE(paused_at,
             (SELECT MAX(COALESCE(r.finished_at, r.started_at)) FROM provider_requests r WHERE r.execution_id = search_executions.id),
             started_at, created_at)
         WHERE status = 'running' OR (status = 'pending' AND created_at < ?) RETURNING id`,
      )
      .all(bootAt);
    return { interrupted: rows.map((r) => r.id) };
  }

  incrementAutoResume(id: string): number {
    const r = this.db.raw
      .prepare<[string], { n: number }>(
        'UPDATE search_executions SET auto_resume_count = auto_resume_count + 1 WHERE id = ? RETURNING auto_resume_count AS n',
      )
      .get(id);
    if (r === undefined) throw new RowRejected('missing', `execution ${id} does not exist`);
    return r.n;
  }

  /** Spec §7 "reset when a tile or cell commits"; the tile and cell writes also reset it inside their own transactions. */
  resetAutoResume(id: string): void {
    if (
      this.db.raw.prepare('UPDATE search_executions SET auto_resume_count = 0 WHERE id = ?').run(id)
        .changes === 0
    )
      throw new RowRejected('missing', `execution ${id} does not exist`);
  }

  private apply(id: string, status: ExecutionStatus | null, patch: ExecutionPatch): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (status !== null) {
      sets.push('status = @status');
      params.status = status;
      // why: decision 79 (review S1) — the instant the row stopped running is a stored fact the coverage read uses: set
      // once when it enters a paused or interrupted status, kept through a cancel or a finish, cleared when it runs again
      if (PAUSED_STATUSES.includes(status)) {
        sets.push('paused_at = COALESCE(paused_at, @pausedNow)');
        params.pausedNow = this.clock.now();
      } else if (status === 'running' || status === 'pending') sets.push('paused_at = NULL');
    }
    for (const [key, column] of PATCH_COLUMNS) {
      if (!(key in patch)) continue;
      sets.push(`${column} = @${key}`);
      params[key] = encode(key, patch);
    }
    if (sets.length === 0) return;
    if (
      this.db.raw.prepare(`UPDATE search_executions SET ${sets.join(', ')} WHERE id = @id`).run(params)
        .changes === 0
    )
      throw new RowRejected('missing', `execution ${id} does not exist`);
  }

  private mustGet(id: string): Execution {
    const e = this.get(id);
    if (e === null) throw new RowRejected('missing', `execution ${id} does not exist`);
    return e;
  }
}
