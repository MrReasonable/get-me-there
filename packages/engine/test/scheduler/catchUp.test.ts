// The catch-up (spec §8.2 rev 36; plan decision 79; WP16a Task 16a.2): a missed scheduled firing, a late live tick
// included, is caught up at most once, never twice, not when the next firing is near, and never with a browser page.
// Fake or fixed clocks and literal UTC instants throughout; no expected instant is computed through croner. The croner
// instants below were recorded from croner 10.0.1 for Europe/London (the task's first step). Worked example only.
import {
  asIsoDate,
  asIsoDateTime,
  type DefinitionInput,
  type SearchDefinition,
  SKIP_CODE_TEXT,
} from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { createEngine } from '../../src/index.js';
import {
  autoResumeYields,
  catchUpAll,
  catchUpDefinition,
  findMissedFiring,
  halfCadenceSkip,
} from '../../src/scheduler/catchUp.js';
import { SUPERSEDED_BY_FIRING } from '../../src/scheduler/catchUpStart.js';
import { firingsBetween } from '../../src/scheduler/parseCron.js';
import { buildSnapshot } from '../../src/snapshot.js';
import { engineWith, stubCamoufox, stubTravelpayouts } from '../support/camoufox.js';
import { frankfurterBody, stubFrankfurter } from '../support/fx.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_RULES,
  type Harness,
  JFK,
  LGW,
  LHR,
  verificationOnly,
} from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const at = asIsoDateTime;
/** A relative window, so a run in 2027 still has departure dates ahead of it. */
const RELATIVE = { kind: 'relative', startOffsetDays: 7, lengthDays: 14 } as const;
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

/** A definition on `cron`, created (and last changed) at `createdAt`, with the clock left there. */
function defined(
  h: Harness,
  cron: string,
  createdAt: string,
  patch: Partial<DefinitionInput> = {},
): SearchDefinition {
  h.clock.set(at(createdAt));
  return h.createDefinition({ scheduleCron: cron, window: RELATIVE, ...patch });
}
const decide = (h: Harness, def: SearchDefinition, now: string) =>
  findMissedFiring(buildContext(h.deps, h.options), def, at(now));
/** One catch-up pass at `now`, as the minute job or the boot makes it. */
async function catchUpAt(h: Harness, def: SearchDefinition, now: string) {
  h.clock.set(at(now));
  const orch = h.orch();
  const found = await catchUpDefinition(buildContext(h.deps, h.options), orch, def, at(now));
  return { found, orch };
}

describe('halfCadenceSkip (spec §8.2: (next − now) < (next − firing) / 2)', () => {
  it('skips one ms under half the gap, catches up at exactly half and one ms over', () => {
    const firing = Date.parse('2027-03-01T06:00:00.000Z');
    const next = Date.parse('2027-03-08T06:00:00.000Z');
    const half = Date.parse('2027-03-04T18:00:00.000Z');
    expect(halfCadenceSkip(firing, next, half + 1)).toBe(true);
    expect(halfCadenceSkip(firing, next, half)).toBe(false);
    expect(halfCadenceSkip(firing, next, half - 1)).toBe(false);
    expect(halfCadenceSkip(firing, next, next)).toBe(true);
    expect(halfCadenceSkip(firing, next, firing)).toBe(false);
  });
});

describe('findMissedFiring: the cadence is the next expected firing minus the missed one (decision 79)', () => {
  it.each([
    // [label, cron, created, now, expected]
    [
      'weekly, one ms under half',
      '0 6 * * 1',
      '2027-02-28T00:00:00.000Z',
      '2027-03-04T18:00:00.001Z',
      'half-cadence',
    ],
    ['weekly, exactly half', '0 6 * * 1', '2027-02-28T00:00:00.000Z', '2027-03-04T18:00:00.000Z', 'catch-up'],
    [
      'weekly, one ms over half',
      '0 6 * * 1',
      '2027-02-28T00:00:00.000Z',
      '2027-03-04T17:59:59.999Z',
      'catch-up',
    ],
    // Monday 1 Mar → Thursday 4 Mar is 72 h; Thursday → Monday 8 Mar is 96 h
    [
      'Mon/Thu, a Monday missed with 36 h to Thursday',
      '0 6 * * 1,4',
      '2027-02-28T00:00:00.000Z',
      '2027-03-02T18:00:00.000Z',
      'catch-up',
    ],
    [
      'Mon/Thu, a Monday missed with 35 h 59 m to Thursday',
      '0 6 * * 1,4',
      '2027-02-28T00:00:00.000Z',
      '2027-03-02T18:01:00.000Z',
      'half-cadence',
    ],
    [
      'Mon/Thu, a Thursday uses its 96 h gap (48 h left)',
      '0 6 * * 1,4',
      '2027-03-03T00:00:00.000Z',
      '2027-03-06T06:00:00.000Z',
      'catch-up',
    ],
    [
      'Mon/Thu, a Thursday uses its 96 h gap (one ms under)',
      '0 6 * * 1,4',
      '2027-03-03T00:00:00.000Z',
      '2027-03-06T06:00:00.001Z',
      'half-cadence',
    ],
    // 1 Mar 06:00 GMT → 1 Apr 05:00 UTC (06:00 BST) is 743 h; 1 Apr → 1 May is 720 h
    [
      'monthly across a 31-day month (half is 371.5 h)',
      '0 6 1 * *',
      '2027-02-28T00:00:00.000Z',
      '2027-03-16T17:30:00.000Z',
      'catch-up',
    ],
    [
      'monthly across a 31-day month, one ms under',
      '0 6 1 * *',
      '2027-02-28T00:00:00.000Z',
      '2027-03-16T17:30:00.001Z',
      'half-cadence',
    ],
    [
      'monthly across a 30-day month (half is 360 h)',
      '0 6 1 * *',
      '2027-03-31T00:00:00.000Z',
      '2027-04-16T05:00:00.000Z',
      'catch-up',
    ],
    [
      'monthly across a 30-day month, one ms under',
      '0 6 1 * *',
      '2027-03-31T00:00:00.000Z',
      '2027-04-16T05:00:00.001Z',
      'half-cadence',
    ],
    // daily 06:00 London: 27 Mar 06:00Z → 28 Mar 05:00Z is 23 h; 30 Oct 05:00Z → 31 Oct 06:00Z is 25 h
    [
      'daily across the spring change (23 h gap)',
      '0 6 * * *',
      '2027-03-26T12:00:00.000Z',
      '2027-03-27T17:30:00.000Z',
      'catch-up',
    ],
    [
      'daily across the spring change, one ms under',
      '0 6 * * *',
      '2027-03-26T12:00:00.000Z',
      '2027-03-27T17:30:00.001Z',
      'half-cadence',
    ],
    [
      'daily across the autumn change (25 h gap)',
      '0 6 * * *',
      '2027-10-29T12:00:00.000Z',
      '2027-10-30T17:30:00.000Z',
      'catch-up',
    ],
    [
      'daily across the autumn change, one ms under',
      '0 6 * * *',
      '2027-10-29T12:00:00.000Z',
      '2027-10-30T17:30:00.001Z',
      'half-cadence',
    ],
    // weekdays: Friday 5 Mar 09:00Z → Monday 8 Mar 09:00Z is 72 h
    [
      'weekdays, a Friday uses its 72 h gap to Monday',
      '0 9 * * 1-5',
      '2027-03-04T12:00:00.000Z',
      '2027-03-06T21:00:00.000Z',
      'catch-up',
    ],
    [
      'weekdays, a Friday one ms under half its gap',
      '0 9 * * 1-5',
      '2027-03-04T12:00:00.000Z',
      '2027-03-06T21:00:00.001Z',
      'half-cadence',
    ],
  ] as const)('%s', (_label, cron, created, now, expected) => {
    const h = createHarness();
    const def = defined(h, cron, created);
    const found = decide(h, def, now);
    expect(found.kind === 'skip' ? found.reason : found.kind).toBe(expected);
  });

  it('a firing 2 minutes old or less is not missed (the grace a punctual live tick has to insert its own row)', () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    expect(decide(h, def, '2027-03-01T06:02:00.000Z')).toEqual({ kind: 'none' });
    expect(decide(h, def, '2027-03-01T06:02:00.001Z')).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });

  it('an unscheduled, disabled or deleted definition has no missed firing', () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    expect(decide(h, { ...def, scheduleCron: null }, '2027-03-01T08:00:00.000Z')).toEqual({ kind: 'none' });
    expect(decide(h, { ...def, enabled: false }, '2027-03-01T08:00:00.000Z')).toEqual({ kind: 'none' });
    expect(
      decide(h, { ...def, deletedAt: at('2027-03-01T01:00:00.000Z') }, '2027-03-01T08:00:00.000Z'),
    ).toEqual({
      kind: 'none',
    });
    expect(decide(h, { ...def, scheduleCron: '*/5 * * * *' }, '2027-03-01T08:00:00.000Z')).toEqual({
      kind: 'none',
    });
  });
});

describe('catching up (decision 79): once, for the latest firing, through the normal start', () => {
  it('asleep across one firing: one catch-up with scheduled_for the firing and is_catch_up set, and it runs', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    const { found } = await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    expect(found).toEqual({ kind: 'catch-up', firing: '2027-03-01T06:00:00.000Z' });
    const [run, ...rest] = executions(h, def.id);
    expect(rest).toEqual([]);
    if (run === undefined) throw new Error('no catch-up');
    expect(run).toMatchObject({
      trigger: 'schedule',
      scheduledFor: '2027-03-01T06:00:00.000Z',
      isCatchUp: true,
    });
    expect((await h.waitForSettled(run.id)).status).toBe('completed');
    expect(h.requests.length).toBeGreaterThan(0);
  });

  it('asleep across three firings: one run, for the latest', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-02-26T12:00:00.000Z');
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', true],
    ]);
  });

  it('weekly, missed 6 of 7 days ago: skipped_missed with scheduled_for and skip_code half-cadence, notified once, no run', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * 1', '2027-02-28T00:00:00.000Z');
    await catchUpAt(h, def, '2027-03-07T06:00:00.000Z');
    await catchUpAt(h, def, '2027-03-07T06:01:00.000Z');
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor, e.skipCode])).toEqual([
      ['skipped_missed', '2027-03-01T06:00:00.000Z', 'half-cadence'],
    ]);
    expect(h.notifications.map((n) => n.kind)).toEqual(['skipped_missed']);
    expect(h.notifications[0]?.body).toContain(
      'The run scheduled for Mon, 1 Mar 2027, 06:00 (Europe/London) was not caught up: the next scheduled run was less than half the gap away.',
    );
    expect(h.requests).toEqual([]);
    expect(h.count('provider_requests')).toBe(0);
  });

  it('a manual run started after the firing covers it; so does a run active at the firing', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    h.clock.set(at('2027-03-01T07:00:00.000Z'));
    await h.runToCompletion(h.orch(), def.id);
    expect(decide(h, def, '2027-03-01T08:00:00.000Z')).toEqual({ kind: 'none' });
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    expect(executions(h, def.id).map((e) => e.trigger)).toEqual(['manual']);

    const h2 = createHarness();
    await h2.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def2 = defined(h2, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    h2.clock.set(at('2027-03-01T05:00:00.000Z'));
    const active = await h2.orch().start(def2.id, { trigger: 'manual' });
    if (!active.ok) throw new Error(active.message);
    await catchUpAt(h2, def2, '2027-03-01T08:00:00.000Z');
    expect(executions(h2, def2.id).map((e) => e.id)).toEqual([active.executionId]);
  });

  it('a definition edited after the firing: none; an edit to another definition does not stop it (positive control)', async () => {
    const h = createHarness();
    const edited = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', { name: 'edited' });
    const other = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', { name: 'untouched' });
    h.clock.set(at('2027-03-01T07:00:00.000Z'));
    const after = h.repos.definitions.update(edited.id, { name: 'edited after the firing' });
    if (after === null) throw new Error('no definition');
    expect(decide(h, after, '2027-03-01T08:00:00.000Z')).toEqual({ kind: 'none' });
    expect(decide(h, other, '2027-03-01T08:00:00.000Z')).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });

  it('no configured provider can run the definition on a schedule: no row, no run, no notice', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    const { found } = await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    expect(found).toEqual({ kind: 'none' });
    expect(executions(h, def.id)).toEqual([]);
    expect(h.notifications).toEqual([]);
  });

  it('a cap-refused catch-up met twice: one skipped_budget row carrying scheduled_for, one notice, never retried', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    await catchUpAt(h, def, '2027-03-01T08:01:00.000Z');
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor, e.isCatchUp])).toEqual([
      ['skipped_budget', '2027-03-01T06:00:00.000Z', false],
    ]);
    expect(h.notifications.map((n) => n.kind)).toEqual(['skipped_budget']);
  });

  it('the confirmation and the window refusals likewise each write one row carrying scheduled_for', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    await catchUpAt(h, def, '2027-03-01T08:01:00.000Z');
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor])).toEqual([
      ['skipped_confirm', '2027-03-01T06:00:00.000Z'],
    ]);
    const w = createHarness();
    const past = defined(w, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-15') },
    });
    await catchUpAt(w, past, '2027-03-01T08:00:00.000Z');
    await catchUpAt(w, past, '2027-03-01T08:01:00.000Z');
    expect(executions(w, past.id).map((e) => [e.status, e.scheduledFor])).toEqual([
      ['skipped_window', '2027-03-01T06:00:00.000Z'],
    ]);
    expect(w.notifications.map((n) => n.kind)).toEqual(['skipped_window']);
  });

  it('a paused catch-up at a firing does not cover it: that firing’s live tick supersedes it and starts the scheduled run', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      origins: [LHR, LGW],
      destinations: [JFK],
      budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    // why: as tick.test's execution-* pause: 3 calls spent by a concurrent pass leave room for 3 of the 4 tiles
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 3, costMicroGbpEach: 0, executionId: id }),
    );
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    const [paused] = executions(h, def.id);
    if (paused === undefined) throw new Error('no catch-up');
    expect(await h.waitForSettled(paused.id)).toMatchObject({ status: 'paused_budget', isCatchUp: true });
    h.clearHooks();
    h.clock.set(at('2027-03-02T06:00:00.000Z')); // the next firing, punctual
    await h.orch().tick(def.id);
    const rows = executions(h, def.id);
    expect(rows).toHaveLength(2);
    expect(h.repos.executions.get(paused.id)).toMatchObject({
      status: 'cancelled',
      errorText: SUPERSEDED_BY_FIRING,
    });
    const fresh = rows.find((e) => e.id !== paused.id);
    expect(fresh).toMatchObject({ scheduledFor: '2027-03-02T06:00:00.000Z', isCatchUp: false });
    if (fresh === undefined) throw new Error('no scheduled run');
    expect((await h.waitForSettled(fresh.id)).status).toBe('completed');
  });

  it('after sleep: a catch-up for F1 paused_budget, asleep across F2, the minute job gives one superseded row and one new catch-up for F2; a second minute writes nothing', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      origins: [LHR, LGW],
      destinations: [JFK],
      budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 3, costMicroGbpEach: 0, executionId: id }),
    );
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    const [paused] = executions(h, def.id);
    if (paused === undefined) throw new Error('no catch-up');
    expect(await h.waitForSettled(paused.id)).toMatchObject({
      status: 'paused_budget',
      scheduledFor: '2027-03-01T06:00:00.000Z',
    });
    h.clearHooks();
    h.clock.set(at('2027-03-02T09:00:00.000Z')); // asleep across F2 (06:00), awake three hours later
    await catchUpAll(buildContext(h.deps, h.options), h.orch());
    const rows = executions(h, def.id);
    expect(
      rows.map((e) => [e.status === 'cancelled' ? 'superseded' : 'new', e.scheduledFor, e.isCatchUp]),
    ).toEqual([
      ['new', '2027-03-02T06:00:00.000Z', true],
      ['superseded', '2027-03-01T06:00:00.000Z', true],
    ]);
    expect(h.repos.executions.get(paused.id)?.errorText).toBe(SUPERSEDED_BY_FIRING);
    const fresh = rows[0];
    if (fresh === undefined) throw new Error('no catch-up');
    await h.waitForSettled(fresh.id);
    h.clock.set(at('2027-03-02T09:01:00.000Z'));
    await catchUpAll(buildContext(h.deps, h.options), h.orch());
    expect(executions(h, def.id)).toHaveLength(2);
  });

  it('a running catch-up active at the next firing blocks it like any active run', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    await h.orch().tick(def.id);
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor])).toEqual([
      ['running', '2027-03-01T06:00:00.000Z'],
    ]);
  });

  it('decision 79 (S1): an hourly catch-up running past the next firing covers it: the minute jobs while it runs and after it ends start, write, notify and call nothing; the blocked entry goes when it ends', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const def = defined(h, '0 * * * *', '2027-03-01T09:30:00.000Z');
    const o = h.orch();
    h.clock.set(at('2027-03-01T10:05:00.000Z')); // F1 10:00 missed; the next firing is 55 minutes away
    await catchUpDefinition(buildContext(h.deps, h.options), o, def, h.clock.now());
    const [catchUp] = executions(h, def.id);
    if (catchUp === undefined) throw new Error('no catch-up');
    expect(catchUp).toMatchObject({
      status: 'running',
      scheduledFor: '2027-03-01T10:00:00.000Z',
      isCatchUp: true,
    });
    await vi.waitFor(() => expect(h.requests).toHaveLength(1)); // its first calendar request, held
    h.clock.set(at('2027-03-01T11:00:00.000Z')); // F2, punctual: blocked by the catch-up
    await o.tick(def.id);
    expect(o.blockedSince()).toBe('2027-03-01T11:00:00.000Z');
    const notices = h.notifications.length;
    for (const minute of ['11:03', '11:10', '11:29', '11:31']) {
      h.clock.set(at(`2027-03-01T${minute}:00.000Z`));
      await catchUpAll(buildContext(h.deps, h.options), o);
    }
    expect(executions(h, def.id).map((e) => e.id)).toEqual([catchUp.id]);
    expect(h.logs.filter((l) => l.msg === 'catch-up: missed firing')).toHaveLength(1); // the 10:05 start only
    await h.releaseHolds();
    expect((await h.waitForSettled(catchUp.id)).status).toBe('completed');
    expect(o.blockedSince()).toBeNull();
    // the run ended after F2, so it still covers it: no second catch-up for F2, early or past half the gap
    for (const minute of ['11:32', '11:50']) {
      h.clock.set(at(`2027-03-01T${minute}:00.000Z`));
      await catchUpAll(buildContext(h.deps, h.options), o);
    }
    expect(executions(h, def.id).map((e) => e.id)).toEqual([catchUp.id]);
    expect(h.notifications).toHaveLength(notices);
    // every provider request on the ledger is the catch-up's own: the blocked minutes called nothing
    expect(h.count('provider_requests')).toBe(h.ledgerRows(catchUp.id).length);
  });
});

describe('the live tick (spec §8.2 rev 36)', () => {
  it('a punctual tick writes scheduled_for = previousFiring(expr, tz, now + 1 s) to the millisecond', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    h.clock.set(at('2027-03-01T06:00:00.400Z')); // croner fires a little after the planned instant
    await h.orch().tick(def.id);
    // why: croner never fires before the planned instant; `now + 1 s` makes a tick at exactly that instant find it
    const early = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', { name: 'exact' });
    h.clock.set(at('2027-03-01T06:00:00.000Z'));
    await h.orch().tick(early.id);
    expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', false],
    ]);
    expect(executions(h, early.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', false],
    ]);
  });

  it('a tick more than 2 minutes late starts nothing itself: it hands the firing to the catch-up (a catch-up, or a skip)', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    h.clock.set(at('2027-03-01T06:02:00.001Z'));
    await h.orch().tick(def.id);
    expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', true],
    ]);
    const weekly = defined(h, '0 6 * * 1', '2027-02-28T00:00:00.000Z', { name: 'weekly' });
    h.clock.set(at('2027-03-07T06:00:00.000Z'));
    await h.orch().tick(weekly.id);
    expect(executions(h, weekly.id).map((e) => [e.status, e.skipCode])).toEqual([
      ['skipped_missed', 'half-cadence'],
    ]);
  });

  it('a late live tick and the minute job reaching the insert with the same scheduled_for, the coverage read stubbed to "uncovered": one execution; the loser returns firing-taken and creates no cell, sends no notice, calls no provider and writes no ledger row (§16)', async () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    // why: §16's first failing test — both paths see the firing as uncovered, so only the firing index can stop one
    vi.spyOn(h.repos.executions, 'coversFiring').mockReturnValue(false);
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    const orch = h.orch();
    await orch.tick(def.id); // late: a catch-up
    const [first] = executions(h, def.id);
    if (first === undefined) throw new Error('no catch-up');
    await h.waitForSettled(first.id);
    const before = {
      cells: h.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM search_cells').get()?.n,
      ledger: h.count('provider_requests'),
      requests: h.requests.length,
      notices: h.notifications.length,
    };
    const fetchTile = vi.spyOn(discoveryOf(h.fixture), 'fetchTile');
    const start = vi.spyOn(orch, 'start');
    h.clock.set(at('2027-03-01T08:00:30.000Z'));
    await catchUpAll(buildContext(h.deps, h.options), orch); // the minute job
    expect(start).toHaveBeenCalledOnce();
    await expect(start.mock.results[0]?.value).resolves.toMatchObject({ ok: false, code: 'firing-taken' });
    expect(executions(h, def.id)).toHaveLength(1);
    expect(h.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM search_cells').get()?.n).toBe(
      before.cells,
    );
    expect(h.count('provider_requests')).toBe(before.ledger);
    expect(h.requests).toHaveLength(before.requests);
    expect(h.notifications).toHaveLength(before.notices);
    expect(fetchTile).not.toHaveBeenCalled();
  });
});

describe('croner, the boot and the minute job (fake timers; the engine reads the faked system time)', () => {
  /** A day's FX rate, so the boot schedules no FX refresh a minute later (that would be a network call). */
  const seedFx = (h: Harness, date: string) => {
    // why: the daily FX job (06:00) may fire on waking; it is answered here, never the network
    stubFrankfurter(() => Response.json(frankfurterBody({ EUR: 1.15, USD: 1.27 })));
    h.repos.fx.upsert([
      { date: h.clock.todayLondon(), currency: 'EUR', rateNano: 1_150_000_000, source: 'test' },
      { date: h.clock.todayLondon(), currency: 'USD', rateNano: 1_270_000_000, source: date },
    ]);
  };

  it('the late tick: registered, time jumped 6 h past a firing with no timer run, then 30 s with both jobs registered: exactly one catch-up', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-03-01T00:00:00.000Z') });
    const def = h.createDefinition({ scheduleCron: '0 6 * * *', window: RELATIVE });
    seedFx(h, 'boot');
    h.clock.set(at('2027-03-01T05:59:00.000Z'));
    const e = h.track(createEngine(h.deps, h.options));
    await e.boot();
    vi.setSystemTime(new Date('2027-03-01T12:00:00.000Z')); // asleep: no timer ran across the 06:00 firing
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000); // and a minute job after it
    const rows = executions(h, def.id);
    expect(rows.map((x) => [x.scheduledFor, x.isCatchUp])).toEqual([['2027-03-01T06:00:00.000Z', true]]);
  });

  it('the weekly variant, 6 of 7 days late: exactly one skipped_missed row and no run', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-02-28T00:00:00.000Z') });
    const def = h.createDefinition({ scheduleCron: '0 6 * * 1', window: RELATIVE });
    h.clock.set(at('2027-03-01T05:59:00.000Z'));
    seedFx(h, 'boot');
    const e = h.track(createEngine(h.deps, h.options));
    await e.boot();
    vi.setSystemTime(new Date('2027-03-07T06:00:00.000Z'));
    seedFx(h, 'wake');
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(executions(h, def.id).map((x) => [x.status, x.skipCode])).toEqual([
      ['skipped_missed', 'half-cadence'],
    ]);
    expect(h.requests).toEqual([]);
  });

  it('boot then the minute job for one firing: one run (the shared function)', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-03-01T00:00:00.000Z') });
    const def = h.createDefinition({ scheduleCron: '0 6 * * *', window: RELATIVE });
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    seedFx(h, 'boot');
    const e = h.track(createEngine(h.deps, h.options));
    await e.boot();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(executions(h, def.id).map((x) => [x.scheduledFor, x.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', true],
    ]);
  });

  it('the minute job makes no network call and starts nothing for a covered firing', {
    timeout: 30_000,
  }, async () => {
    const h = createHarness({ fakeTimers: true, systemClock: true, now: at('2027-03-01T00:00:00.000Z') });
    const def = h.createDefinition({ scheduleCron: '0 6 * * *', window: RELATIVE });
    h.clock.set(at('2027-03-01T07:00:00.000Z'));
    const manual = await h.runToCompletion(h.orch(), def.id); // covers the 06:00 firing
    seedFx(h, 'boot');
    const fetch = vi.fn(async () => {
      throw new Error('the minute job made a network call');
    });
    vi.stubGlobal('fetch', fetch);
    const e = h.track(createEngine(h.deps, h.options));
    await e.boot();
    const requests = h.requests.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.requests).toHaveLength(requests);
    expect(executions(h, def.id).map((x) => x.id)).toEqual([manual.id]);
  });
});

describe('the clock changes of 2027 (recorded croner 10.0.1 firings, Europe/London)', () => {
  // why: the task's first step — these are croner's own instants for each daily time on each change day, recorded once
  const RECORDED = [
    ['2027-03-28', '30 1 * * *', ['2027-03-28T01:30:00.000Z']],
    ['2027-03-28', '30 0 * * *', ['2027-03-28T00:30:00.000Z', '2027-03-28T23:30:00.000Z']],
    ['2027-03-28', '30 2 * * *', ['2027-03-28T01:30:00.000Z']],
    ['2027-10-31', '30 1 * * *', ['2027-10-31T00:30:00.000Z']],
    ['2027-10-31', '30 0 * * *', []],
    ['2027-10-31', '30 2 * * *', ['2027-10-31T02:30:00.000Z']],
  ] as const;

  it.each(RECORDED)(
    '%s, %s: the parseCron wrapper gives exactly the recorded firings that UTC day',
    (day, cron, firings) => {
      expect(
        firingsBetween(
          cron,
          'Europe/London',
          new Date(`${day}T00:00:00.000Z`),
          new Date(`${day}T23:59:59.999Z`),
        ).map((d) => d.toISOString()),
      ).toEqual(firings);
    },
  );

  it.each([
    ['30 1 * * *', '2027-03-27T23:00:00.000Z', '2027-03-28T09:00:00.000Z', '2027-03-28T01:30:00.000Z'],
    ['30 0 * * *', '2027-03-27T23:00:00.000Z', '2027-03-28T09:00:00.000Z', '2027-03-28T00:30:00.000Z'],
    ['30 2 * * *', '2027-03-27T23:00:00.000Z', '2027-03-28T09:00:00.000Z', '2027-03-28T01:30:00.000Z'],
    ['30 1 * * *', '2027-10-30T23:00:00.000Z', '2027-10-31T09:00:00.000Z', '2027-10-31T00:30:00.000Z'],
    ['30 0 * * *', '2027-10-30T23:00:00.000Z', '2027-10-31T09:00:00.000Z', '2027-10-30T23:30:00.000Z'],
    ['30 2 * * *', '2027-10-30T23:00:00.000Z', '2027-10-31T09:00:00.000Z', '2027-10-31T02:30:00.000Z'],
  ] as const)('%s, asleep from %s to %s: one run, for %s', async (cron, asleep, awake, latest) => {
    const h = createHarness();
    const def = defined(h, cron, asleep);
    // the minute job on waking, then each minute for five more
    for (let m = 0; m < 6; m++) {
      h.clock.set(at(new Date(Date.parse(awake) + m * 60_000).toISOString()));
      await catchUpAll(buildContext(h.deps, h.options), h.orch());
    }
    expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([[latest, true]]);
  });
});

describe('skip codes (spec §8.2: the code is written with the row)', () => {
  it.each(['half-cadence', 'browser-only-definition'] as const)(
    '%s round-trips and renders its text',
    (code) => {
      const h = createHarness();
      const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
      const e = h.repos.executions.createForFiring({
        definitionId: def.id,
        isChild: false,
        cell: null,
        snapshot: buildSnapshot(buildContext(h.deps, h.options), def, 'schedule').snapshot,
        estimate: null,
        trigger: 'schedule',
        status: 'skipped_missed',
        scheduledFor: at('2027-03-01T06:00:00.000Z'),
        skipCode: code,
      });
      if (e === null) throw new Error('not written');
      const read = h.repos.executions.get(e.id)?.skipCode ?? null;
      expect(read).toBe(code);
      expect(read === null ? null : SKIP_CODE_TEXT[read]).toBe(SKIP_CODE_TEXT[code]);
    },
  );
});

// why: WP16a Task 16a.8 — the edges the mutation run found unpinned: each one a rule of the catch-up, not a log nicety
describe('the catch-up rule at its edges (16a.8)', () => {
  it('a definition last changed exactly at the firing: none; a millisecond before it: the catch-up', () => {
    const h = createHarness();
    const atFiring = defined(h, '0 6 * * *', '2027-03-01T06:00:00.000Z');
    const before = defined(h, '0 6 * * *', '2027-03-01T05:59:59.999Z');
    expect(decide(h, atFiring, '2027-03-01T08:00:00.000Z')).toEqual({ kind: 'none' });
    expect(decide(h, before, '2027-03-01T08:00:00.000Z')).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });

  it('the provider set is the scheduled one: a provider excluded from scheduled runs cannot catch up', () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    const ctx = buildContext(h.deps, h.options);
    const excluded = {
      ...ctx,
      limitsOf: (id: Parameters<typeof ctx.limitsOf>[0]) => ({
        ...ctx.limitsOf(id),
        excludedFromSchedule: true,
      }),
    };
    expect(findMissedFiring(excluded, def, at('2027-03-01T08:00:00.000Z'))).toEqual({ kind: 'none' });
    expect(findMissedFiring(ctx, def, at('2027-03-01T08:00:00.000Z'))).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });

  it('verification alone (no discovery provider) is not browser-only: it catches up', () => {
    const h = createHarness();
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', { providers: verificationOnly() });
    expect(decide(h, def, '2027-03-01T08:00:00.000Z')).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
  });

  it('logs the skip (recorded by the pass that wrote the row, not by a racing one) and the catch-up it started', async () => {
    const h = createHarness();
    const weekly = defined(h, '0 6 * * 1', '2027-02-28T00:00:00.000Z');
    await catchUpAt(h, weekly, '2027-03-07T06:00:00.000Z');
    // why: a racing pass that read the firing as uncovered reaches the firing index second and records nothing
    const covers = vi.spyOn(h.repos.executions, 'coversFiring').mockReturnValue(false);
    await catchUpAt(h, weekly, '2027-03-07T06:01:00.000Z');
    covers.mockRestore();
    expect(h.notifications.map((n) => n.kind)).toEqual(['skipped_missed']);
    expect(
      h.logs
        .filter((l) => l.msg === 'catch-up: firing skipped')
        .map((l) => [l.bindings.definitionId, l.fields]),
    ).toEqual([
      [weekly.id, { firing: '2027-03-01T06:00:00.000Z', skipCode: 'half-cadence', recorded: true }],
      [weekly.id, { firing: '2027-03-01T06:00:00.000Z', skipCode: 'half-cadence', recorded: false }],
    ]);
    const daily = defined(h, '0 6 * * *', '2027-03-08T00:00:00.000Z');
    await catchUpAt(h, daily, '2027-03-08T08:00:00.000Z');
    const [run] = executions(h, daily.id);
    expect(h.logs.filter((l) => l.msg === 'catch-up: missed firing').map((l) => l.fields)).toEqual([
      { firing: '2027-03-08T06:00:00.000Z', result: 'started', executionId: run?.id },
    ]);
    if (run !== undefined) await h.waitForSettled(run.id);
  });
});

// why: WP16a review round 1 — R7, R9, R11 and the supersede rollback (dm-b1-006)
describe('a paused catch-up and the firing after it (R7, R9; decision 79)', () => {
  /** A catch-up for F1 (2027-03-01 06:00) paused on its execution cap, the hooks cleared. */
  async function pausedCatchUp(h: Harness, patch: Partial<DefinitionInput> = {}) {
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z', {
      origins: [LHR, LGW],
      destinations: [JFK],
      budget: { maxCalls: 6, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
      ...patch,
    });
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 3, costMicroGbpEach: 0, executionId: id }),
    );
    await catchUpAt(h, def, '2027-03-01T08:00:00.000Z');
    const [paused] = executions(h, def.id);
    if (paused === undefined) throw new Error('no catch-up');
    expect(await h.waitForSettled(paused.id)).toMatchObject({ status: 'paused_budget', isCatchUp: true });
    h.clearHooks();
    return { def, paused };
  }

  it('R7: F2 refused at a cap is that firing’s skipped_budget row, which supersedes the paused catch-up in its own transaction', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    // why: the definition's cap now refuses every start, so F2's punctual tick records skipped_budget
    const now = h.repos.definitions.update(def.id, {
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    if (now === null) throw new Error('no definition');
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    await h.orch().tick(def.id);
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor, e.errorText])).toEqual([
      ['skipped_budget', '2027-03-02T06:00:00.000Z', null],
      ['cancelled', '2027-03-01T06:00:00.000Z', SUPERSEDED_BY_FIRING],
    ]);
    expect(h.repos.executions.get(paused.id)?.resumeAfter).toBeNull();
  });

  it('R7: a half-cadence skip of the next firing supersedes it too', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    h.clock.set(at('2027-03-03T05:00:00.000Z')); // F2 (03-02 06:00) missed, F3 an hour away: a half-cadence skip
    await catchUpAll(buildContext(h.deps, h.options), h.orch());
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor, e.skipCode])).toEqual([
      ['skipped_missed', '2027-03-02T06:00:00.000Z', 'half-cadence'],
      ['cancelled', '2027-03-01T06:00:00.000Z', null],
    ]);
    expect(h.repos.executions.get(paused.id)?.errorText).toBe(SUPERSEDED_BY_FIRING);
  });

  it('dm-b1-006: a start whose firing another row already holds rolls its supersede back: the catch-up stays paused, unchanged', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    const held = h.repos.executions.createForFiring({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: paused.snapshot,
      estimate: null,
      trigger: 'schedule',
      status: 'skipped_budget',
      scheduledFor: at('2027-03-02T06:00:00.000Z'),
    });
    expect(held).not.toBeNull();
    const before = h.repos.executions.get(paused.id);
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    const r = await h
      .orch()
      .start(def.id, { trigger: 'schedule', scheduledFor: at('2027-03-02T06:00:00.000Z') });
    expect(r).toMatchObject({ ok: false, code: 'firing-taken' });
    expect(h.repos.executions.get(paused.id)).toEqual(before);
  });

  it('S19: a catch-up a resume claimed between the read and the cancel: the start is refused active and a skip records nothing; neither logs a supersede nor cancels the resume job', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    const cancel = vi.spyOn(h.repos.executions, 'cancelPaused').mockReturnValue(false);
    const ctx = buildContext(h.deps, h.options);
    const cancelResume = vi.fn();
    ctx.hooks.cancelResume = cancelResume;
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    const r = await h
      .orch()
      .start(def.id, { trigger: 'schedule', scheduledFor: at('2027-03-02T06:00:00.000Z') });
    expect(r).toMatchObject({ ok: false, code: 'active' });
    expect(executions(h, def.id).map((e) => e.id)).toEqual([paused.id]);
    // the half-cadence skip of F2 meets the same claim: rolled back, nothing written or sent
    h.clock.set(at('2027-03-03T05:00:00.000Z'));
    const notices = h.notifications.length;
    expect(await catchUpDefinition(ctx, h.orch(), def, h.clock.now())).toMatchObject({ kind: 'skip' });
    cancel.mockRestore();
    expect(executions(h, def.id).map((e) => [e.status, e.scheduledFor])).toEqual([
      ['paused_budget', '2027-03-01T06:00:00.000Z'],
    ]);
    expect(h.notifications).toHaveLength(notices);
    expect(cancelResume).not.toHaveBeenCalled();
    expect(h.logs.filter((l) => l.msg === 'execution: superseded a paused catch-up')).toEqual([]);
    expect(
      h.logs.filter((l) => l.msg === 'execution: the paused catch-up resumed first; nothing recorded'),
    ).toHaveLength(1);
    expect(h.logs.find((l) => l.msg === 'catch-up: firing skipped')?.fields.recorded).toBe(false);
  });

  it('S10: a scheduled start meeting a paused run that is not a catch-up is refused active and leaves it paused', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = defined(h, '0 6 * * *', '2027-03-01T00:00:00.000Z');
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    const manual = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: buildSnapshot(buildContext(h.deps, h.options), def, 'manual').snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    h.repos.executions.setStatus(manual.id, 'paused_error', { resumeAfter: at('2027-03-02T07:00:00.000Z') });
    h.clock.set(at('2027-03-02T06:00:00.000Z'));
    const r = await h
      .orch()
      .start(def.id, { trigger: 'schedule', scheduledFor: at('2027-03-02T06:00:00.000Z') });
    expect(r).toMatchObject({ ok: false, code: 'active' });
    expect(h.repos.executions.get(manual.id)).toMatchObject({ status: 'paused_error', errorText: null });
    expect(executions(h, def.id).map((e) => e.id)).toEqual([manual.id]);
  });

  it.each(['the one-shot resume first', 'the minute job first'] as const)(
    'S1: a catch-up paused across F2 never resumes into covering F2: whichever timer fires first after the wake (%s), F2 gets one catch-up and the paused one is superseded by it',
    async (order) => {
      const h = createHarness({ fixtureConcurrency: 1 });
      const { def, paused } = await pausedCatchUp(h);
      // why: a pause with a window to reopen, due after F2 (03-02 06:00): its one-shot fires on the same wake
      h.repos.executions.setStatus(paused.id, 'paused_error', {
        resumeAfter: at('2027-03-02T07:00:00.000Z'),
      });
      h.clock.set(at('2027-03-02T09:00:00.000Z'));
      const ctx = buildContext(h.deps, h.options);
      const orch = h.orch();
      const oneShot = async () => {
        const e = h.repos.executions.get(paused.id);
        if (e === null) throw new Error('no catch-up');
        return autoResumeYields(ctx, orch, e);
      };
      const first = order === 'the one-shot resume first' ? await oneShot() : await catchUpAll(ctx, orch);
      const second = order === 'the one-shot resume first' ? await catchUpAll(ctx, orch) : await oneShot();
      expect([first, second].filter((r) => r !== undefined)).toEqual(['yielded']);
      expect(
        executions(h, def.id).map((e) => [
          e.status === 'cancelled' ? e.errorText : 'new',
          e.scheduledFor,
          e.isCatchUp,
        ]),
      ).toEqual([
        ['new', '2027-03-02T06:00:00.000Z', true],
        [SUPERSEDED_BY_FIRING, '2027-03-01T06:00:00.000Z', true],
      ]);
    },
  );

  it('S1: a one-shot that wakes inside a later firing’s grace waits just past it, then yields to it', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    const scheduled: Array<[string, string]> = [];
    const ctx = buildContext(h.deps, h.options);
    ctx.hooks.scheduleResume = (id, _definitionId, at) => scheduled.push([id, at]);
    h.clock.set(at('2027-03-02T06:01:00.000Z')); // F2 a minute ago: the live tick's
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('deferred');
    expect(scheduled).toEqual([[paused.id, '2027-03-02T06:02:01.000Z']]);
    expect(executions(h, def.id).map((x) => x.id)).toEqual([paused.id]);
    h.clock.set(at('2027-03-02T06:02:01.000Z'));
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('yielded');
    expect(h.repos.executions.get(paused.id)?.errorText).toBe(SUPERSEDED_BY_FIRING);
  });

  it('S1: a paused catch-up with no firing since it paused resumes; so does any run that is not a catch-up', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { paused } = await pausedCatchUp(h);
    const ctx = buildContext(h.deps, h.options);
    h.clock.set(at('2027-03-02T05:59:00.000Z'));
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('resume');
    // no firing since it paused, so the catch-up rule is never asked
    expect(h.logs.filter((l) => l.msg === 'catch-up: a later firing decided first')).toEqual([]);
    h.clock.set(at('2027-03-02T09:00:00.000Z'));
    expect(await autoResumeYields(ctx, h.orch(), { ...e, isCatchUp: false })).toBe('resume');
    expect(await autoResumeYields(ctx, h.orch(), { ...e, pausedAt: null })).toBe('resume');
  });

  it('S1: a catch-up paused exactly at a firing yields to it; one paused a millisecond after it resumes', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    const ctx = buildContext(h.deps, h.options);
    const F2 = at('2027-03-02T06:00:00.000Z');
    h.clock.set(at('2027-03-02T06:03:00.000Z'));
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    expect(await autoResumeYields(ctx, h.orch(), { ...e, pausedAt: at('2027-03-02T06:00:00.001Z') })).toBe(
      'resume',
    );
    expect(executions(h, def.id)).toHaveLength(1);
    expect(await autoResumeYields(ctx, h.orch(), { ...e, pausedAt: F2 })).toBe('yielded');
    expect(
      h.logs
        .filter((l) => l.msg === 'catch-up: a later firing decided first')
        .map((l) => [l.fields, l.bindings.executionId, l.bindings.definitionId]),
    ).toEqual([[{ firing: F2, resumes: false }, paused.id, def.id]]);
  });

  it('S1: a definition that is unscheduled, gone or holds a schedule the parser refuses asks no firing; a disabled or deleted one is left alone by the catch-up rule: the resume goes ahead as it would', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    const ctx = buildContext(h.deps, h.options);
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    h.clock.set(at('2027-03-02T09:00:00.000Z'));
    const asked = vi.spyOn(h.repos.executions, 'coversFiring');
    h.repos.definitions.update(def.id, { scheduleCron: null });
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('resume');
    expect(await autoResumeYields(ctx, h.orch(), { ...e, definitionId: 'no-such-definition' })).toBe(
      'resume',
    );
    // a stored schedule the parser refuses (written before today's rule)
    h.db.raw
      .prepare('UPDATE search_definitions SET schedule_cron = ? WHERE id = ?')
      .run('*/5 * * * *', def.id);
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('resume');
    expect(asked).not.toHaveBeenCalled();
    h.db.raw
      .prepare('UPDATE search_definitions SET schedule_cron = ?, enabled = 0 WHERE id = ?')
      .run('0 6 * * *', def.id);
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('resume');
    h.repos.definitions.softDelete(def.id);
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('resume');
    expect(executions(h, def.id).map((x) => [x.id, x.status])).toEqual([[paused.id, 'paused_budget']]);
  });

  it('S1: a deferred resume logs the firing it waits for and when it will look again', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { paused } = await pausedCatchUp(h);
    const ctx = buildContext(h.deps, h.options);
    ctx.hooks.scheduleResume = () => undefined;
    h.clock.set(at('2027-03-02T06:00:30.000Z'));
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    expect(await autoResumeYields(ctx, h.orch(), e)).toBe('deferred');
    expect(
      h.logs.filter((l) => l.msg === 'catch-up: resume waits for the firing after it').map((l) => l.fields),
    ).toEqual([{ firing: '2027-03-02T06:00:00.000Z', at: '2027-03-02T06:02:01.000Z' }]);
  });

  it('S1: a later firing the catch-up rule leaves uncaught (the definition changed since) lets the resume go ahead', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, paused } = await pausedCatchUp(h);
    h.clock.set(at('2027-03-02T07:00:00.000Z'));
    h.repos.definitions.update(def.id, { name: 'London to New York, edited after F2' });
    h.clock.set(at('2027-03-02T09:00:00.000Z'));
    const e = h.repos.executions.get(paused.id);
    if (e === null) throw new Error('no catch-up');
    expect(await autoResumeYields(buildContext(h.deps, h.options), h.orch(), e)).toBe('resume');
    expect(executions(h, def.id).map((x) => x.id)).toEqual([paused.id]);
  });
});

describe('the browser-only test is cabin-aware (R11, spec §8.2 "could run the definition")', () => {
  it('a business-cabin definition whose only other discovery provider sells economy only: skipped_missed browser-only-definition, no run', async () => {
    const camoufox = stubCamoufox({ cells: 4, cabins: ['economy', 'business'] });
    const travelpayouts = stubTravelpayouts({ cells: 4 });
    const e = engineWith([camoufox, travelpayouts], {
      scheduleCron: '0 6 * * *',
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 4 },
      createdAt: at('2027-03-01T00:00:00.000Z'),
    });
    const def = e.ctx.repos.definitions.update(e.definition.id, { cabin: 'business' });
    if (def === null) throw new Error('no definition');
    e.clock.set(at('2027-03-01T08:00:00.000Z'));
    expect(findMissedFiring(e.ctx, def, e.clock.now())).toEqual({
      kind: 'skip',
      firing: '2027-03-01T06:00:00.000Z',
      reason: 'scheduled-only',
    });
    // positive control: in economy, which Travelpayouts sells, the same firing is caught up
    expect(findMissedFiring(e.ctx, { ...def, cabin: 'economy' }, e.clock.now())).toEqual({
      kind: 'catch-up',
      firing: '2027-03-01T06:00:00.000Z',
    });
    await catchUpDefinition(e.ctx, e.orch, def, e.clock.now());
    const rows = e.ctx.repos.executions.listForDefinition(def.id, { limit: 10, includeChildren: true });
    expect(rows.map((r) => [r.status, r.skipCode])).toEqual([['skipped_missed', 'browser-only-definition']]);
    expect(camoufox.calls).toEqual([]);
    expect(travelpayouts.calls).toEqual([]);
  });
});
