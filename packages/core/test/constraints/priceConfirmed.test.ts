import { describe, expect, it } from 'vitest';
import { constraintNameSchema, verdictsSchema } from '../../src/api-contract/common.js';
import { evaluateConstraints } from '../../src/constraints/evaluate.js';
import { CONSTRAINT_LABELS, CONSTRAINT_NAMES } from '../../src/constraints/labels.js';
import { unverifiedNames, verdictClass } from '../../src/constraints/verdictClass.js';
import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { SuppliedField } from '../../src/types/itinerary.js';
import { cellOf, deps, offer } from '../helpers/offers.js';

// why: every segment states its cabin, so `cabin` passes and only priceConfirmed decides the class
const raw = offer();
const stated = {
  ...raw,
  outbound: raw.outbound.map((s) => ({ ...s, cabin: 'economy' as const })),
  inbound: raw.inbound.map((s) => ({ ...s, cabin: 'economy' as const })),
};
const normalised = normaliseOffer(stated, cellOf(stated), deps());
if (!normalised.ok) throw normalised.error;
const { itinerary, observation } = normalised;
const judge = (supplied: readonly SuppliedField[], constraints = {}) =>
  evaluateConstraints(itinerary, observation, constraints, 'economy', supplied);
const ALL: SuppliedField[] = ['price', 'segments', 'segmentTimes', 'segmentCabins'];

describe('priceConfirmed (decision 37: a price no seller listing confirmed)', () => {
  it("without 'price' among the supplied fields the offer is unverified on priceConfirmed whatever the constraints", () => {
    const v = judge(ALL.filter((f) => f !== 'price'));
    expect(v).toEqual({ cabin: 'pass', priceConfirmed: 'unverified' });
    expect(verdictClass(v)).toBe('partially-verified');
    expect(unverifiedNames(v)).toEqual(['priceConfirmed']);
    expect(CONSTRAINT_LABELS.priceConfirmed).toBe('price not confirmed by the final step');
    // a failed constraint still classes the row failed
    expect(
      verdictClass(
        judge(
          ALL.filter((f) => f !== 'price'),
          { maxStops: -1 },
        ),
      ),
    ).toBe('failed');
  });
  it("with 'price' supplied nothing is added, so a fully evidenced offer still classes verified", () => {
    const v = judge(ALL);
    expect(v).toEqual({ cabin: 'pass' });
    expect(verdictClass(v)).toBe('verified');
  });
  it('is a constraint name of the api contract, last in the fixed order', () => {
    expect(CONSTRAINT_NAMES[CONSTRAINT_NAMES.length - 1]).toBe('priceConfirmed');
    expect(constraintNameSchema.options).toEqual([...CONSTRAINT_NAMES]);
    expect(verdictsSchema.parse({ cabin: 'pass', priceConfirmed: 'unverified' })).toEqual({
      cabin: 'pass',
      priceConfirmed: 'unverified',
    });
  });
});
