import { asIsoDate, asIsoDateTime, cellKeyString } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { childCapPreview } from '../src/child.js';
import { buildContext } from '../src/context.js';
import {
  baseDefinition,
  createHarness,
  FIXTURE_RULES,
  type Harness,
  itineraryRule,
  JFK,
  LHR,
  noVerification,
  refusedWith,
  withVerification,
} from './support/harness.js';

const cell = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2026-11-03'),
  returnDate: asIsoDate('2026-11-10'),
};
const verifying = (h: Harness, patch = {}) => h.createDefinition({ providers: withVerification(), ...patch });

describe('single-cell verification (spec §8.1 "Single-cell verification", §6.7; ruling 7)', () => {
  it('needs no parent; creates a child that skips discovery with alwaysInclude = [cell], maxCells = topN = 1', async () => {
    const h = createHarness();
    const def = verifying(h);
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e).toMatchObject({ isChild: true, cell, status: 'completed', trigger: 'manual' });
    expect(e.snapshot.providers.discovery).toEqual([]);
    expect(e.snapshot.verification).toMatchObject({ alwaysInclude: [cell], maxCells: 1, topN: 1 });
    expect(h.outcomes(e.id, { stage: 'discovery' })).toHaveLength(0);
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v.map(cellKeyString)).toEqual([cellKeyString(cell)]);
    expect(v[0]?.status).toBe('priced');
    expect(h.repos.cells.selected(e.id)).toEqual([{ cell, reason: 'always_include' }]);
  });

  it('its call cap is the per-cell estimate × the retry factor, never below CHILD_MAX_CALLS; the rest of the budget inherited (spec rev 18, decision 14)', async () => {
    const h = createHarness();
    expect(h.config.spend.childMaxCalls).toBe(6);
    for (const [expandTop, maxCalls] of [
      [1, 6],
      [3, 9],
    ] as const) {
      // why: the fixture estimates 1 + 2 × expandTop calls a cell (SearchApi's shape): ceil(3 × 1.2) = 4, raised to the
      // floor of 6; ceil(7 × 1.2) = 9
      const def = verifying(h, {
        verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop, bookingLinks: true },
      });
      const r = await h.orch().verifyCell(def.id, cell);
      if (!r.ok) throw new Error(r.message);
      const e = await h.waitForSettled(r.executionId);
      expect(e.snapshot.budget).toEqual({ ...def.budget, maxCalls });
      expect(e.status).toBe('completed');
    }
  });

  it('is bounded by the parent’s headroom above the floor: a 4-call cell with 2 calls left gets the floor of 6 and runs; a 9-call cell with 7 left is refused', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const o = h.orch();
    const small = verifying(h);
    const big = verifying(h, {
      verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 3, bookingLinks: true },
    });
    for (const [def, spent] of [
      [small, 998],
      [big, 993],
    ] as const) {
      const parent = await o.start(def.id, { trigger: 'manual' });
      if (!parent.ok) throw new Error(parent.message);
      h.spendLedger({
        providerId: 'fixture',
        rows: spent,
        costMicroGbpEach: 0,
        executionId: parent.executionId,
      });
    }
    const floor = await o.verifyCell(small.id, cell);
    if (!floor.ok) throw new Error(floor.message);
    expect(h.repos.executions.get(floor.executionId)?.snapshot.budget.maxCalls).toBe(6);
    expect((await h.waitForSettled(floor.executionId)).status).toBe('completed');
    const refused = await o.verifyCell(big.id, cell);
    expect(refused).toMatchObject({ ok: false, code: 'cap', details: { headroom: 7, need: 9 } });
    expect(refused.ok ? '' : refused.message).toContain('has room for 7 of the 9 calls this cell needs');
  });

  it("counts what the definition's other active children may still spend against the headroom (cost-r2-001)", async () => {
    const h = createHarness();
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const def = verifying(h, {
      verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 3, bookingLinks: true },
      budget: { ...baseDefinition().budget, maxCalls: 16 },
    });
    const o = h.orch();
    // why: no active parent, so the headroom is the definition's maxCalls (16) less what held children may still spend
    const first = await o.verifyCell(def.id, cell);
    if (!first.ok) throw new Error(first.message);
    expect(h.repos.executions.get(first.executionId)?.snapshot.budget.maxCalls).toBe(9);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const used = h.deps.budget.usage({ kind: 'execution-calls', executionId: first.executionId }).calls;
    const second = await o.verifyCell(def.id, { ...cell, returnDate: asIsoDate('2026-11-11') });
    // without the subtraction the second child would get 9 of 16 and start; with it the headroom is below its need
    expect(second).toMatchObject({ ok: false, code: 'cap', details: { headroom: 16 - (9 - used), need: 9 } });
    await h.releaseHolds();
    expect((await h.waitForSettled(first.executionId)).status).toBe('completed');
  });

  it('never pauses: a cap breach ends the child cancelled with "child cap reached", its cell skipped:budget, and a new child can start', async () => {
    const h = createHarness();
    const def = verifying(h);
    // why: the child's cap is the floor of 6; spending all 6 before its first call makes that call breach
    h.onStageStart('verification', (id) =>
      h.spendLedger({ providerId: 'fixture', rows: 6, costMicroGbpEach: 0, executionId: id }),
    );
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e).toMatchObject({ status: 'cancelled', errorText: 'child cap reached', resumeAfter: null });
    expect(h.outcomes(e.id, { stage: 'verification' })).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'budget' }),
    ]);
    // the breach came before any fixture call (test-strategy-reviewer-030)
    expect(h.ledgerRows(e.id)).toHaveLength(6);
    expect(h.requests.filter((q) => q.kind === 'itinerary')).toEqual([]);
    expect(h.notifications).toHaveLength(0);
    h.clearHooks();
    const again = await h.orch().verifyCell(def.id, cell);
    if (!again.ok) throw new Error(again.message);
    expect((await h.waitForSettled(again.executionId)).status).toBe('completed');
  });

  it('childCapPreview shows the cap and headroom the next child gets, by the same calculation (decision 45)', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const o = h.orch();
    const def = verifying(h, {
      verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 3, bookingLinks: true },
    });
    expect(childCapPreview(ctx, def.id, cell)).toEqual({ ok: true, maxCalls: 9, headroomCalls: 1000 });
    const parent = await o.start(def.id, { trigger: 'manual' });
    if (!parent.ok) throw new Error(parent.message);
    h.spendLedger({ providerId: 'fixture', rows: 991, costMicroGbpEach: 0, executionId: parent.executionId });
    expect(childCapPreview(ctx, def.id, cell)).toEqual({ ok: true, maxCalls: 9, headroomCalls: 9 });
    const r = await o.verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    expect(h.repos.executions.get(r.executionId)?.snapshot.budget.maxCalls).toBe(9);
    // why: the refusals carry StartResult's codes, so WP8 tells them apart without reading messages (code-architect review 16)
    expect(childCapPreview(ctx, 'no-such-definition', cell)).toEqual({
      ok: false,
      code: 'not_found',
      message: 'definition no-such-definition not found',
    });
    expect(
      childCapPreview(ctx, def.id, {
        ...cell,
        departureDate: asIsoDate('2027-01-04'),
        returnDate: asIsoDate('2027-01-11'),
      }),
    ).toEqual({ ok: false, code: 'window', message: 'the cell is not in the current search space' });
    // why: re-review N4 — every refusal verifyCell makes before sizing, the preview makes too, so no button always fails
    const discoveryOnly = h.createDefinition({ name: 'discovery only' });
    expect(childCapPreview(ctx, discoveryOnly.id, cell)).toEqual({
      ok: false,
      code: 'window',
      message: 'this definition has no verification provider',
    });
    expect(refusedWith(await o.verifyCell(discoveryOnly.id, cell), 'window')).toBe(
      'this definition has no verification provider',
    );
  });

  it('asks for confirmation above SOFT_CONFIRM like any execution, and runs once the cost and calls are confirmed (cost M-1)', async () => {
    const h = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' } });
    const def = verifying(h);
    const o = h.orch();
    const details = z.object({ estimatePence: z.number(), totalCalls: z.number() });
    const refusal = await o.verifyCell(def.id, cell);
    expect(refusedWith(refusal, 'confirm')).toContain('has not been confirmed');
    if (refusal.ok) throw new Error('expected a refusal');
    const seen = details.parse(refusal.details);
    expect(h.requests).toEqual([]);
    const r = await o.verifyCell(def.id, cell, {
      confirmCostPence: seen.estimatePence,
      confirmCalls: seen.totalCalls,
    });
    expect(r.ok).toBe(true);
  });

  it('allows at most one active child per cell', async () => {
    const h = createHarness();
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const def = verifying(h);
    const o = h.orch();
    const first = await o.verifyCell(def.id, cell);
    expect(first.ok).toBe(true);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await o.verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'active' });
    const other = await o.verifyCell(def.id, { ...cell, returnDate: asIsoDate('2026-11-11') });
    expect(other.ok).toBe(true);
  });

  it('a child that loses the race to the one-active-child index is refused with code active (code-architect review 3)', async () => {
    const h = createHarness();
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold)]);
    const def = verifying(h);
    const o = h.orch();
    expect((await o.verifyCell(def.id, cell)).ok).toBe(true);
    // why: the read-side check races a concurrent request; hiding the first child from it makes the insert hit the index
    vi.spyOn(h.repos.executions, 'activeChild').mockReturnValue(null);
    expect(refusedWith(await o.verifyCell(def.id, cell), 'active')).toBe(
      'this cell is already being verified',
    );
  });

  it('refuses a cell outside the current space or already departed, and a definition without a verification provider, with code window', async () => {
    const h = createHarness();
    const def = verifying(h);
    expect(
      await h.orch().verifyCell(def.id, {
        ...cell,
        departureDate: asIsoDate('2026-12-01'),
        returnDate: asIsoDate('2026-12-08'),
      }),
    ).toMatchObject({ ok: false, code: 'window' });
    const plain = h.createDefinition({ providers: noVerification() });
    expect(await h.orch().verifyCell(plain.id, cell)).toMatchObject({
      ok: false,
      code: 'window',
      message: 'this definition has no verification provider',
    });
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // the cell departs today
    expect(await h.orch().verifyCell(def.id, cell)).toMatchObject({ ok: false, code: 'window' });
  });

  it('is included in results inputs and newest-outcome reads; excluded from latest execution', async () => {
    const h = createHarness();
    const def = verifying(h);
    const parent = await h.runToCompletion(h.orch(), def.id);
    h.clock.advance(3_600_000);
    const r = await h.orch().verifyCell(def.id, cell);
    if (!r.ok) throw new Error(r.message);
    const child = await h.waitForSettled(r.executionId);
    expect(h.repos.executions.latestCompleted(def.id)?.id).toBe(parent.id);
    const obs = h.repos.itineraries.observationsForDefinition(def.id, {
      executionIds: [child.id],
      space: child.snapshot.resolved,
      cabin: 'economy',
      includeChildren: true,
    });
    expect(obs.length).toBeGreaterThan(0);
    expect(h.repos.itineraries.latestVerificationOutcomeForCell(def.id, cell, 'economy')?.executionId).toBe(
      child.id,
    );
  });
});
