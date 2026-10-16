import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { priceInGbp, type RateLookup } from '../../src/normalise/money.js';
import { asIsoDate } from '../../src/types/ids.js';

const USD_NANO = 787_401_575; // 1 / 1.27 GBP per USD × 1e9
const rateDate = asIsoDate('2026-10-14');
const usdOnly: RateLookup = (c) => (c === 'USD' ? { rateNano: USD_NANO, rateDate, source: 'ecb' } : null);
const reasonOf = (f: () => unknown): string => {
  try {
    f();
  } catch (err) {
    if (err instanceof NormalisationError) return err.reason;
    throw err;
  }
  throw new Error('expected a NormalisationError');
};

describe('priceInGbp (spec §5.6, §6.3; arch-r2-002)', () => {
  it('GBP passes through unconverted, whatever its case, and never asks for a rate', () => {
    const asked: string[] = [];
    const rateFor: RateLookup = (c) => {
      asked.push(c);
      return null;
    };
    expect(priceInGbp({ amountMinor: 41_200, currency: 'gbp' }, rateFor)).toEqual({
      pricePence: 41_200,
      fx: { converted: false },
    });
    expect(asked).toEqual([]);
  });
  it('an ECB currency with a rate converts half-up and records rate, date and source together', () => {
    expect(priceInGbp({ amountMinor: 52_000, currency: 'usd' }, usdOnly)).toEqual({
      pricePence: 40_945,
      fx: { converted: true, rateNano: USD_NANO, rateDate, source: 'ecb' },
    });
  });
  it('asks for the rate by the upper-cased code; no rate → fx-unavailable; outside the ECB list → currency-unsupported', () => {
    const asked: string[] = [];
    const none: RateLookup = (c) => {
      asked.push(c);
      return null;
    };
    expect(reasonOf(() => priceInGbp({ amountMinor: 1, currency: 'eur' }, none))).toBe('fx-unavailable');
    expect(asked).toEqual(['EUR']);
    expect(reasonOf(() => priceInGbp({ amountMinor: 1, currency: 'ARS' }, usdOnly))).toBe(
      'currency-unsupported',
    );
  });
  it('an amount that is not a non-negative integer is a RangeError, in GBP as in any other currency', () => {
    expect(() => priceInGbp({ amountMinor: -1, currency: 'GBP' }, usdOnly)).toThrow(RangeError);
    expect(() => priceInGbp({ amountMinor: 12.5, currency: 'GBP' }, usdOnly)).toThrow(RangeError);
    expect(() => priceInGbp({ amountMinor: -1, currency: 'USD' }, usdOnly)).toThrow(RangeError);
  });
});
