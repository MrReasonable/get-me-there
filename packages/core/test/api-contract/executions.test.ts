// Spec revision 56 §7 and §8.1: the stored flight-list plan's return and booking flags and stops (absent in a plan
// stored before WP21, read back as outbound-only), and the estimate's flight figures (typical and bound).
import { describe, expect, it } from 'vitest';
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
