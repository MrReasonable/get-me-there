// Spec revision 55 §8.1 "Stop causes": every status write that stops or skips a run stores a cause (and its sentence in
// error_text). One case per writer: finish (every StopReason kind), the cancel of a live and of a stopped run, the
// resume's stale supersede and never-started cancel, the supersedes of a stopped parent, and the scheduler's skipped_*
// rows. The repository's own writes (the boot sweep, the clears) are packages/db/test/stopCauseWrites.test.ts.
import { apiContract, asIsoDate, asIsoDateTime, BudgetExceeded, type StopCause, stopText } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { finalStatus } from '../src/execute.js';
import { supersede } from '../src/resume.js';
import type { StopReason } from '../src/run.js';
import { buildSnapshot } from '../src/snapshot.js';
import { recordSkipped } from '../src/start.js';
import { causeRun } from './support/causeRun.js';
import { createHarness, FIXTURE_RULES, type Harness, tileRule } from './support/harness.js';

const NOW = asIsoDateTime('2026-10-14T09:00:00.000Z');
const err = new BudgetExceeded({ scope: 'execution-calls', cap: 6, current: 6, requested: 1 });
const EVERY_STOP: Record<StopReason['kind'], StopReason> = {
  sigterm: { kind: 'sigterm' },
  cancel: { kind: 'cancel', cause: { kind: 'cancelled' } },
  'limiter-timeout': { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: NOW },
  budget: { kind: 'budget', error: err, resumeAfter: null, resetsAt: null },
  'all-disabled': { kind: 'all-disabled', stage: 'discovery' },
  'child-cap': { kind: 'child-cap', error: err },
  fatal: { kind: 'fatal', message: 'SQLITE_FULL' },
};

/** A paused_error run of a new search (an auth error on its only provider). */
async function pausedRun(h: Harness) {
  await h.fixtureScenario([tileRule('LHR', '2026-11-02', FIXTURE_RULES.auth, 1)]);
  const def = h.createDefinition();
  const e = await h.runToCompletion(h.orch(), def.id);
  expect(e.status).toBe('paused_error');
  return { def, e };
}

describe('every status write that stops a run stores its cause (revision 55 §8.1)', () => {
  const EXPECTED: Record<StopReason['kind'], [StopCause, string]> = {
    sigterm: [{ kind: 'interrupted' }, 'The app stopped during this search.'],
    cancel: [{ kind: 'cancelled' }, 'Stopped by you.'],
    'limiter-timeout': [
      { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: null },
      'The Aviasales cache is limiting how fast it answers.',
    ],
    budget: [
      {
        kind: 'budget',
        scope: 'execution-calls',
        providerId: null,
        unit: 'calls',
        cap: 6,
        resumeAfter: null,
        resetsAt: null,
        flights: null,
      },
      'This search stopped at its limit of calls for one run.',
    ],
    'all-disabled': [
      {
        kind: 'sources-unavailable',
        stage: 'discovery',
        searched: 0,
        sources: [{ providerId: 'fixture', skip: 'provider_disabled', detail: 'auth', until: null }],
      },
      stopText(
        {
          kind: 'sources-unavailable',
          stage: 'discovery',
          searched: 0,
          sources: [{ providerId: 'fixture', skip: 'provider_disabled', detail: 'auth', until: null }],
        },
        { tz: 'Europe/London', mode: 'container', scheduled: false },
      ).sentence,
    ],
    'child-cap': [{ kind: 'child-cap' }, "Stopped at the on-demand search's limit."],
    fatal: [{ kind: 'fatal' }, 'The app hit an error and stopped this search.'],
  };
  it.each(Object.entries(EVERY_STOP))(
    'finalStatus for a %s stop patches its exact cause and sentence',
    (k, stop) => {
      const run = causeRun({
        disabledDetail: new Map([['fixture', { skip: 'provider_disabled', detail: 'auth', until: null }]]),
        disabled: new Set(['fixture']),
        snapshot: { providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: {} } },
      });
      const { patch } = finalStatus(stop, NOW, 'Europe/London', run, false);
      const want = EXPECTED[stop.kind];
      expect([k, patch.stopCause, patch.errorText]).toEqual([k, ...want]);
      expect(apiContract.stopCauseSchema.parse(patch.stopCause)).toEqual(want[0]);
    },
  );

  it('a completed pass stores no cause', () => {
    expect(finalStatus(null, NOW, 'Europe/London', causeRun(), true).patch).not.toHaveProperty('stopCause');
  });

  it.each<Extract<StopCause, { kind: 'cancelled' | 'superseded' }>>([
    { kind: 'cancelled' },
    { kind: 'superseded', by: 'remove' },
  ])('Orchestrator.cancel of a stopped run stores %j', async (cause) => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { e } = await pausedRun(h);
    expect(await h.orch().cancel(e.id, cause)).toBe(true);
    expect(h.repos.executions.get(e.id)).toMatchObject({ status: 'cancelled', stopCause: cause });
  });

  it("the resume's stale supersede stores superseded stale; its never-started cancel stores never-started", async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { e } = await pausedRun(h);
    expect(await supersede(buildContext(h.deps, h.options), h.orch(), e)).toBe(true);
    expect(h.repos.executions.get(e.id)).toMatchObject({
      stopCause: { kind: 'superseded', by: 'stale' },
      errorText: 'Too old to carry on; a fresh run replaced it.',
    });
    const def = h.createDefinition({ name: 'never seeded' });
    const b = buildSnapshot(buildContext(h.deps, h.options), def);
    const ghost = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: b.snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    h.repos.executions.setStatus(ghost.id, 'interrupted');
    expect(await h.orch().resume(ghost.id, { manual: true })).toMatchObject({ ok: false, code: 'not_found' });
    expect(h.repos.executions.get(ghost.id)).toMatchObject({
      status: 'cancelled',
      stopCause: { kind: 'never-started' },
      errorText: 'This run never started.',
    });
  });
});

describe("the scheduler's skipped rows store theirs (revision 55 §8.1)", () => {
  it('skipped_confirm stores the estimate and the confirmation, both in pence', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const def = h.createDefinition({ scheduleCron: '0 5 * * 1' });
    h.repos.definitions.setConfirmed(def.id, { pence: 0, calls: 0 });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({
      ok: false,
      code: 'confirm',
    });
    const [row] = h.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false });
    expect(row).toMatchObject({
      status: 'skipped_confirm',
      stopCause: { kind: 'skipped-confirm', estimatePence: 1, confirmedPence: 0 },
    });
    expect(row?.errorText).toMatch(/^Skipped: /);
  });

  it('skipped_budget stores its scope and provider', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      scheduleCron: '0 5 * * 1',
      budget: { maxCalls: 0, maxFreeCalls: 1000, maxCostMicroGbp: 1_000_000_000 },
    });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({ ok: false, code: 'cap' });
    const [row] = h.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false });
    expect(row).toMatchObject({ status: 'skipped_budget', stopCause: { kind: 'skipped-budget' } });
    expect(apiContract.stopCauseSchema.parse(row?.stopCause)).toMatchObject({ scope: 'execution-calls' });
  });

  it('skipped_window and skipped_missed store theirs', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-03') },
      scheduleCron: '0 5 * * 1',
    });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({
      ok: false,
      code: 'window',
    });
    const [row] = h.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false });
    expect(row).toMatchObject({ status: 'skipped_window', stopCause: { kind: 'skipped-window' } });
    const other = h.createDefinition({ name: 'missed', scheduleCron: '0 5 * * 1' });
    const r = await recordSkipped(
      buildContext(h.deps, h.options),
      other,
      buildSnapshot(buildContext(h.deps, h.options), other, 'schedule').snapshot,
      null,
      'skipped_missed',
      'missed',
      { scheduledFor: asIsoDateTime('2026-10-12T04:00:00.000Z'), skipCode: 'half-cadence' },
      { kind: 'skipped-missed', code: 'half-cadence' },
    );
    if (!r.recorded) throw new Error('not recorded');
    expect(h.repos.executions.get(r.executionId)).toMatchObject({
      status: 'skipped_missed',
      stopCause: { kind: 'skipped-missed', code: 'half-cadence' },
    });
  });

  it('a scheduled firing refused for no runnable provider writes no row: it is a notice only', async () => {
    const h = createHarness();
    const def = h.createDefinition({
      scheduleCron: '0 5 * * 1',
      providers: { discovery: [], verification: [], discoveryRefreshHours: {} },
    });
    expect(await h.orch().start(def.id, { trigger: 'schedule' })).toMatchObject({
      ok: false,
      code: 'disabled',
    });
    expect(h.repos.executions.listForDefinition(def.id, { limit: 5, includeChildren: true })).toEqual([]);
  });
});

describe('a cancel that lands while a run is finishing on an earlier stop (R5)', () => {
  it('the run ends cancelled with the cancel’s cause, not paused on the earlier stop', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({
      budget: { maxCalls: 1000, maxFreeCalls: 1000, maxCostMicroGbp: 100_000 },
    });
    // why: the execution cost cap stops the pass before its first call (paused_budget), so the alerts step runs
    h.onStageStart('discovery', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 1, costMicroGbpEach: 100_000 - 3_199, executionId: id }),
    );
    let entered: () => void = () => undefined;
    const inAlerts = new Promise<void>((r) => {
      entered = r;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    // why: the alerts step runs after the budget stop and before finish: the cancel arrives exactly there
    const orch = h.orch({
      ...h.options,
      alerts: async () => {
        entered();
        await held;
        return { digests: 0, events: 0 };
      },
    });
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await inAlerts;
    const cancelled = orch.cancel(r.executionId, { kind: 'superseded', by: 'remove' });
    release();
    expect(await cancelled).toBe(true);
    expect(h.repos.executions.get(r.executionId)).toMatchObject({
      status: 'cancelled',
      stopCause: { kind: 'superseded', by: 'remove' },
      errorText: 'Stopped when the search was removed.',
    });
  });
});
