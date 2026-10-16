import { describe, expect, it } from 'vitest';
import { isPartialExpansion, isPriceUnconfirmed, pricedReason } from '../../src/coverage/rollUp.js';
import * as core from '../../src/index.js';

describe('pricedReason, the one writer of the priced-reason grammar (decisions 19, 45, 48; code-architect review 4)', () => {
  it('builds the closed set: `;`-joined parts ordered partial-expansion, price-unconfirmed, offers-dropped:n', () => {
    expect([
      pricedReason(false, false, 0),
      pricedReason(true, false, 0),
      pricedReason(false, false, 2),
      pricedReason(true, false, 1),
      pricedReason(false, true, 0),
      pricedReason(true, true, 3),
    ]).toEqual([
      null,
      'partial-expansion',
      'offers-dropped:2',
      'partial-expansion;offers-dropped:1',
      'price-unconfirmed',
      'partial-expansion;price-unconfirmed;offers-dropped:3',
    ]);
    expect(core.pricedReason).toBe(pricedReason);
  });
  it('is read back by the parsers', () => {
    const r = pricedReason(true, true, 3);
    expect(isPartialExpansion(r)).toBe(true);
    expect(isPriceUnconfirmed(r)).toBe(true);
  });
  it('refuses a dropped count that is not a non-negative integer', () => {
    expect(() => pricedReason(false, false, -1)).toThrow(RangeError);
    expect(() => pricedReason(false, false, 1.5)).toThrow(
      'offers-dropped must be a non-negative integer, got 1.5',
    );
  });
});
