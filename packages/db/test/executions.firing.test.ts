// The firing unique index through the repository (spec §7 rev 36; decision 79; WP16a Task 16a.1): a scheduled start or
// skip inserts with ON CONFLICT … DO NOTHING, so the loser of a race records nothing, while the active-parent clash and
// a CHECK failure still surface. The worked example only.
import { asIata, asIsoDateTime, fixedClock, type IsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { RowRejected } from '../src/internal/validate.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import type { ExecutionCreateInput } from '../src/types.js';
import { count, freshDb, sqliteCode, T0 } from './helpers/db.js';
import { cell, exampleDefinitionInput, snapshotOf } from './helpers/factories.js';

beforeEach(() => {
  expect.hasAssertions();
});

const F1 = asIsoDateTime('2027-03-29T00:30:00.000Z');
const F2 = asIsoDateTime('2027-04-05T00:30:00.000Z');

function setup(): {
  db: Db;
  repo: ExecutionsRepo;
  input: (o?: Partial<ExecutionCreateInput>) => ExecutionCreateInput;
  firing: (
    f: IsoDateTime,
    o?: Partial<ExecutionCreateInput>,
  ) => ExecutionCreateInput & { scheduledFor: IsoDateTime };
  other: string;
} {
  const db = freshDb();
  const clock = fixedClock(T0);
  const defs = new DefinitionsRepo(db, clock);
  const def = defs.create(exampleDefinitionInput());
  const other = defs.create(exampleDefinitionInput({ name: 'London to New York, again' })).id;
  const repo = new ExecutionsRepo(db, clock);
  const input = (o: Partial<ExecutionCreateInput> = {}): ExecutionCreateInput => ({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot: snapshotOf(def),
    estimate: null,
    trigger: 'schedule',
    status: 'skipped_budget',
    ...o,
  });
  return { db, repo, other, input, firing: (f, o = {}) => ({ ...input(o), scheduledFor: f }) };
}

describe('ExecutionsRepo firing insert (spec §7 firing unique index)', () => {
  it('createForFiring stores the firing, the catch-up flag, the window end and the skip code, and reads them back', () => {
    const { repo, firing } = setup();
    const e = repo.createForFiring(
      firing(F1, { status: 'skipped_missed', isCatchUp: true, skipCode: 'half-cadence' }),
    );
    expect(e).toMatchObject({
      scheduledFor: F1,
      isCatchUp: true,
      skipCode: 'half-cadence',
      browserWindowEnd: null,
    });
    const run = repo.createForFiring(
      firing(F2, {
        status: 'running',

        browserWindowEnd: asIsoDateTime('2027-04-05T02:00:00.000Z'),
      }),
    );
    expect(run).toMatchObject({
      scheduledFor: F2,
      isCatchUp: false,
      skipCode: null,
      browserWindowEnd: '2027-04-05T02:00:00.000Z',
    });
    if (run === null) throw new Error('expected a row');
    expect(repo.get(run.id)).toEqual(run);
  });

  it('a second insert of the same (definition, firing) is a no-op returning null: nothing written, whatever its status', () => {
    const { db, repo, input, firing } = setup();
    expect(repo.createForFiring(firing(F1))).not.toBeNull();
    expect(repo.createForFiring(firing(F1, { status: 'skipped_confirm' }))).toBeNull();
    expect(repo.createForFiring(firing(F1, { status: 'running', isCatchUp: true }))).toBeNull();
    expect(count(db, 'search_executions')).toBe(1);
    expect(repo.firingTaken(input().definitionId, F1)).toBe(true);
    expect(repo.firingTaken(input().definitionId, F2)).toBe(false);
  });

  it('a raw second INSERT of the same (definition_id, scheduled_for) on a parent fails with the unique constraint', () => {
    const { db, repo, input, firing } = setup();
    repo.createForFiring(firing(F1));
    expect(
      sqliteCode(() =>
        db.raw
          .prepare(
            `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, finished_at, scheduled_for)
             VALUES ('raw', @d, '{}', 'schedule', 'skipped_budget', @at, @at, @f)`,
          )
          .run({ d: input().definitionId, at: T0, f: F1 }),
      ),
    ).toBe('SQLITE_CONSTRAINT_UNIQUE');
  });

  it('two rows with no firing both insert; the same instant on another definition inserts', () => {
    const { repo, input, other, firing } = setup();
    repo.create(input());
    repo.create(input());
    expect(repo.createForFiring(firing(F1))).not.toBeNull();
    expect(repo.createForFiring(firing(F1, { definitionId: other }))).not.toBeNull();
  });

  it('a child never carries a firing (CHECK), and children never collide on one', () => {
    const { db, repo, input, firing } = setup();
    repo.createForFiring(firing(F1));
    const child = repo.create(input({ isChild: true, cell: cell(), status: 'running', trigger: 'manual' }));
    expect(child.scheduledFor).toBeNull();
    expect(() =>
      repo.createForFiring(firing(F2, { isChild: true, cell: cell(asIata('LGW')), status: 'running' })),
    ).toThrow(/CHECK/);
    expect(count(db, 'search_executions')).toBe(2);
  });

  it('an active-parent clash on a firing insert still throws RowRejected active (not swallowed), and a CHECK failure still throws', () => {
    const { repo, input, firing } = setup();
    repo.create(input({ status: 'running', trigger: 'manual' }));
    let rule: string | null = null;
    try {
      repo.createForFiring(firing(F1, { status: 'running' }));
    } catch (e) {
      if (e instanceof RowRejected) rule = e.rule;
      else throw e;
    }
    expect(rule).toBe('active');
    expect(repo.firingTaken(input().definitionId, F1)).toBe(false);
    // why: a skip code on a status other than skipped_missed is a CHECK failure, never a silent no-op
    expect(() =>
      repo.createForFiring(firing(F2, { status: 'skipped_budget', skipCode: 'half-cadence' })),
    ).toThrow(/CHECK/);
  });

  it('create refuses a firing: every scheduled start or skip goes through createForFiring', () => {
    const { repo, firing } = setup();
    expect(() => repo.create(firing(F1))).toThrow(RowRejected);
  });

  const END1 = asIsoDateTime('2027-03-29T02:00:00.000Z');
  const END2 = asIsoDateTime('2027-04-05T02:00:00.000Z');
  it('reanchorFiring sets a paused run’s firing and window end in one statement, only when no other parent row of the definition holds the firing', () => {
    const { repo, input, firing } = setup();
    const paused = repo.create(input({ status: 'running', trigger: 'manual' }));
    repo.setStatus(paused.id, 'paused_budget');
    expect(repo.reanchorFiring(paused.id, F1, END1)).toBe(true);
    expect(repo.get(paused.id)).toMatchObject({ scheduledFor: F1, browserWindowEnd: END1 });
    // the firing the row already holds is no other row's: a no-op that succeeds
    expect(repo.reanchorFiring(paused.id, F1, END1)).toBe(true);
    repo.setStatus(paused.id, 'cancelled', { finishedAt: T0 });
    repo.createForFiring(firing(F2));
    const again = repo.create(input({ status: 'running', trigger: 'manual' }));
    expect(repo.reanchorFiring(again.id, F2, END2)).toBe(false);
    expect(repo.get(again.id)).toMatchObject({ scheduledFor: null, browserWindowEnd: null });
    expect(repo.reanchorFiring(again.id, F1, END1)).toBe(false); // the cancelled row still holds F1
  });

  it('reanchorFiring never moves a catch-up (it names the firing it missed) or a child', () => {
    const { repo, input, firing } = setup();
    const catchUp = repo.createForFiring(firing(F1, { status: 'running', isCatchUp: true }));
    if (catchUp === null) throw new Error('not written');
    repo.setStatus(catchUp.id, 'paused_budget');
    expect(repo.reanchorFiring(catchUp.id, F2, END2)).toBe(false);
    expect(repo.get(catchUp.id)).toMatchObject({ scheduledFor: F1, browserWindowEnd: null });
    const child = repo.create(
      input({
        status: 'running',
        trigger: 'manual',
        isChild: true,
        cell: cell(asIata('LHR'), asIata('JFK')),
      }),
    );
    expect(repo.reanchorFiring(child.id, F2, END2)).toBe(false);
  });

  it.each(['paused_budget', 'paused_error', 'interrupted'] as const)(
    'cancelPaused cancels a %s run with its finish time and why, and nothing that is running or finished',
    (status) => {
      const { repo, input } = setup();
      const e = repo.create(input({ status: 'running', trigger: 'manual' }));
      repo.setStatus(e.id, status, { resumeAfter: asIsoDateTime('2027-04-01T00:00:00.000Z') });
      expect(repo.cancelPaused(e.id, 'superseded by the next firing')).toBe(true);
      expect(repo.get(e.id)).toMatchObject({
        status: 'cancelled',
        finishedAt: T0,
        resumeAfter: null,
        errorText: 'superseded by the next firing',
      });
      expect(repo.cancelPaused(e.id, 'again')).toBe(false);
      const running = repo.create(input({ status: 'running', trigger: 'manual' }));
      expect(repo.cancelPaused(running.id, 'no')).toBe(false);
      expect(repo.get(running.id)?.status).toBe('running');
    },
  );

  it('patch writes browserWindowEnd', () => {
    const { repo, input } = setup();
    const e = repo.create(input({ status: 'running', trigger: 'manual' }));
    const end = asIsoDateTime('2027-03-29T03:00:00.000Z');
    repo.patch(e.id, { browserWindowEnd: end });
    expect(repo.get(e.id)?.browserWindowEnd).toBe(end);
    repo.patch(e.id, { browserWindowEnd: null });
    expect(repo.get(e.id)?.browserWindowEnd).toBeNull();
  });
});

describe('ExecutionsRepo.coversFiring (spec §8.2 rev 36, decision 79: the coverage read)', () => {
  const at = (s: string) => asIsoDateTime(s);
  /** A parent row written directly with the given times, as earlier passes would have left it. */
  function row(
    db: Db,
    definitionId: string,
    p: {
      status: string;
      created: string;
      started?: string | null;
      finished?: string | null;
      firing?: string;
      catchUp?: boolean;
      paused?: string;
    },
  ): void {
    db.raw
      .prepare(
        `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at, started_at, finished_at, scheduled_for, is_catch_up, paused_at)
         VALUES (lower(hex(randomblob(8))), @d, '{}', 'schedule', @status, @created, @started, @finished, @firing, @catchUp, @paused)`,
      )
      .run({
        d: definitionId,
        status: p.status,
        created: p.created,
        started: p.started === undefined ? p.created : p.started,
        finished: p.finished ?? null,
        firing: p.firing ?? null,
        catchUp: p.catchUp === true ? 1 : 0,
        paused: p.paused ?? null,
      });
  }
  const F = at('2027-03-29T00:30:00.000Z');

  it('no row: uncovered; a row carrying the firing: covered, whatever its status', () => {
    const { db, repo, input } = setup();
    const d = input().definitionId;
    expect(repo.coversFiring(d, F)).toBe(false);
    row(db, d, {
      status: 'skipped_budget',
      created: '2027-03-30T09:00:00.000Z',
      finished: '2027-03-30T09:00:00.000Z',
      firing: F,
    });
    expect(repo.coversFiring(d, F)).toBe(true);
  });

  it('a run finished before the firing does not cover it; one created after it does (manual included)', () => {
    const { db, repo, input, other } = setup();
    const d = input().definitionId;
    row(db, d, {
      status: 'completed',
      created: '2027-03-28T00:00:00.000Z',
      finished: '2027-03-29T00:29:59.999Z',
    });
    expect(repo.coversFiring(d, F)).toBe(false);
    row(db, other, {
      status: 'completed',
      created: '2027-03-29T09:00:00.000Z',
      finished: '2027-03-29T10:00:00.000Z',
    });
    expect(repo.coversFiring(d, F)).toBe(false); // another definition's run
    row(db, d, {
      status: 'completed',
      created: '2027-03-29T00:30:00.001Z',
      finished: '2027-03-29T01:00:00.000Z',
    });
    expect(repo.coversFiring(d, F)).toBe(true);
  });

  it('a run active at the firing covers it: finished at or after it, or not finished (paused, interrupted)', () => {
    const a = setup();
    row(a.db, a.input().definitionId, {
      status: 'completed',
      created: '2027-03-29T00:00:00.000Z',
      finished: F,
    });
    expect(a.repo.coversFiring(a.input().definitionId, F)).toBe(true);
    const b = setup();
    row(b.db, b.input().definitionId, { status: 'paused_budget', created: '2027-03-28T00:00:00.000Z' });
    expect(b.repo.coversFiring(b.input().definitionId, F)).toBe(true);
    const c = setup();
    row(c.db, c.input().definitionId, { status: 'pending', created: F, started: null });
    expect(c.repo.coversFiring(c.input().definitionId, F)).toBe(true);
  });

  it.each(['paused_budget', 'paused_error', 'interrupted'])(
    'a %s catch-up that stopped running at or before the firing never covers it (that firing’s row supersedes it); one that stopped after it covered it',
    (status) => {
      const { db, repo, input } = setup();
      const d = input().definitionId;
      const after = setup();
      for (const [r, paused] of [
        [{ db, d }, '2027-03-29T00:30:00.000Z'],
        [{ db: after.db, d: after.input().definitionId }, '2027-03-29T00:30:00.001Z'],
      ] as const)
        row(r.db, r.d, {
          status,
          created: '2027-03-22T07:00:00.000Z',
          firing: '2027-03-22T00:30:00.000Z',
          catchUp: true,
          paused,
        });
      expect(repo.coversFiring(d, F)).toBe(false);
      expect(after.repo.coversFiring(after.input().definitionId, F)).toBe(true);
    },
  );

  it.each(['running', 'completed', 'cancelled'])(
    'a %s catch-up in flight at a later firing (never paused) covers it like any other run, from stored facts alone',
    (status) => {
      const { db, repo, input } = setup();
      const d = input().definitionId;
      row(db, d, {
        status,
        created: '2027-03-29T00:20:00.000Z',
        finished: status === 'running' ? null : '2027-03-29T09:00:00.000Z',
        firing: '2027-03-29T00:00:00.000Z',
        catchUp: true,
      });
      expect(repo.coversFiring(d, F)).toBe(true);
    },
  );

  it('a catch-up paused at the firing and cancelled since still does not cover it; a manual run paused there does', () => {
    const { db, repo, input } = setup();
    const d = input().definitionId;
    row(db, d, {
      status: 'cancelled',
      created: '2027-03-29T00:20:00.000Z',
      finished: '2027-03-29T09:00:00.000Z',
      firing: '2027-03-29T00:00:00.000Z',
      catchUp: true,
      paused: '2027-03-29T00:25:00.000Z',
    });
    expect(repo.coversFiring(d, F)).toBe(false);
    const manual = setup();
    row(manual.db, manual.input().definitionId, {
      status: 'paused_error',
      created: '2027-03-29T00:20:00.000Z',
      paused: '2027-03-29T00:25:00.000Z',
    });
    expect(manual.repo.coversFiring(manual.input().definitionId, F)).toBe(true);
  });

  it('a run the caller has just superseded for this firing (`except`) covers nothing; any other still does', () => {
    const { db, repo, input } = setup();
    const d = input().definitionId;
    row(db, d, {
      status: 'cancelled',
      created: '2027-03-21T00:00:00.000Z',
      finished: '2027-03-29T09:00:00.000Z',
    });
    const replaced = db.raw
      .prepare<[string], { id: string }>('SELECT id FROM search_executions WHERE definition_id = ?')
      .get(d)?.id;
    if (replaced === undefined) throw new Error('no row');
    expect(repo.coversFiring(d, F)).toBe(true);
    expect(repo.coversFiring(d, F, replaced)).toBe(false);
    expect(repo.coversFiring(d, F, 'some-other-id')).toBe(true);
  });
});
