// Spec revision 56 §10: the scoped `/results` read's `datePairFigure` carries the same basis, grid price, pairing and
// `pairingRead` as the board's figure (one pairings map), so the detail and the board agree.
import { describe, expect, it } from 'vitest';
import { datePairFigureSchema } from '../../src/api-contract/datePairs.js';
import { resultsResponseSchema } from '../../src/api-contract/results.js';
import { calendarFigure, figurePairing, pairingFigure } from '../helpers/datePairs.js';

const base = {
  rows: [],
  total: 0,
  truncated: false,
  basis: 'calendar',
  basisReason: 'no itinerary-searched observations',
  executions: [],
  coverage: {
    buckets: { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 },
    total: 0,
    selected: 0,
    itinerarySearched: 0,
    onDemand: 0,
    reused: 0,
  },
  excludedByCurrentSpace: 0,
  verificationProviderConfigured: false,
  cheapest: null,
};

describe('resultsResponseSchema.datePairFigure (spec rev 56 §10)', () => {
  it("accepts basis 'pairing' with its grid price, pairing and pairingRead", () => {
    const { airportPair: _a, ...figure } = pairingFigure();
    expect(resultsResponseSchema.parse({ ...base, datePairFigure: figure }).datePairFigure).toEqual(figure);
  });
  it('accepts a calendar figure with a pairing beneath, and one without the new fields', () => {
    const { airportPair: _a, ...beneath } = calendarFigure({
      pairingRead: 'over-limit',
      pairing: figurePairing({ which: 'over-limit' }),
    });
    expect(resultsResponseSchema.safeParse({ ...base, datePairFigure: beneath }).success).toBe(true);
    const { airportPair: _b, gridPrice: _g, pairing: _p, pairingRead: _r, ...older } = calendarFigure();
    expect(datePairFigureSchema.safeParse(older).success).toBe(true);
    expect(resultsResponseSchema.safeParse({ ...base, datePairFigure: older }).success).toBe(true);
  });
  it('refuses a pairing figure without its grid price', () => {
    const { airportPair: _a, gridPrice: _g, ...figure } = pairingFigure();
    expect(resultsResponseSchema.safeParse({ ...base, datePairFigure: figure }).success).toBe(false);
  });
});
