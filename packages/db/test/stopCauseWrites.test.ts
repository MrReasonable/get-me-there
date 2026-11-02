// Spec revision 55 §7, §8.1 "Stop causes": the repository half of "every status write that stops or skips a run stores
// a cause, and the write that makes it pending, running or completed clears it". The engine half (which cause each
// stop writes) is packages/engine/test/stopWrites.test.ts.
import { asIsoDateTime, fixedClock, type StopCause } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { RowCorrupt } from '../src/internal/read.js';
import { RowRejected } from '../src/internal/validate.js';
import { CLAIM_RESUME_SQL, ExecutionsRepo } from '../src/repositories/executions.js';
import { freshDb, T0 } from './helpers/db.js';
import { newExecution, snapshotOf } from './helpers/factories.js';

beforeEach(() => {
  expect.hasAssertions();
});

const BUDGET: StopCause = {
  kind: 'budget',
  scope: 'execution-calls',
  providerId: 'searchapi',
  unit: 'calls',
  cap: 40,
  resumeAfter: null,
  resetsAt: null,
  flights: null,
};

function setup() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const repo = new ExecutionsRepo(db, clock);
  const { execution, definition } = newExecution(db, clock);
  return { db, clock, repo, id: execution.id, definition };
}

const causeOf = (db: ReturnType<typeof freshDb>, id: string) =>
  db.raw
    .prepare<[string], { stop_cause_json: string | null; error_text: string | null }>(
      'SELECT stop_cause_json, error_text FROM search_executions WHERE id = ?',
    )
    .get(id);

describe('ExecutionsRepo stop causes (spec revision 55 §7)', () => {
  it('setStatus stores a cause with its sentence and reads it back through the strict schema', () => {
    const { repo, id } = setup();
    repo.setStatus(id, 'paused_budget', {
      stopCause: BUDGET,
      errorText: 'This search stopped at its limit of calls for one run.',
    });
    expect(repo.get(id)).toMatchObject({
      status: 'paused_budget',
      stopCause: BUDGET,
      errorText: 'This search stopped at its limit of calls for one run.',
    });
  });

  it.each(['pending', 'running', 'completed'] as const)(
    'a write that makes the row %s clears the stored cause',
    (status) => {
      const { db, repo, id } = setup();
      repo.setStatus(id, 'paused_error', { stopCause: { kind: 'fatal' }, errorText: 'x' });
      repo.setStatus(id, status);
      expect(causeOf(db, id)?.stop_cause_json).toBeNull();
      expect(repo.get(id)?.stopCause).toBeNull();
    },
  );

  it('a patch with no status, or a stopped status with no cause in the patch, keeps the stored cause', () => {
    const { repo, id } = setup();
    repo.setStatus(id, 'paused_error', { stopCause: { kind: 'fatal' }, errorText: 'x' });
    repo.patch(id, { stage: 'verification' });
    expect(repo.get(id)?.stopCause).toEqual({ kind: 'fatal' });
    repo.setStatus(id, 'cancelled', { stopCause: { kind: 'cancelled' }, errorText: 'Stopped by you.' });
    expect(repo.get(id)?.stopCause).toEqual({ kind: 'cancelled' });
  });

  it('the resume claim clears it, so a run paused with a cause, resumed and completed reads NULL', () => {
    const { db, repo, id } = setup();
    expect(CLAIM_RESUME_SQL).toContain('stop_cause_json = NULL');
    repo.setStatus(id, 'paused_budget', { stopCause: BUDGET, errorText: 'x' });
    expect(repo.claimResume(id)).toBe(true);
    expect(repo.get(id)).toMatchObject({ status: 'running', stopCause: null });
    repo.setStatus(id, 'completed', { finishedAt: T0, errorText: null });
    expect(causeOf(db, id)).toEqual({ stop_cause_json: null, error_text: null });
  });

  it("the boot sweep's UPDATE writes the interrupted cause and its sentence", () => {
    const { repo, id } = setup();
    expect(repo.bootSweep(asIsoDateTime('2026-10-14T13:00:00.000Z')).interrupted).toEqual([id]);
    expect(repo.get(id)).toMatchObject({
      status: 'interrupted',
      stopCause: { kind: 'interrupted' },
      errorText: 'The app stopped during this search.',
    });
  });

  it.each<[Extract<StopCause, { kind: 'cancelled' | 'superseded' }>, string]>([
    [{ kind: 'cancelled' }, 'Stopped by you.'],
    [{ kind: 'superseded', by: 'schedule' }, 'Replaced by a scheduled run.'],
    [{ kind: 'superseded', by: 'search-again' }, 'Replaced by a search you started.'],
    [{ kind: 'superseded', by: 'remove' }, 'Stopped when the search was removed.'],
  ])('cancelPaused stores %j with its own sentence', (cause, sentence) => {
    const { repo, id } = setup();
    repo.setStatus(id, 'paused_error', { stopCause: { kind: 'fatal' }, errorText: 'x' });
    expect(repo.cancelPaused(id, cause)).toBe(true);
    expect(repo.get(id)).toMatchObject({ status: 'cancelled', stopCause: cause, errorText: sentence });
  });

  it('a skipped row is created with its cause and sentence; a running one refuses a cause', () => {
    const { repo, definition } = setup();
    const input = {
      definitionId: definition.id,
      isChild: false,
      cell: null,
      snapshot: snapshotOf(definition),
      estimate: null,
      trigger: 'schedule' as const,
    };
    const skipped = repo.create({
      ...input,
      status: 'skipped_window',
      stopCause: { kind: 'skipped-window' },
      errorText: 'Skipped: the window has no departure dates left.',
    });
    expect(repo.get(skipped.id)).toMatchObject({
      stopCause: { kind: 'skipped-window' },
      errorText: 'Skipped: the window has no departure dates left.',
    });
    expect(() => repo.create({ ...input, status: 'pending', stopCause: { kind: 'fatal' } })).toThrow(
      RowRejected,
    );
  });

  // why: the write side parses with the reader's own strict schemas, so a shape the reader would refuse (here free text
  // riding along) is never stored, and one bad row can never make every later read of it throw RowCorrupt
  it('a cause or flight-list plan the strict reader would refuse is refused on write, and nothing is stored', () => {
    const { db, repo, id, definition } = setup();
    const loose = { ...BUDGET, note: 'vendor said no' };
    expect(() => repo.setStatus(id, 'paused_budget', { stopCause: loose, errorText: 'x' })).toThrow(
      RowRejected,
    );
    expect(repo.get(id)?.status).toBe('running');
    expect(causeOf(db, id)?.stop_cause_json).toBeNull();
    const plan = {
      planned: 1,
      cells: [],
      reused: 0,
      ended: null,
      returns: false,
      booking: false,
      returnsStopped: null,
      bookingStopped: null,
      note: 'free text',
    };
    expect(() => repo.patch(id, { flightLists: plan })).toThrow(RowRejected);
    expect(repo.get(id)?.flightLists).toBeNull();
    const skippedWith = { kind: 'skipped-window', note: 'free text' } as const;
    expect(() =>
      repo.create({
        definitionId: definition.id,
        isChild: false,
        cell: null,
        snapshot: snapshotOf(definition),
        estimate: null,
        trigger: 'schedule',
        status: 'skipped_window',
        stopCause: skippedWith,
      }),
    ).toThrow(RowRejected);
  });

  it('a stored cause that is not a cause reads as corrupt, never as text', () => {
    const { db, repo, id } = setup();
    db.raw
      .prepare('UPDATE search_executions SET stop_cause_json = ? WHERE id = ?')
      .run('{"kind":"cancelled","note":"vendor said no"}', id);
    expect(() => repo.get(id)).toThrow(RowCorrupt);
  });
});
