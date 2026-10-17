import { apiContract } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as fx from './fixtures.js';
import { drainGuards, expectConsoleErrors } from './guards.js';

describe('test harness (reviews tsr-004, tsr-006, tsr2-006, tsr2-010)', () => {
  it('the fixtures agree on one small definition: 126 cells, the run policy and the stored confirmation', () => {
    expect([
      fx.resultsResponse().coverage.total,
      fx.coverageResponse().summary.total,
      fx.estimate().cells,
    ]).toEqual([126, 126, 126]);
    expect([fx.summary().expandTop, fx.definition().verification.expandTop]).toEqual([2, 2]);
    expect([fx.definition().confirmedCalls, fx.estimate().totalCalls]).toEqual([154, 154]);
  });

  it('a fixture that drifts from the contract fails at build time', () => {
    const offer = {
      seller: 'x',
      pricePence: 1,
      provenance: fx.provSearch,
      booking: { kind: 'none' as const },
      stale: false,
      ageHours: 1,
      verdictClass: 'verified' as const,
      unverified: [],
      notSeenInLatest: null,
    };
    expect(() => fx.verifiedRow({ otherOffers: [offer] })).not.toThrow();
    const { notSeenInLatest: _drop, ...withoutNotSeen } = offer;
    expect(
      apiContract.resultRowSchema.safeParse({ ...fx.verifiedRow(), otherOffers: [withoutNotSeen] }).success,
    ).toBe(false);
    const { fetchedAt: _fetched, ...noFetchedAt } = fx.provSearch;
    expect(() => fx.verifiedRow({ provenance: noFetchedAt })).toThrow(/fetchedAt/);
    expect(() => fx.verifiedRow({ pricePence: 412.5 })).toThrow();
  });

  it('an unmatched request is recorded by the catch-all, so afterEach fails the test', async () => {
    await fetch('http://localhost:3000/api/not-handled').catch(() => undefined);
    expect(drainGuards()).toEqual(['request no handler matched: GET http://localhost:3000/api/not-handled']);
  });

  it('an unannounced console.error fails the test; an announced one passes; an announced one that never came fails', () => {
    console.error('planted');
    expect(drainGuards()).toEqual(['console.error during the test: planted']);
    expectConsoleErrors(/price withheld/);
    console.error('[price withheld] boom');
    console.error('Warning: unrelated');
    expect(drainGuards()).toEqual(['console.error during the test: Warning: unrelated']);
    expectConsoleErrors(/price withheld/);
    expect(drainGuards()).toEqual(['expected console.error /price withheld/ never occurred']);
  });
});
