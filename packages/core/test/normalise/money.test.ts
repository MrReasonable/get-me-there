import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { ECB_CURRENCIES, MINOR_EXPONENT, toGbp } from '../../src/normalise/money.js';

describe('toGbp (spec §6.3): rateNano = GBP per 1 native unit × 1e9, half-up to the penny', () => {
  it('CNY reference: ¥4,123.45 (412345 minor, exponent 2) at 1 CNY = £0.1043 (rateNano 104_300_000) → 43008p', () => {
    // 4123.45 × 0.1043 = £430.075835 → 43007.5835p → half-up → 43008p
    expect(toGbp(412_345, 'CNY', 104_300_000)).toBe(43_008);
  });

  it('JPY reference: ¥82,000 (82000 minor, exponent 0) at 1 JPY = £0.00502 (rateNano 5_020_000) → 41164p exactly', () => {
    expect(toGbp(82_000, 'JPY', 5_020_000)).toBe(41_164);
  });

  it('direction: ¥100.00 CNY at £0.1043 is £10.43, not ¥100 ÷ 0.1043', () => {
    expect(toGbp(10_000, 'CNY', 104_300_000)).toBe(1_043);
  });

  it('rounds exactly half up and anything below half down', () => {
    expect(toGbp(1, 'JPY', 5_000_000)).toBe(1); // 0.5p
    expect(toGbp(1, 'JPY', 4_999_999)).toBe(0); // 0.4999999p
    expect(toGbp(1, 'CNY', 500_000_000)).toBe(1); // 0.01 CNY × £0.50 = 0.5p
    expect(toGbp(3, 'JPY', 5_000_000)).toBe(2); // 1.5p
  });

  it('zero is zero', () => {
    expect(toGbp(0, 'USD', 790_000_000)).toBe(0);
  });

  it('large amounts stay exact: $1,000,000,000.00 at £0.79 is 79_000_000_000p', () => {
    expect(toGbp(100_000_000_000, 'USD', 790_000_000)).toBe(79_000_000_000);
  });

  it('a result beyond Number.MAX_SAFE_INTEGER throws instead of losing pence', () => {
    expect(() => toGbp(Number.MAX_SAFE_INTEGER, 'USD', 2_000_000_000)).toThrow(RangeError);
  });

  it('GBP is the identity and ignores the rate', () => {
    expect(toGbp(41_200, 'GBP', 1)).toBe(41_200);
  });

  it.each([412.5, Number.NaN, -1, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects non-integer or negative amount %s',
    (a) => {
      expect(() => toGbp(a, 'EUR', 860_000_000)).toThrow(RangeError);
      expect(() => toGbp(a, 'GBP', 1)).toThrow(RangeError);
    },
  );

  it.each([1.5, 0, -860_000_000])('rejects rate %s', (r) => {
    expect(() => toGbp(100, 'EUR', r)).toThrow(RangeError);
  });

  it('a currency without an exponent is currency-unsupported', () => {
    expect(() => toGbp(100, 'XAU', 1)).toThrow(NormalisationError);
  });

  it('ECB list and exponents (frankfurter 2026-10-14)', () => {
    const list =
      'AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR';
    expect(ECB_CURRENCIES).toEqual(list.split(' '));
    expect(ECB_CURRENCIES).not.toContain('BGN');
    expect(MINOR_EXPONENT).toEqual(
      Object.fromEntries(list.split(' ').map((c) => [c, ['ISK', 'JPY', 'KRW'].includes(c) ? 0 : 2])),
    );
  });

  it('property: within half a penny of the exact value and monotone in the amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (a, r) => {
          const p = toGbp(a, 'EUR', r);
          const exact = (a * r) / 1e9; // EUR exponent 2: minor × rate / 1e9 is pence
          expect(Math.abs(p - exact)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(toGbp(a + 1, 'EUR', r)).toBeGreaterThanOrEqual(p);
        },
      ),
    );
  });
});
