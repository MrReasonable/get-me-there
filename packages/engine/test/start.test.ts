// Spec revision 55 §8.1 "Manual and scheduled starts" (ruling A1) and `requireCovered` (ruling A4): `enabled` means
// scheduled runs happen and nothing else, and a main-path start confirms exactly the figures shown beside its button.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHarness, type Harness, refusedWith } from './support/harness.js';

const executions = (h: Harness, defId: string) =>
  h.repos.executions.listForDefinition(defId, { limit: 100, includeChildren: true });
const confirmDetails = z.object({ estimatePence: z.number(), totalCalls: z.number() }).loose();

describe('startExecution: manual starts never read `enabled` (revision 55 §8.1, ruling A1)', () => {
  it('a manual start of a search with enabled false starts and seeds the run; a scheduled firing of it is refused disabled and seeds nothing', async () => {
    const h = createHarness();
    const off = h.createDefinition({ enabled: false });
    const r = await h.orch().start(off.id, { trigger: 'manual' });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error(r.message);
    expect(h.outcomes(r.executionId).length).toBeGreaterThan(0);
    expect((await h.waitForSettled(r.executionId)).status).toBe('completed');
    const other = h.createDefinition({ enabled: false });
    expect(refusedWith(await h.orch().start(other.id, { trigger: 'schedule' }), 'disabled')).toBe(
      'this definition is disabled',
    );
    expect(executions(h, other.id)).toEqual([]);
  });
});

describe('requireCovered (revision 55 §8.1, ruling A4)', () => {
  // why: two tiles at 500,000 µGBP a call, × 1.2 = 1,200,000 µGBP: 120 p and 3 calls, below a SOFT_CONFIRM_PENCE of 500
  const world = () => createHarness({ fixtureCostMicroGbp: 500_000, env: { SOFT_CONFIRM_PENCE: '500' } });

  it('refuses confirm when the runnable estimate is above the figures sent, in pence or in calls, whatever SOFT_CONFIRM_PENCE', async () => {
    const h = world();
    const def = h.createDefinition();
    const o = h.orch();
    const short = await o.start(def.id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 10,
      requireCovered: true,
    });
    refusedWith(short, 'confirm');
    expect(confirmDetails.parse(short.ok ? null : short.details)).toMatchObject({
      estimatePence: 120,
      totalCalls: 3,
    });
    const fewCalls = await o.start(def.id, {
      trigger: 'manual',
      confirmCostPence: 120,
      confirmCalls: 2,
      requireCovered: true,
    });
    expect(refusedWith(fewCalls, 'confirm')).toMatch(/calls/);
    expect(confirmDetails.parse(fewCalls.ok ? null : fewCalls.details)).toMatchObject({ totalCalls: 3 });
    expect(executions(h, def.id)).toEqual([]);
  });

  it('without requireCovered the existing rule applies: below SOFT_CONFIRM the same figures start', async () => {
    const h = world();
    const r = await h.orch().start(h.createDefinition().id, {
      trigger: 'manual',
      confirmCostPence: 100,
      confirmCalls: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) await h.waitForSettled(r.executionId);
  });

  it('covered figures start on the first press; a run that needs nothing is covered by nothing sent', async () => {
    const h = world();
    const r = await h.orch().start(h.createDefinition().id, {
      trigger: 'manual',
      confirmCostPence: 120,
      confirmCalls: 3,
      requireCovered: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) await h.waitForSettled(r.executionId);
    const free = createHarness({ fixtureCostMicroGbp: 0 });
    const f = await free.orch().start(free.createDefinition().id, {
      trigger: 'manual',
      confirmCostPence: 0,
      confirmCalls: 3,
      requireCovered: true,
    });
    expect(f.ok).toBe(true);
    if (f.ok) await free.waitForSettled(f.executionId);
  });
});
