// The late live tick keeps the whole tick order (spec §8.2 rev 36; WP16a review R1, R3, R38, R42): a machine asleep at
// every firing makes every tick late, so the stale-run supersede, the resume and the "blocked since" record must run on
// the late path too, before the catch-up rule takes the place of the ordinary start. Fixed clocks and literal UTC
// instants; the worked example only.
import { asIsoDateTime, type ExecutionStatus, type SearchDefinition } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../src/context.js';
import { SUPERSEDED } from '../../src/resume.js';
import { CATCH_UP_GRACE_MS, catchUpAll, pastGrace } from '../../src/scheduler/catchUp.js';
import { buildSnapshot } from '../../src/snapshot.js';
import { createHarness, type Harness } from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const at = asIsoDateTime;
const RELATIVE = { kind: 'relative', startOffsetDays: 7, lengthDays: 14 } as const;
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });

function daily(h: Harness, createdAt: string, name = 'London to New York'): SearchDefinition {
  h.clock.set(at(createdAt));
  return h.createDefinition({ name, scheduleCron: '0 6 * * *', window: RELATIVE });
}

/** A parent run left in `status` since `since`, as an earlier pass would have left it (no resume_after). */
function leftAt(h: Harness, def: SearchDefinition, since: string, status: ExecutionStatus) {
  h.clock.set(at(since));
  const ctx = buildContext(h.deps, h.options);
  const e = h.repos.executions.create({
    definitionId: def.id,
    isChild: false,
    cell: null,
    snapshot: buildSnapshot(ctx, def, 'manual').snapshot,
    estimate: null,
    trigger: 'manual',
    status: 'running',
  });
  h.repos.executions.setStatus(e.id, status, { resumeAfter: null });
  return e;
}

describe('the late tick keeps the tick order (R1)', () => {
  it.each(['paused_budget', 'interrupted'] as const)(
    'a stale %s run with no resume_after, every firing slept through: the 6 h late tick supersedes it, then catches the firing up',
    async (status) => {
      const h = createHarness();
      const def = daily(h, '2027-02-20T00:00:00.000Z');
      // why: an execution-cap pause (no resume_after) or an interrupted run the boot left alone; stale after 151.2 h
      const old = leftAt(h, def, '2027-02-21T06:00:00.000Z', status);
      h.clock.set(at('2027-03-01T12:00:00.000Z'));
      await h.orch().tick(def.id);
      expect(h.repos.executions.get(old.id)).toMatchObject({ status: 'cancelled', errorText: SUPERSEDED });
      const fresh = executions(h, def.id).find((e) => e.id !== old.id);
      expect(fresh).toMatchObject({ scheduledFor: '2027-03-01T06:00:00.000Z', isCatchUp: true });
      if (fresh === undefined) throw new Error('no catch-up');
      expect((await h.waitForSettled(fresh.id)).status).toBe('completed');
      expect(h.orch().blockedSince()).toBeNull();
    },
  );

  it('a paused_error with no resume_after that is not stale: the late tick records "schedule blocked since" and starts nothing', async () => {
    const h = createHarness();
    const def = daily(h, '2027-02-20T00:00:00.000Z');
    const paused = leftAt(h, def, '2027-02-28T07:00:00.000Z', 'paused_error');
    h.clock.set(at('2027-03-01T12:00:00.000Z'));
    const o = h.orch();
    await o.tick(def.id);
    expect(executions(h, def.id).map((e) => e.id)).toEqual([paused.id]);
    expect(o.blockedSince()).toBe('2027-03-01T12:00:00.000Z');
    expect(
      h.logs
        .filter((l) => l.msg === 'tick: schedule blocked by an active execution')
        .map((l) => l.fields.late),
    ).toEqual([true]);
  });

  it('the minute job alone never supersedes: a stale paused run covers the firing until a tick replaces it', async () => {
    const h = createHarness();
    const def = daily(h, '2027-02-20T00:00:00.000Z');
    leftAt(h, def, '2027-02-21T06:00:00.000Z', 'paused_budget');
    h.clock.set(at('2027-03-01T12:00:00.000Z'));
    await catchUpAll(buildContext(h.deps, h.options), h.orch());
    expect(executions(h, def.id)).toHaveLength(1);
  });
});

describe('the 2-minute boundary is one predicate on both sides (R38)', () => {
  it('pastGrace: exactly 2:00.000 is inside, 2:00.001 is past', () => {
    const f = Date.parse('2027-03-01T06:00:00.000Z');
    expect(CATCH_UP_GRACE_MS).toBe(120_000);
    expect(pastGrace(f, f + 120_000)).toBe(false);
    expect(pastGrace(f, f + 120_001)).toBe(true);
  });

  it('a tick at firing + 2:00.000 is punctual (starts its own run, not a catch-up); at + 2:00.001 it hands over (a catch-up)', async () => {
    const h = createHarness();
    const punctual = daily(h, '2027-02-20T00:00:00.000Z', 'punctual');
    const late = daily(h, '2027-02-20T00:00:00.000Z', 'late');
    h.clock.set(at('2027-03-01T06:02:00.000Z'));
    await h.orch().tick(punctual.id);
    h.clock.set(at('2027-03-01T06:02:00.001Z'));
    await h.orch().tick(late.id);
    expect(executions(h, punctual.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', false],
    ]);
    expect(executions(h, late.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([
      ['2027-03-01T06:00:00.000Z', true],
    ]);
    // and the minute job at + 2:00.000 leaves the firing to the live tick (the day before predates the definition)
    const left = daily(h, '2027-02-28T12:00:00.000Z', 'left');
    h.clock.set(at('2027-03-01T06:02:00.000Z'));
    await catchUpAll(buildContext(h.deps, h.options), h.orch());
    expect(executions(h, left.id)).toEqual([]);
  });

  it.each([
    ['2027-03-01T05:59:59.100Z', '2027-03-01T06:00:00.000Z', null],
    ['2027-03-01T05:59:59.000Z', '2027-03-01T06:00:00.000Z', null],
    // a second and a millisecond early: the tick is late for the day before, which the next firing a second away skips
    ['2027-03-01T05:59:58.999Z', '2027-02-28T06:00:00.000Z', 'half-cadence'],
  ])(
    'a tick at %s (the second before a firing counts as that firing): scheduled_for %s, skip code %s',
    async (now, firing, skipCode) => {
      const h = createHarness();
      const def = daily(h, '2027-02-27T12:00:00.000Z');
      h.clock.set(at(now));
      await h.orch().tick(def.id);
      expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp, e.skipCode])).toEqual([
        [firing, false, skipCode],
      ]);
    },
  );
});

describe('the clock changes of 2027 through the live tick (R42; Europe/London)', () => {
  // why: recorded croner 10.0.1 firings for "30 1 * * *" (01:30 London; catchUp.test.ts RECORDED): on 2027-03-28 01:30
  // London does not exist (the clocks go forward at 01:00 UTC) and croner fires at 01:30 UTC (02:30 BST); on
  // 2027-10-31 01:30 London happens twice and croner fires the first, 00:30 UTC
  it.each([
    ['2027-03-28T01:30:00.500Z', '2027-03-28T01:30:00.000Z'],
    ['2027-10-31T00:30:00.500Z', '2027-10-31T00:30:00.000Z'],
  ])('a tick at %s writes scheduled_for %s and starts one punctual run', async (now, firing) => {
    const h = createHarness();
    h.clock.set(at('2027-03-01T00:00:00.000Z'));
    const def = h.createDefinition({ scheduleCron: '30 1 * * *', window: RELATIVE });
    h.clock.set(at(now));
    await h.orch().tick(def.id);
    expect(executions(h, def.id).map((e) => [e.scheduledFor, e.isCatchUp])).toEqual([[firing, false]]);
  });

  it('the repeated autumn hour: a tick at the second 01:30 (01:30 UTC) is late for the one firing, which its run covers: nothing new', async () => {
    const h = createHarness();
    h.clock.set(at('2027-03-01T00:00:00.000Z'));
    const def = h.createDefinition({ scheduleCron: '30 1 * * *', window: RELATIVE });
    h.clock.set(at('2027-10-31T00:30:00.500Z'));
    await h.orch().tick(def.id);
    const [first] = executions(h, def.id);
    if (first === undefined) throw new Error('no run');
    await h.waitForSettled(first.id);
    h.clock.set(at('2027-10-31T01:30:00.500Z'));
    await h.orch().tick(def.id);
    expect(executions(h, def.id).map((e) => e.scheduledFor)).toEqual(['2027-10-31T00:30:00.000Z']);
  });
});

describe('one definition never stops the others (R3)', () => {
  it('the minute job logs a definition whose catch-up throws and catches the next one up', async () => {
    const h = createHarness();
    const broken = daily(h, '2027-02-20T00:00:00.000Z', 'broken');
    const fine = daily(h, '2027-02-20T00:00:00.000Z', 'fine');
    h.clock.set(at('2027-03-01T08:00:00.000Z'));
    const orch = h.orch();
    const start = orch.start.bind(orch);
    vi.spyOn(orch, 'start').mockImplementation((id, opts) =>
      id === broken.id ? Promise.reject(new Error('plan does not partition its cells')) : start(id, opts),
    );
    await catchUpAll(buildContext(h.deps, h.options), orch);
    expect(executions(h, fine.id).map((e) => e.isCatchUp)).toEqual([true]);
    expect(h.logs.filter((l) => l.msg === 'catch-up: definition failed').map((l) => l.fields)).toEqual([
      { definitionId: broken.id, err: 'plan does not partition its cells' },
    ]);
  });
});
