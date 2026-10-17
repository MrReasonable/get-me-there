import { Worker } from 'node:worker_threads';
import { ACTIVE_STATUSES, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { RowCorrupt } from '../src/internal/read.js';
import { RowRejected } from '../src/internal/validate.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { CLAIM_RESUME_SQL, ExecutionsRepo } from '../src/repositories/executions.js';
import { ACTIVE_STATUS_SQL } from '../src/schema/checks.js';
import { at, freshDb, openTracked, T0, tmpDbPath } from './helpers/db.js';
import { cell, EWR, exampleDefinitionInput, newExecution, snapshotOf } from './helpers/factories.js';

/**
 * test-005: 'ok' when the call succeeds, 'unique' when `create` reports the active-execution clash as
 * `RowRejected('active')` (the engine never reads driver codes; code-architect review 3); any other failure is rethrown.
 */
function attempt(fn: () => unknown): 'ok' | 'unique' {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof RowRejected && e.rule === 'active') return 'unique';
    throw e;
  }
}

describe('ExecutionsRepo (spec §7 search_executions, §8.1)', () => {
  it('the schema active set matches core ACTIVE_STATUSES', () => {
    expect(ACTIVE_STATUS_SQL).toBe(ACTIVE_STATUSES.map((s) => `'${s}'`).join(', '));
  });

  it('round-trips parent and child; pending has no startedAt, running does, skipped is created finished', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const { definition, execution } = newExecution(db, clock, { status: 'pending', trigger: 'schedule' });
    expect(execution).toMatchObject({
      definitionId: definition.id,
      isChild: false,
      cell: null,
      status: 'pending',
      stage: null,
      trigger: 'schedule',
      createdAt: T0,
      startedAt: null,
      finishedAt: null,
      autoResumeCount: 0,
      cancelRequested: false,
      errorText: null,
    });
    expect(execution.snapshot).toEqual(snapshotOf(definition));
    expect(newExecution(db, clock, { definition, cell: cell() }).execution).toMatchObject({
      isChild: true,
      cell: cell(),
      startedAt: T0,
    });
    expect(newExecution(db, clock, { definition, status: 'skipped_window' }).execution).toMatchObject({
      status: 'skipped_window',
      startedAt: null,
      finishedAt: T0,
    });
    expect(() =>
      new ExecutionsRepo(db, clock).create({
        definitionId: definition.id,
        isChild: true,
        cell: null,
        snapshot: snapshotOf(definition),
        estimate: null,
        trigger: 'manual',
        status: 'running',
      }),
    ).toThrow(RowRejected);
  });

  it('a child-shaped snapshot (maxCells 1, alwaysInclude [cell], inherited topN 10, no confirmed cost) round-trips through create and get (dm-r2-001, arch-r2-003)', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const definition = new DefinitionsRepo(db, clock).create(exampleDefinitionInput());
    expect(definition.confirmedCostPence).toBeNull();
    const parent = snapshotOf(definition);
    // why: the read path must not depend on WP7 pinning topN to 1; a save-time refinement (topN ≤ maxCells) must not run on stored rows.
    const childSnapshot = {
      ...parent,
      verification: { ...parent.verification, maxCells: 1, alwaysInclude: [cell()] },
      providers: { ...parent.providers, discovery: [] },
    };
    const repo = new ExecutionsRepo(db, clock);
    const child = repo.create({
      definitionId: definition.id,
      isChild: true,
      cell: cell(),
      snapshot: childSnapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    expect(child.snapshot).toEqual(childSnapshot);
    expect(repo.get(child.id)?.snapshot.verification).toEqual({
      ...parent.verification,
      maxCells: 1,
      topN: 10,
      alwaysInclude: [cell()],
    });
  });

  it('a corrupt stored snapshot is reported as RowCorrupt (dm-006)', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const { execution } = newExecution(db, clock);
    db.raw
      .prepare(`UPDATE search_executions SET definition_snapshot_json = '{"budget":{}}' WHERE id = ?`)
      .run(execution.id);
    expect(() => new ExecutionsRepo(db, clock).get(execution.id)).toThrow(RowCorrupt);
  });

  it('partial unique indexes: one active parent per definition, one active child per cell; parent and child coexist', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const { definition, execution } = newExecution(db, clock, { status: 'pending' });
    expect(attempt(() => newExecution(db, clock, { definition }))).toBe('unique');
    expect(attempt(() => newExecution(db, clock, { definition, cell: cell() }))).toBe('ok');
    expect(attempt(() => newExecution(db, clock, { definition, cell: cell() }))).toBe('unique');
    expect(attempt(() => newExecution(db, clock, { definition, cell: cell(undefined, EWR) }))).toBe('ok');
    new ExecutionsRepo(db, clock).setStatus(execution.id, 'completed', { finishedAt: T0 });
    expect(newExecution(db, clock, { definition }).execution.status).toBe('running');
    const sqlOf = (name: string) =>
      db.raw.prepare<[string], { sql: string }>(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name)
        ?.sql;
    expect(sqlOf('search_executions_active_parent_uq')).toMatch(
      /WHERE is_child = 0 AND status IN \('pending', 'running', 'paused_budget', 'paused_error', 'interrupted'\)/,
    );
    expect(sqlOf('search_executions_active_child_uq')).toMatch(/WHERE is_child = 1 AND status IN/);
  });

  it('reads: activeParent, activeChild, latestCompleted, listForDefinition, listByStatus, lastScheduledFiring', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const repo = new ExecutionsRepo(db, clock);
    const { definition, execution: first } = newExecution(db, clock, { trigger: 'schedule' });
    repo.setStatus(first.id, 'completed');
    clock.advance(1000);
    const missed = newExecution(db, clock, {
      definition,
      status: 'skipped_missed',
      trigger: 'schedule',
    }).execution;
    clock.advance(1000);
    const second = newExecution(db, clock, { definition }).execution;
    const child = newExecution(db, clock, { definition, cell: cell() }).execution;
    expect(repo.activeParent(definition.id)?.id).toBe(second.id);
    expect(repo.activeChild(definition.id, cell())?.id).toBe(child.id);
    expect(repo.activeChild(definition.id, cell(undefined, EWR))).toBeNull();
    expect(repo.latestCompleted(definition.id)?.id).toBe(first.id);
    expect(
      repo.listForDefinition(definition.id, { limit: 10, includeChildren: false }).map((e) => e.id),
    ).toEqual([second.id, missed.id, first.id]);
    expect(repo.listForDefinition(definition.id, { limit: 10, includeChildren: true })).toHaveLength(4);
    expect(repo.listForDefinition(definition.id, { limit: 1, includeChildren: true })).toHaveLength(1);
    expect(repo.listForDefinition(definition.id, { limit: 'all', includeChildren: true })).toHaveLength(4);
    expect(
      repo
        .listByStatus(['running'])
        .map((e) => e.id)
        .sort(),
    ).toEqual([second.id, child.id].sort());
    expect(repo.lastScheduledFiring(definition.id)).toBe('2026-10-14T12:00:01.000Z');
    expect(repo.lastScheduledFiring('none')).toBeNull();
  });

  it('setStatus and patch write only the keys given; error_text is URL-stripped; requestCancel and resetAutoResume', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const repo = new ExecutionsRepo(db, clock);
    const { definition, execution } = newExecution(db, clock);
    repo.patch(execution.id, { stage: 'discovery' });
    repo.setStatus(execution.id, 'paused_error', {
      resumeAfter: at('2026-10-14T13:00:00.000Z'),
      errorText:
        'SQLITE_FULL: database or disk is full while fetching https://user:pw@api.example.com/v1/x?api_key=SECRET',
    });
    expect(repo.get(execution.id)).toMatchObject({
      status: 'paused_error',
      stage: 'discovery',
      resumeAfter: '2026-10-14T13:00:00.000Z',
      errorText: 'SQLITE_FULL: database or disk is full while fetching https://api.example.com/v1/x',
    });
    repo.patch(execution.id, {
      snapshot: { ...snapshotOf(definition), budget: { maxCalls: 5, maxFreeCalls: 5, maxCostMicroGbp: 0 } },
      startedAt: at('2026-10-14T12:30:00.000Z'),
    });
    expect(repo.get(execution.id)).toMatchObject({
      status: 'paused_error',
      startedAt: '2026-10-14T12:30:00.000Z',
      snapshot: { budget: { maxCalls: 5 } },
    });
    repo.requestCancel(execution.id);
    expect(repo.get(execution.id)?.cancelRequested).toBe(true);
    repo.incrementAutoResume(execution.id);
    repo.resetAutoResume(execution.id);
    expect(repo.get(execution.id)?.autoResumeCount).toBe(0);
    expect(() => repo.setStatus('missing', 'running')).toThrow(RowRejected);
  });

  it('claimResume is a compare-and-set that clears resume_after, cancel_requested and finished_at; conflicting claims lose', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const repo = new ExecutionsRepo(db, clock);
    const { definition, execution } = newExecution(db, clock);
    repo.requestCancel(execution.id);
    repo.setStatus(execution.id, 'cancelled', {
      finishedAt: T0,
      resumeAfter: at('2026-11-01T00:00:00.000Z'),
    });
    expect(repo.claimResume(execution.id)).toBe(true);
    expect(repo.get(execution.id)).toMatchObject({
      status: 'running',
      resumeAfter: null,
      cancelRequested: false,
      finishedAt: null,
    }); // dm-004
    expect(repo.claimResume(execution.id)).toBe(false);
    repo.setStatus(execution.id, 'completed');
    const other = newExecution(db, clock, { definition }).execution;
    expect(repo.claimResume(execution.id)).toBe(false); // another parent is active: the partial index refuses, the claim loses
    expect(repo.get(execution.id)?.status).toBe('completed');
    expect(repo.claimResume(other.id)).toBe(false);
    expect(repo.claimResume('missing')).toBe(false);
  });

  it('two repositories on two connections to one file: the second claim loses', () => {
    const path = tmpDbPath();
    const a = freshDb(path);
    const b = openTracked(path);
    const clock = fixedClock(T0);
    const { execution } = newExecution(a, clock);
    new ExecutionsRepo(a, clock).setStatus(execution.id, 'interrupted');
    expect(new ExecutionsRepo(b, clock).get(execution.id)?.status).toBe('interrupted');
    expect(new ExecutionsRepo(a, clock).claimResume(execution.id)).toBe(true);
    expect(new ExecutionsRepo(b, clock).claimResume(execution.id)).toBe(false);
  });

  it('two concurrent claimers in two threads: exactly one wins, every round', async () => {
    const path = tmpDbPath();
    const db = freshDb(path);
    const clock = fixedClock(T0);
    const repo = new ExecutionsRepo(db, clock);
    const { definition } = newExecution(db, clock, { status: 'skipped_window' });
    const contender = (id: string, barrier: SharedArrayBuffer) =>
      new Promise<number>((resolve, reject) => {
        const w = new Worker(new URL('./helpers/claim-worker.mjs', import.meta.url), {
          workerData: { path, sql: CLAIM_RESUME_SQL, id, barrier },
        });
        w.once('message', resolve);
        w.once('error', reject);
      });
    for (let round = 0; round < 10; round++) {
      const { execution } = newExecution(db, clock, { definition });
      repo.setStatus(execution.id, 'interrupted');
      const barrier = new SharedArrayBuffer(4);
      const results = await Promise.all([contender(execution.id, barrier), contender(execution.id, barrier)]);
      expect(results.sort()).toEqual([0, 1]);
      expect(repo.get(execution.id)?.status).toBe('running');
      repo.setStatus(execution.id, 'completed');
    }
  }, 30_000);

  it('bootSweep: running and pending-created-before-boot become interrupted with auto_resume_count + 1', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const repo = new ExecutionsRepo(db, clock);
    const { definition, execution: running } = newExecution(db, clock);
    const oldPending = newExecution(db, clock, { definition, status: 'pending', cell: cell() }).execution;
    const paused = newExecution(db, clock, { definition, cell: cell(undefined, EWR) }).execution;
    repo.setStatus(paused.id, 'paused_budget');
    clock.advance(60_000);
    const boot = clock.now();
    const freshPending = newExecution(db, clock, {
      definition,
      status: 'pending',
      cell: cell(undefined, undefined, '2027-03-15', '2027-03-29'),
    }).execution;
    expect(repo.bootSweep(boot).interrupted.sort()).toEqual([oldPending.id, running.id].sort());
    expect(repo.get(running.id)).toMatchObject({ status: 'interrupted', autoResumeCount: 1 });
    expect(repo.get(oldPending.id)).toMatchObject({ status: 'interrupted', autoResumeCount: 1 });
    expect(repo.get(freshPending.id)).toMatchObject({ status: 'pending', autoResumeCount: 0 });
    expect(repo.get(paused.id)).toMatchObject({ status: 'paused_budget', autoResumeCount: 0 });
    expect(repo.incrementAutoResume(running.id)).toBe(2);
    expect(() => repo.incrementAutoResume('missing')).toThrow(RowRejected);
  });
});
