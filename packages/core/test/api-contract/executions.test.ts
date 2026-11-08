// Spec revision 56 §7 and §8.1: the stored flight-list plan's return and booking flags and stops (absent in a plan
// stored before WP21, read back as outbound-only), and the estimate's flight figures (typical and bound).
import { describe, expect, it } from 'vitest';
import { usageSchema } from '../../src/api-contract/common.js';
import { estimateSchema } from '../../src/api-contract/definitions.js';
import { flightListsStateSchema } from '../../src/api-contract/executions.js';

const plan = { planned: 10, cells: [], reused: 0, ended: null };
const estimate = {
  cells: 0,
  perProvider: [],
  totalCalls: 0,
  totalPlanCalls: 0,
  totalCostMicroGbp: 0,
  totalCostPence: 0,
  seconds: 0,
  assumptions: [],
  windowClamped: false,
  retryFactor: 1,
};

describe('flightListsStateSchema (spec rev 56 §7: returns, booking, returnsStopped, bookingStopped)', () => {
  it('accepts a plan without the four (a plan stored before WP21) and with them', () => {
    expect(flightListsStateSchema.parse(plan)).toEqual(plan);
    const full = {
      ...plan,
      returns: true,
      booking: true,
      returnsStopped: 'not-return-view',
      bookingStopped: null,
    };
    expect(flightListsStateSchema.parse(full)).toEqual(full);
  });
  it('refuses a stop that is not a worker rule, a flag that is not a boolean, and an undefined key', () => {
    expect(flightListsStateSchema.safeParse({ ...plan, returnsStopped: 'Not a rule' }).success).toBe(false);
    expect(flightListsStateSchema.safeParse({ ...plan, booking: 'yes' }).success).toBe(false);
    expect(flightListsStateSchema.safeParse({ ...plan, returns: undefined }).success).toBe(false);
  });
});

// Design 2026-11-08 §7: the step's stored summary (`confirm`): absent on a plan stored before the change, else the
// mode, the counts and the stop; every count a whole number, every word one of the listed ones.
describe('flightListsStateSchema.confirm (design 2026-11-08 §7)', () => {
  const confirm = { mode: 'confirm', confirmed: 16, unread: 0, uncheckedCheaper: 4, stop: 'patience' };

  it('accepts a plan without it (stored before the change), with each mode and each stop, and a null stop', () => {
    expect(flightListsStateSchema.parse(plan)).toEqual(plan);
    for (const mode of ['confirm', 'outbound-only', 'flags-unread'])
      for (const stop of ['patience', 'queue-empty', 'returns-stopped', null]) {
        const full = { ...plan, confirm: { ...confirm, mode, stop } };
        expect(flightListsStateSchema.parse(full)).toEqual(full);
      }
  });

  it('refuses another mode or stop, a negative or fractional count, a missing count, an extra key and undefined', () => {
    const bad = [
      { ...confirm, mode: 'returns' },
      { ...confirm, stop: 'window' },
      { ...confirm, confirmed: -1 },
      { ...confirm, unread: 1.5 },
      { mode: 'confirm', confirmed: 1, unread: 0, stop: null },
      { ...confirm, reads: 18 },
      undefined,
    ];
    for (const c of bad)
      expect(flightListsStateSchema.safeParse({ ...plan, confirm: c }).success).toBe(false);
  });
});

describe("estimateSchema.flightLists (spec rev 56 §8.1: pairs, returns, and the bound's pages and seconds)", () => {
  it('accepts the new figures and an older estimate without them, read with pairs = pages and returns false (A3)', () => {
    const older = { ...estimate, flightLists: { pages: 10, seconds: 700 } };
    expect(estimateSchema.parse(older)).toEqual({
      ...estimate,
      flightLists: { pages: 10, seconds: 700, pairs: 10, returns: false },
    });
    // why: the reader fills only what is absent; a stored outbound-only plan keeps its own pairs
    const outbound = { ...estimate, flightLists: { pages: 4, seconds: 280, pairs: 4, returns: false } };
    expect(estimateSchema.parse(outbound)).toEqual(outbound);
    const now = {
      ...estimate,
      flightLists: { pages: 15, seconds: 2450, pairs: 10, returns: true, pagesMax: 20, secondsMax: 3000 },
    };
    expect(estimateSchema.parse(now)).toEqual(now);
  });
  it('refuses a negative bound and a returns flag that is not a boolean', () => {
    expect(
      estimateSchema.safeParse({ ...estimate, flightLists: { pages: 1, seconds: 1, pagesMax: -1 } }).success,
    ).toBe(false);
    expect(
      estimateSchema.safeParse({ ...estimate, flightLists: { pages: 1, seconds: 1, returns: 'yes' } })
        .success,
    ).toBe(false);
  });
});

// Design 2026-11-08 §4.8: the per-run flight allowance is withdrawn; a run's usage states its flight pages with no cap.
describe('usageSchema.flightLists (design 2026-11-08 §4.8)', () => {
  const usage = {
    scope: 'provider-execution:camoufox',
    calls: 120,
    costMicroGbp: 0,
    costPence: 0,
    cap: null,
    windowStart: null,
    windowEnd: null,
  };
  it('states the flight pages with no cap, and refuses one with a cap', () => {
    const now = { ...usage, flightLists: { calls: 60 } };
    expect(usageSchema.parse(now)).toEqual(now);
    expect(usageSchema.safeParse({ ...usage, flightLists: { calls: 60, cap: 20 } }).success).toBe(false);
  });
});
