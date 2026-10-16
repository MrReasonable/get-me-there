import { ProviderError } from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { addSeconds } from '../src/errors.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { newRun, runnableCells } from '../src/run.js';
import {
  createHarness,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  itineraryRule,
  T0,
  withVerification,
} from './support/harness.js';
import { throwOnSearch } from './support/wrappers.js';

const kinds = (h: Harness) => h.notifications.map((m) => m.kind);
const verifying = (h: Harness, maxCells: number) =>
  h.createDefinition({
    providers: withVerification(),
    verification: { maxCells, topN: maxCells, alwaysInclude: [], expandTop: 1, bookingLinks: true },
  });
const searched = (h: Harness, id: string) =>
  h.outcomes(id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');

/** Runs a definition with `maxCells` selected cells under WP4 rules on /itinerary; fake timers drive the backoff; one call at a time. */
async function run(rules: FixtureRule[], maxCells: number, opts: HarnessOptions = {}) {
  const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true, ...opts });
  await h.fixtureScenario(rules);
  const ctx = buildContext(h.deps, h.options);
  const scheduleResume = vi.fn();
  ctx.hooks.scheduleResume = scheduleResume;
  const e = await h.runToCompletion(h.track(createOrchestrator(ctx)), verifying(h, maxCells).id);
  return { h, ctx, e, scheduleResume };
}

describe('error table, verification stage (spec §8.1; the rows share onFailure with discovery, Task 7.4)', () => {
  // why: one selected cell, so every attempt the rule answers (three for a retryable kind) belongs to that cell
  it.each([
    ['rate-limit', FIXTURE_RULES.rateLimit, 3],
    ['upstream', FIXTURE_RULES.upstream, 3],
    ['network', FIXTURE_RULES.network, 3],
    ['parse', FIXTURE_RULES.badRequest, 1],
  ] as const)(
    '%s on the searched cell → that cell error, attempts 1; the run completes',
    async (reason, respond, times) => {
      const { h, e } = await run([itineraryRule(respond, times)], 1);
      expect(e.status).toBe('completed');
      expect(searched(h, e.id)).toEqual([expect.objectContaining({ status: 'error', reason, attempts: 1 })]);
    },
  );

  it('two consecutive parse errors disable the provider; remaining selected cells skipped:provider_disabled; paused_error', async () => {
    const { h, e } = await run([itineraryRule(FIXTURE_RULES.badRequest, 2)], 4);
    expect(e.status).toBe('paused_error');
    const s = searched(h, e.id);
    expect(s.filter((o) => o.status === 'error' && o.reason === 'parse')).toHaveLength(2);
    expect(s.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(2);
    expect(kinds(h)).toEqual(['provider_disabled', 'paused_error']);
  });

  it.each([
    ['auth', FIXTURE_RULES.auth],
    ['quota', FIXTURE_RULES.quota],
  ] as const)('%s disables the provider; none remain → paused_error', async (reason, respond) => {
    const { h, e } = await run([itineraryRule(respond, 1)], 4);
    expect(e.status).toBe('paused_error');
    const s = searched(h, e.id);
    expect(s.filter((o) => o.status === 'error')).toEqual([expect.objectContaining({ reason })]);
    expect(s.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(3);
  });

  it('limiter-timeout → the cell returns to not_run; paused_error with resume_after; one-shot job requested', async () => {
    const { h, e, scheduleResume } = await run([itineraryRule(FIXTURE_RULES.limiterTimeout, 3)], 1);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBe(addSeconds(T0, 4000));
    expect(scheduleResume).toHaveBeenCalledWith(e.id, e.definitionId, addSeconds(T0, 4000));
    expect(searched(h, e.id)).toEqual([expect.objectContaining({ status: 'not_run' })]);
  });

  it('upstream with reason no-return-legs (WP4 rule) → error no-return-legs, which no resume query returns (spec §5.4, §7)', async () => {
    const { h, ctx, e } = await run([itineraryRule(FIXTURE_RULES.noReturnLegs)], 2);
    expect(e.status).toBe('completed');
    const s = searched(h, e.id);
    expect(s).toHaveLength(2);
    expect(s.every((o) => o.status === 'error' && o.reason === 'no-return-legs')).toBe(true);
    for (const manual of [false, true])
      expect(
        runnableCells(
          ctx,
          newRun(ctx, e, { manual, fresh: false, blocked: new Set() }),
          'verification',
          'fixture',
        ),
      ).toEqual([]);
  });

  it('upstream with reason no-priced-options → error no-priced-options; never retried, automatically or manually (spec §5.4, decision 37)', async () => {
    const err = new ProviderError({
      kind: 'upstream',
      retryable: false,
      reason: 'no-priced-options',
      providerId: 'fixture',
      message: 'step 1 returned options and none was priced',
    });
    const { h, ctx, e } = await run([], 2, { transformFixture: (p) => throwOnSearch(p, err, () => true) });
    expect(e.status).toBe('completed');
    const s = searched(h, e.id);
    expect(s).toHaveLength(2);
    expect(
      s.every(
        (o) =>
          o.status === 'error' &&
          o.reason === 'no-priced-options' &&
          o.lastError === 'step 1 returned options and none was priced',
      ),
    ).toBe(true);
    // why: the reason itself keeps them out of the repository's resume query (db NON_RETRYABLE), so no engine filter exists
    expect(h.repos.cells.resumable(e.id, 'verification', 'fixture', true)).toEqual([]);
    for (const manual of [false, true])
      expect(
        runnableCells(
          ctx,
          newRun(ctx, e, { manual, fresh: false, blocked: new Set() }),
          'verification',
          'fixture',
        ),
      ).toEqual([]);
  });
});

describe('cancel mid expansion → not_run, no itinerary (spec §9 item 4)', () => {
  it('a held itinerary call that is cancelled writes nothing for its cell', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const orch = h.orch();
    const r = await orch.start(verifying(h, 4).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const s = searched(h, e.id);
    expect(s).toHaveLength(4);
    expect(s.every((o) => o.status === 'not_run')).toBe(true);
    expect(h.count('price_observations', e.id)).toBe(0);
  });
});
