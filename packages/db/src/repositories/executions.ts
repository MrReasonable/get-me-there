import { randomUUID } from 'node:crypto';
import {
  type CellKey,
  type Clock,
  type Execution,
  type ExecutionStatus,
  type IsoDateTime,
  RESUMABLE_STATUSES,
  stripUrlsInText,
} from '@gmt/core';
import Database from 'better-sqlite3';
import type { Db } from '../client.js';
import { readSnapshot } from '../internal/definitionRow.js';
import { EXECUTION_STATUSES, STAGES } from '../internal/enums.js';
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
  };
}

/**
 * Spec §8.1 "Resume is a compare-and-set": the tick, the one-shot job, boot auto-resume and `/resume` all run this one
 * statement; exactly one caller sees `changes = 1`. It also clears the one-shot schedule, a stale cancel flag and the
 * finish time in the same step (dm-004), so a resumed run is never both running and cancel-requested.
 */
export const CLAIM_RESUME_SQL = `UPDATE search_executions SET status = 'running', resume_after = NULL, cancel_requested = 0, finished_at = NULL WHERE id = ? AND status IN (${RESUMABLE_STATUSES.map((s) => `'${s}'`).join(', ')})`;

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
] as const satisfies ReadonlyArray<readonly [keyof ExecutionPatch, string]>;

function encode(key: keyof ExecutionPatch, patch: ExecutionPatch): unknown {
  switch (key) {
    case 'resumeAfter':
    case 'startedAt':
    case 'finishedAt': {
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

  create(input: ExecutionCreateInput): Execution {
    if (input.isChild !== (input.cell !== null))
      throw new RowRejected('child-cell', 'a child execution carries a cell and a parent does not');
    const id = randomUUID();
    const now = this.clock.now();
    const c = input.cell;
    this.db.raw
      .prepare(
        `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date, definition_snapshot_json, trigger, status, estimate_json, created_at, started_at, finished_at)
         VALUES (@id, @definitionId, @isChild, @o, @d, @dep, @ret, @snapshot, @trigger, @status, @estimate, @now, @startedAt, @finishedAt)`,
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
      });
    return this.mustGet(id);
  }

  get(id: string): Execution | null {
    const r = this.db.raw
      .prepare<[string], ExecutionDbRow>('SELECT * FROM search_executions WHERE id = ?')
      .get(id);
    return r === undefined ? null : toExecution(r);
  }

  /** Newest first by creation. */
  listForDefinition(definitionId: string, opts: { limit: number; includeChildren: boolean }): Execution[] {
    return this.db.raw
      .prepare<Record<string, unknown>, ExecutionDbRow>(
        `SELECT * FROM search_executions WHERE definition_id = @definitionId AND (@children = 1 OR is_child = 0) ORDER BY created_at DESC, rowid DESC LIMIT @limit`,
      )
      .all({ definitionId, children: opts.includeChildren ? 1 : 0, limit: opts.limit })
      .map(toExecution);
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
        `UPDATE search_executions SET status = 'interrupted', auto_resume_count = auto_resume_count + 1 WHERE status = 'running' OR (status = 'pending' AND created_at < ?) RETURNING id`,
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

  /** The newest schedule-triggered parent execution, including `skipped_*` rows (spec §8.2 missed-firing check). */
  lastScheduledFiring(definitionId: string): IsoDateTime | null {
    const r = this.db.raw
      .prepare<[string], { at: string | null }>(
        `SELECT MAX(created_at) AS at FROM search_executions WHERE definition_id = ? AND is_child = 0 AND trigger = 'schedule'`,
      )
      .get(definitionId);
    return readNullableTime('search_executions.created_at', r?.at ?? null);
  }

  private apply(id: string, status: ExecutionStatus | null, patch: ExecutionPatch): void {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (status !== null) {
      sets.push('status = @status');
      params.status = status;
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
