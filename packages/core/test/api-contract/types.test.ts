import { describe, expect, it } from 'vitest';
import { constraintsSchema, verificationPolicySchema } from '../../src/api-contract/definitions.js';
import { segmentSchema } from '../../src/api-contract/common.js';
import type { Constraints, VerificationPolicy } from '../../src/types/definition.js';
import type { Segment } from '../../src/types/itinerary.js';

// why: under exactOptionalPropertyTypes a `.optional()` field infers `T | undefined`, which is not
// assignable to the interfaces' `field?: T`; `.exactOptional()` keeps the two in step. These
// assignments are the compile-time check; the runtime assertions keep the file a real test.
describe('contract schemas are assignable to the core interfaces', () => {
  it('constraints', () => {
    const c: Constraints = constraintsSchema.parse({ maxStops: 1 });
    expect(c.maxStops).toBe(1);
  });
  it('verification policy', () => {
    const v: VerificationPolicy = verificationPolicySchema.parse({ maxCells: 2, topN: 1, alwaysInclude: [], expandTop: 1, bookingLinks: true });
    expect(v.priceCeilingPence).toBeUndefined();
  });
  it('segment', () => {
    const s: Segment = segmentSchema.parse({ marketingCarrier: 'BA', flightNumber: 1, from: 'LHR', to: 'JFK', departLocal: '2027-03-14T10:00', arriveLocal: '2027-03-14T13:00' });
    expect(s.operatingCarrier).toBeUndefined();
  });
});
