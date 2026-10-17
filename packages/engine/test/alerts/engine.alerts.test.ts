import { type CellKey, daysBetween, type ProvidersConfig } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { buildContext } from '../../src/context.js';
import type { AlertsStepHook } from '../../src/index.js';
import { createOrchestrator } from '../../src/orchestrator.js';
import {
  createHarness,
  FIXTURE_COST_MICRO_GBP,
  type Harness,
  WINDOW,
  withVerification,
} from '../support/harness.js';
import { freeCallCapBreach, providerMonthBreach, realKindProvider } from './realKindProvider.js';

const calendarRule = (h: Harness, definitionId: string, thresholdPence = 99_999_999) =>
  h.repos.alerts.create({
    definitionId,
    type: 'absolute',
    thresholdPence,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
const refusals = (h: Harness) =>
  h.logs.filter((l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused');
/** Every digest body the harness's notifier received, in order. */
const bodies = (h: Harness): string[] =>
  h.digests.flatMap((d) =>
    typeof d === 'object' && d !== null && 'body' in d && typeof d.body === 'string' ? [d.body] : [],
  );
/** £400, plus £1 per departure day after the window opens, plus £0.50 per night: every cell's price distinct. */
const priceOf = (c: CellKey) =>
  40_000 + 100 * daysBetween(WINDOW.from, c.departureDate) + 50 * daysBetween(c.departureDate, c.returnDate);

/** The harness's ports with the real-kind provider (Travelpayouts configured with a sentinel token), the real runner as the hook. */
function realKind(refuse: (tileIndex: number) => ReturnType<typeof freeCallCapBreach> | null) {
  const h = createHarness({ env: { TRAVELPAYOUTS_TOKEN: 'test-travelpayouts-token-0123456789abcdef' } });
  let refusing = true;
  const provider = realKindProvider({
    clock: h.clock,
    priceOf,
    refuse: (i) => (refusing ? refuse(i) : null),
  });
  const hook = vi.fn<AlertsStepHook>(runAlerts);
  const orch = h.track(
    createOrchestrator(
      buildContext(
        { ...h.deps, providers: [provider, h.fixture] },
        { ...h.options, alerts: hook, providerConcurrency: { travelpayouts: 1 } },
      ),
    ),
  );
  const providers = (verification: ProvidersConfig['verification'] = []): ProvidersConfig => ({
    discovery: ['travelpayouts'],
    verification,
    discoveryRefreshHours: { travelpayouts: 168 },
  });
  return { h, orch, hook, providers, stopRefusing: () => (refusing = false) };
}

describe('the §8.1 alerts step runs the alert runner (layer A)', () => {
  it('runAlerts is an AlertsStepHook, called once per completed pass with the engine deps; fixture rows are refused', async () => {
    const h = createHarness();
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const def = h.createDefinition();
    calendarRule(h, def.id);
    const execution = await h.runToCompletion(h.orch({ ...h.options, alerts: hook }), def.id);
    expect(execution.status).toBe('completed');
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, execution.id, { stop: 'completed' });
    await expect(hook.mock.results[0]?.value).resolves.toEqual({ digests: 0, events: 0 });
    expect(refusals(h).length).toBeGreaterThan(0);
    expect(h.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    expect(h.digests).toHaveLength(0);
  });

  it('also runs when the pass pauses for a provider-month cap (decision 25)', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200 });
    h.onStageStart('verification', () => {
      const used = h.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls;
      h.spendLedger({ providerId: 'fixture', rows: 200 - used, costMicroGbpEach: FIXTURE_COST_MICRO_GBP });
    });
    const hook = vi.fn<AlertsStepHook>(runAlerts);
    const def = h.createDefinition({ providers: withVerification() });
    calendarRule(h, def.id);
    const e = await h.runToCompletion(h.orch({ ...h.options, alerts: hook }), def.id);
    expect(e.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledExactlyOnceWith(h.deps, e.id, { stop: 'budget' });
    expect(refusals(h).length).toBeGreaterThan(0);
    expect(h.digests).toHaveLength(0);
  });
});

describe('real-kind prices through a pause and a resume (decisions 25, 55, 56; review TS-5, TS-16, PA-2)', () => {
  it("free-call cap: the paused pass sends one digest with the 'Not searched' line; the resumed pass sends only new prices; no event twice", async () => {
    const { h, orch, hook, providers, stopRefusing } = realKind((i) => (i >= 5 ? freeCallCapBreach() : null));
    const def = h.createDefinition({ providers: providers() });
    calendarRule(h, def.id, 45_000);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledTimes(1);
    const [first] = bodies(h);
    expect(first).toContain('1. £403.50 LHR→JFK 2 Nov–9 Nov (7n)');
    expect(first).toContain('10. £408 LHR→JFK 6 Nov–14 Nov (8n)');
    expect(first).not.toMatch(/^and \d+ more/m);
    expect(first).toMatch(/Not searched: a budget cap left 18 cell searches of this run undone;/);
    const afterPause = h.repos.alerts.events({ definitionId: def.id, limit: 100 });
    expect(afterPause).toHaveLength(10);
    expect(new Set(afterPause.map((e) => e.status))).toEqual(new Set(['notified']));

    stopRefusing();
    expect(await orch.resume(paused.id, { manual: true })).toEqual({ ok: true, executionId: paused.id });
    const done = await h.waitForSettled(paused.id);
    expect(done.status).toBe('completed');
    expect(hook).toHaveBeenCalledTimes(2);
    const events = h.repos.alerts.events({ definitionId: def.id, limit: 100 });
    expect(events).toHaveLength(28);
    expect(new Set(events.map((e) => e.calendarPriceId)).size).toBe(28);
    const second = bodies(h)[1] ?? '';
    expect(second).toContain('1. £408.50 LHR→JFK 7 Nov–14 Nov (7n)');
    expect(second).not.toContain('2 Nov–9 Nov');
    expect(second).not.toContain('Not searched');
  });

  it('provider-month cap with no qualifying price: the paused pass sends nothing and records nothing', async () => {
    const { h, orch, hook, providers } = realKind((i) => (i >= 3 ? providerMonthBreach() : null));
    const def = h.createDefinition({ providers: providers() });
    calendarRule(h, def.id, 100);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    expect(hook).toHaveBeenCalledTimes(1);
    await expect(hook.mock.results[0]?.value).resolves.toEqual({ digests: 0, events: 0 });
    expect(h.digests).toHaveLength(0);
  });

  it('a cap in discovery with a verification provider configured: "itinerary search not run" and a lower bound (review PA-2)', async () => {
    const { h, orch, providers } = realKind((i) => (i >= 2 ? freeCallCapBreach() : null));
    const def = h.createDefinition({ providers: providers(['fixture']) });
    calendarRule(h, def.id, 45_000);
    const paused = await h.runToCompletion(orch, def.id);
    expect(paused.status).toBe('paused_budget');
    const [body] = bodies(h);
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
    expect(body).toMatch(/Not searched: a budget cap left at least 24 cell searches of this run undone;/);
  });
});
