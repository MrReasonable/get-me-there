import { asIsoDate, cellKeyString, generateCells, resolveWindow } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { buildSnapshot, snapshotProviders } from '../src/snapshot.js';
import { createHarness, discoveryOf, FIXTURE_RULES, JFK, LGW, LHR, WINDOW } from './support/harness.js';
import { withCabins } from './support/wrappers.js';

describe('seeding (spec §3, §7 atomic unit "seeding search_cells + discovery cell_outcomes at start")', () => {
  it('seeds not_run for every cell × discovery provider and nothing for a stage without a provider', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const def = h.createDefinition();
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    const cells = generateCells({
      origins: [LHR],
      destinations: [JFK],
      departureFrom: WINDOW.from,
      departureTo: WINDOW.to,
      minNights: 7,
      maxNights: 8,
    });
    // why: both tiles must be held before the release, or a tile requested after it would wait forever
    await vi.waitFor(() => expect(h.requests.filter((q) => q.kind === 'calendar')).toHaveLength(2));
    const rows = h.outcomes(r.executionId, { stage: 'discovery', providerId: 'fixture' });
    expect(rows.map(cellKeyString).sort()).toEqual(cells.map(cellKeyString).sort());
    expect(rows.every((o) => o.status === 'not_run' && o.attempts === 0)).toBe(true);
    expect(h.outcomes(r.executionId, { stage: 'verification' })).toHaveLength(0);
    await h.releaseHolds();
    await h.waitForSettled(r.executionId);
    const rollUps = h.repos.cells.rollUps(r.executionId);
    expect(rollUps.size).toBe(cells.length);
    for (const v of rollUps.values()) expect(v.verification.status).toBeNull(); // spec §6.6 row 0: NULL / not_applicable
  });

  it('freezes a relative window at start in Europe/London', async () => {
    const h = createHarness();
    const def = h.createDefinition({ window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 } });
    const e = await h.runToCompletion(h.orch(), def.id);
    const w = resolveWindow(def.window, h.clock.todayLondon()); // WP1 owns the inclusive-end rule; compare with it
    expect(e.snapshot.resolved).toMatchObject({ departureFrom: w.departureFrom, departureTo: w.departureTo });
    expect(e.snapshot.resolved.departureFrom).toBe('2026-10-21'); // 2026-10-14 + 7 days
    expect(e.snapshot.resolvedAt).toBe(h.clock.now());
    h.clock.advance(3 * 86_400_000);
    h.repos.definitions.update(def.id, { window: { kind: 'relative', startOffsetDays: 30, lengthDays: 5 } });
    expect(h.repos.executions.get(e.id)?.snapshot.resolved).toEqual(e.snapshot.resolved); // frozen
  });

  it('drops alwaysInclude cells that slid out of a relative window, with a note, not an error (spec §6.1)', async () => {
    const h = createHarness();
    const inside = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-10-21'),
      returnDate: asIsoDate('2026-10-28'),
    };
    const slid = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-10-20'),
      returnDate: asIsoDate('2026-10-27'),
    };
    const def = h.createDefinition({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 2 },
      verification: { maxCells: 2, topN: 2, alwaysInclude: [inside, slid], expandTop: 1, bookingLinks: true },
    });
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.snapshot.verification.alwaysInclude).toEqual([inside]);
    expect(e.snapshot.droppedAlwaysInclude).toEqual([slid]);
    const started = h.logs.find((l) => l.msg === 'execution: started');
    const notes = started?.fields.notes;
    expect(
      Array.isArray(notes) && notes.includes('alwaysInclude: 1 cell left the window and was dropped'),
    ).toBe(true);
  });

  it('T9: snapshotProviders is buildSnapshot’s provider half, for either trigger, and reads no date', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const excluded = {
      ...ctx,
      limitsOf: (id: Parameters<typeof ctx.limitsOf>[0]) => ({
        ...ctx.limitsOf(id),
        excludedFromSchedule: true,
      }),
    };
    const def = h.createDefinition();
    for (const c of [ctx, excluded])
      for (const trigger of ['manual', 'schedule'] as const) {
        const built = buildSnapshot(c, def, trigger);
        expect(snapshotProviders(c, def, trigger)).toEqual({
          discovery: built.snapshot.providers.discovery,
          verification: built.snapshot.providers.verification,
          excluded: built.excluded,
        });
      }
    expect(snapshotProviders(excluded, def, 'schedule').discovery).toEqual([]);
    expect(snapshotProviders(excluded, def).discovery).toEqual(['fixture']);
    const today = vi.spyOn(ctx.clock, 'todayLondon');
    snapshotProviders(ctx, def, 'schedule');
    expect(today).not.toHaveBeenCalled();
  });

  it('a scheduled snapshot leaves out a provider excluded from scheduled runs (the SearchApi trial rule, spec §8.2)', () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    // why: the fixture is the only provider a layer-A test may register (ruling 1), so the plan flag is set on its limits here
    const excluded = {
      ...ctx,
      limitsOf: (id: Parameters<typeof ctx.limitsOf>[0]) => ({
        ...ctx.limitsOf(id),
        excludedFromSchedule: true,
      }),
    };
    const def = h.createDefinition();
    const scheduled = buildSnapshot(excluded, def, 'schedule');
    expect(scheduled.snapshot.providers.discovery).toEqual([]);
    expect(scheduled.notes).toContain('fixture is excluded from scheduled runs on its plan');
    // why: the start's no-runnable-provider refusal reads this data, never the note wording (code-architect review 9)
    expect(scheduled.excluded).toEqual([
      {
        providerId: 'fixture',
        stage: 'discovery',
        why: 'schedule-excluded',
        note: 'fixture is excluded from scheduled runs on its plan',
      },
    ]);
    expect(buildSnapshot(excluded, def, 'manual').snapshot.providers.discovery).toEqual(['fixture']);
  });

  it('a provider whose cabins exclude the definition cabin is never called: every cell no_data, reason cabin-not-offered (spec rev 10)', async () => {
    const h = createHarness({ transformFixture: (p) => withCabins(p, ['business']) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition({ cabin: 'economy' }).id);
    expect(e.status).toBe('completed');
    const rows = h.outcomes(e.id, { providerId: 'fixture' });
    expect(rows.length).toBe(28);
    expect(rows.every((o) => o.status === 'no_data' && o.reason === 'cabin-not-offered')).toBe(true);
    expect(h.ledgerRows(e.id)).toHaveLength(0);
    expect(h.requests).toHaveLength(0);
  });
});

describe('Review Focus 4: a PUT during a run does not change the running execution', () => {
  it('keeps the snapshot and the plan of the running execution after the definition is edited', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold, times: 1 }]);
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const def = h.createDefinition();
    const r = await h.orch().start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.length).toBe(1));
    h.repos.definitions.update(def.id, { origins: [LGW], minNights: 9, maxNights: 9, cabin: 'business' });
    await h.releaseHolds();
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('completed');
    expect(e.snapshot.origins).toEqual([LHR]);
    expect(e.snapshot.cabin).toBe('economy');
    const all = h.outcomes(r.executionId);
    expect(all.length).toBe(28);
    expect(all.every((o) => o.origin === LHR)).toBe(true);
    expect(new Set(all.map((o) => o.returnDate)).size).toBeGreaterThan(1); // still the 7–8 night band
    expect(plan.mock.calls.length).toBeGreaterThan(0);
    expect(
      plan.mock.calls.every(
        ([q]) => q.origin === LHR && q.minNights === 7 && q.maxNights === 8 && q.cabin === 'economy',
      ),
    ).toBe(true);
    expect(h.repos.definitions.get(def.id)?.origins).toEqual([LGW]); // the edit itself was stored
  });
});
