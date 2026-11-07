// Spec revision 55 §8.1 "Stop causes" and "Automatic resume and the unscheduled search" (Ian's ruling 2 of 2026-10-31),
// through whole passes: what finish stores for a stop, and which pauses a timer or the boot may carry on.
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { autoResume } from '../src/scheduler/catchUp.js';
import { engineWith, realTime, storeStoppedAtPageCap, stubCamoufox } from './support/camoufox.js';
import { createHarness, FIXTURE_COST_MICRO_GBP, JFK, LGW, LHR } from './support/harness.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// why: a synthetic secret, as every test's sentinel is; it must never reach a stored cause or sentence
const SENTINEL = 'test-worker-key-0123456789abcdef0123456789abcdef';

describe('a cause on every stop (revision 55 §8.1)', () => {
  it("a run whose only source's preflight refuses provider_unavailable ends paused_error with sources-unavailable, its sentence and no resume", async () => {
    realTime();
    const e = engineWith([
      stubCamoufox({
        cells: 4,
        preflight: { ok: false, skip: 'provider_unavailable', detail: 'browser worker not reachable' },
      }),
    ]);
    const ex = await e.runToEnd();
    expect(ex).toMatchObject({
      status: 'paused_error',
      resumeAfter: null,
      errorText: "The browser worker isn't answering, so nothing was searched.",
      stopCause: {
        kind: 'sources-unavailable',
        stage: 'discovery',
        searched: 0,
        sources: [
          {
            providerId: 'camoufox',
            skip: 'provider_unavailable',
            detail: 'provider-unavailable',
            until: null,
          },
        ],
      },
    });
  });

  it("a preflight's vendor sentence is stored as its class word only: no sentinel in the cause or error_text (test-010)", async () => {
    realTime();
    const e = engineWith([
      stubCamoufox({
        cells: 4,
        preflight: { ok: false, skip: 'provider_disabled', detail: `the worker refused key ${SENTINEL}` },
      }),
    ]);
    const ex = await e.runToEnd();
    const cause = ex.stopCause;
    if (cause?.kind !== 'sources-unavailable') throw new Error('expected sources-unavailable');
    expect(apiContract.STOP_DETAILS).toContain(cause.sources[0].detail);
    expect(JSON.stringify(cause)).not.toContain(SENTINEL);
    expect(ex.errorText).not.toContain(SENTINEL);
    expect(ex.errorText).not.toContain('refused key');
  });

  it('a cancel stores the cancelled cause and its sentence', async () => {
    realTime();
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const e = engineWith([stubCamoufox({ cells: 4, holdCall: { call: 1, until: hold } })]);
    const r = await e.orch.start(e.definition.id, {
      trigger: 'manual',
      confirmCostPence: 0,
      confirmCalls: 100,
    });
    if (!r.ok) throw new Error(r.message);
    const cancelled = e.orch.cancel(r.executionId, { kind: 'cancelled' });
    release();
    expect(await cancelled).toBe(true);
    expect(e.ctx.repos.executions.get(r.executionId)).toMatchObject({
      status: 'cancelled',
      stopCause: { kind: 'cancelled' },
      errorText: 'Stopped by you.',
    });
  });
});

describe("no automatic resume for an unscheduled search (Ian's ruling 2)", () => {
  /** A run of a two-pair search paused at the fixture's monthly call cap (19 of 20 calls spent before the stage). */
  async function pausedAtMonth(scheduleCron: string | null) {
    const h = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 20 });
    h.onStageStart('discovery', () =>
      h.spendLedger({ providerId: 'fixture', rows: 19, costMicroGbpEach: FIXTURE_COST_MICRO_GBP }),
    );
    const ctx = buildContext(h.deps, h.options);
    const scheduleResume = vi.fn();
    ctx.hooks.scheduleResume = scheduleResume;
    const orch = h.track(createOrchestrator(ctx));
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], scheduleCron });
    const e = await h.runToCompletion(orch, def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 1000,
    });
    h.clearHooks();
    return { h, ctx, orch, e, scheduleResume };
  }

  it('a budget pause of a search with enabled 1 and no cron stores resumeAfter null and resetsAt, registers no job, and autoResume skips it', async () => {
    const { ctx, orch, e, scheduleResume } = await pausedAtMonth(null);
    expect(e).toMatchObject({
      status: 'paused_budget',
      resumeAfter: null,
      stopCause: {
        kind: 'budget',
        scope: 'provider-month',
        resumeAfter: null,
        resetsAt: '2026-11-01T00:00:00.000Z',
      },
    });
    expect(scheduleResume).not.toHaveBeenCalled();
    const resume = vi.spyOn(orch, 'resume');
    expect(await autoResume(ctx, orch, e)).toBeNull();
    expect(resume).not.toHaveBeenCalled();
    expect(ctx.repos.executions.get(e.id)?.status).toBe('paused_budget');
  });

  it('the same pause of a scheduled search keeps its resume_after, its one-shot job, and autoResume carries it on', async () => {
    const { ctx, orch, e, scheduleResume } = await pausedAtMonth('0 5 * * 1');
    expect(e).toMatchObject({ status: 'paused_budget', resumeAfter: '2026-11-01T00:00:00.000Z' });
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, '2026-11-01T00:00:00.000Z');
    const resume = vi.spyOn(orch, 'resume');
    expect(await autoResume(ctx, orch, e)).not.toBeNull();
    expect(resume).toHaveBeenCalledWith(e.id, { manual: false });
  });

  it("a manual resume of a run stored at the browser worker's withdrawn per-run page limit is refused cap", async () => {
    realTime();
    const e = engineWith([stubCamoufox({ cells: 2 })]);
    const ex = await e.runToEnd();
    storeStoppedAtPageCap(e, ex.id);
    expect(await e.resumeResult(ex.id, { manual: true })).toMatchObject({ ok: false, code: 'cap' });
    expect(e.ctx.repos.executions.get(ex.id)?.status).toBe('paused_budget');
  });
});
