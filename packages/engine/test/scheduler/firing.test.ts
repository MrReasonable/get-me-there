// The firing unique index through the engine's start (spec §7, §8.2 rev 36; decision 79; WP16a Task 16a.1): a
// scheduled start or skip stands for one firing, so a second one for the same firing returns `firing-taken` and seeds,
// sends, calls and ledgers nothing. Layer A: the fixture provider through http-kit, the worked example only.
import { asIsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHarness, discoveryOf, FIXTURE_RULES, type Harness, refusedWith } from '../support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const F = asIsoDateTime('2026-10-14T08:00:00.000Z');
const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });
const cellRows = (h: Harness) =>
  h.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM search_cells').get()?.n ?? 0;

describe('a scheduled start through the firing unique index (spec §7 rev 36)', () => {
  it('writes scheduled_for on the run; a second start for the same firing returns firing-taken and seeds, sends, calls and ledgers nothing', async () => {
    const h = createHarness();
    const def = h.createDefinition({ scheduleCron: '0 9 * * *' });
    const orch = h.orch();
    const first = await orch.start(def.id, { trigger: 'schedule', scheduledFor: F });
    if (!first.ok) throw new Error(first.message);
    const done = await h.waitForSettled(first.executionId);
    expect(done).toMatchObject({ status: 'completed', scheduledFor: F, isCatchUp: false });
    const before = {
      cells: cellRows(h),
      ledger: h.count('provider_requests'),
      requests: h.requests.length,
      notices: h.notifications.length,
    };
    const fetchTile = vi.spyOn(discoveryOf(h.fixture), 'fetchTile');
    expect(
      refusedWith(await orch.start(def.id, { trigger: 'schedule', scheduledFor: F }), 'firing-taken'),
    ).toBe('this scheduled firing already has its run or its skip recorded');
    expect(executions(h, def.id)).toHaveLength(1);
    expect(cellRows(h)).toBe(before.cells);
    expect(h.count('provider_requests')).toBe(before.ledger);
    expect(h.requests).toHaveLength(before.requests);
    expect(h.notifications).toHaveLength(before.notices);
    expect(fetchTile).not.toHaveBeenCalled();
  });

  it('a skipped_* row for a firing carries scheduled_for, so a second skip or start for it returns firing-taken, with one notice', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      scheduleCron: '0 9 * * *',
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    const orch = h.orch();
    refusedWith(await orch.start(def.id, { trigger: 'schedule', scheduledFor: F }), 'cap');
    const [skipped] = executions(h, def.id);
    expect(skipped).toMatchObject({ status: 'skipped_budget', scheduledFor: F });
    expect(h.notifications.map((n) => n.kind)).toEqual(['skipped_budget']);
    // the cap is lifted: the firing still has its row, so nothing more is written for it
    h.repos.definitions.update(def.id, {
      budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    refusedWith(await orch.start(def.id, { trigger: 'schedule', scheduledFor: F }), 'firing-taken');
    expect(executions(h, def.id)).toHaveLength(1);
    expect(h.notifications).toHaveLength(1);
    expect(h.requests).toHaveLength(0);
  });

  it('an active-parent clash on a scheduled start still returns active (it is not swallowed)', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = h.createDefinition({ scheduleCron: '0 9 * * *' });
    const orch = h.orch();
    expect((await orch.start(def.id, { trigger: 'manual' })).ok).toBe(true);
    // why: hide the active run from the read-side check, so the insert itself meets the one-active-parent index
    vi.spyOn(h.repos.executions, 'activeParent').mockReturnValue(null);
    refusedWith(await orch.start(def.id, { trigger: 'schedule', scheduledFor: F }), 'active');
    expect(h.repos.executions.firingTaken(def.id, F)).toBe(false);
  });

  it('a manual start never carries a firing', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e).toMatchObject({ scheduledFor: null, isCatchUp: false, skipCode: null });
  });
});
