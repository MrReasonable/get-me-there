import { describe, expect, it } from 'vitest';
import {
  isPriceUnconfirmed,
  mergeWithinProvider,
  PRICE_UNCONFIRMED,
  rollUp,
} from '../../src/coverage/rollUp.js';
import { key, outcome } from '../helpers/space.js';

const K = key('LHR', 'JFK', '2027-03-01', '2027-03-08');
const priced = (minPence: number, reason: string | null = null) => outcome(K, 'priced', { minPence, reason });

describe('price-unconfirmed (decision 45)', () => {
  it('is a priced-reason part, read like partial-expansion', () => {
    expect(PRICE_UNCONFIRMED).toBe('price-unconfirmed');
    expect(isPriceUnconfirmed('price-unconfirmed')).toBe(true);
    expect(isPriceUnconfirmed('partial-expansion;price-unconfirmed;offers-dropped:2')).toBe(true);
    expect(isPriceUnconfirmed('partial-expansion')).toBe(false);
    expect(isPriceUnconfirmed(null)).toBe(false);
  });
  it('the roll-up price counts only confirmed outcomes; with none it is priced, unpriced and says so', () => {
    expect(rollUp([priced(30_000, 'price-unconfirmed'), priced(41_200)])).toEqual({
      status: 'priced',
      reason: null,
      minPence: 41_200,
    });
    expect(rollUp([priced(30_000, 'price-unconfirmed')])).toEqual({
      status: 'priced',
      reason: 'price-unconfirmed',
      minPence: null,
    });
    expect(rollUp([priced(30_000, 'partial-expansion;price-unconfirmed;offers-dropped:1')])).toEqual({
      status: 'priced',
      reason: 'partial-expansion;price-unconfirmed',
      minPence: null,
    });
  });
  it('a merge keeps the confirmed outcome over a cheaper unconfirmed one, in both argument orders', () => {
    const confirmed = priced(41_200);
    const unconfirmed = priced(30_000, 'price-unconfirmed');
    expect(mergeWithinProvider(confirmed, unconfirmed)).toEqual(confirmed);
    expect(mergeWithinProvider(unconfirmed, confirmed)).toEqual(confirmed);
    const cheaper = priced(29_000, 'price-unconfirmed');
    expect(mergeWithinProvider(unconfirmed, cheaper)).toEqual(cheaper);
  });
});
