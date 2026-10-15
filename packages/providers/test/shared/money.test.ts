import { describe, expect, it } from 'vitest';
import { majorToMinor } from '../../src/shared/money.js';

describe('majorToMinor (plan decision 24; spec §6.3: integer minor units, no float money, never rounded)', () => {
  it.each([
    [412, 'GBP', 41200],
    [412.5, 'GBP', 41250],
    [412.55, 'GBP', 41255],
    [0.29, 'GBP', 29],
    [0.01, 'GBP', 1],
    [1.1, 'USD', 110],
    [61000, 'JPY', 61000],
    [9007199254740.99, 'GBP', 900719925474099],
  ] as const)('%d %s → %i', (major, currency, expected) => {
    expect(majorToMinor(major, currency)).toBe(expected);
  });

  it.each([
    ['excess precision', 412.555, 'GBP'],
    ['a fraction of a yen', 61000.5, 'JPY'],
    ['zero', 0, 'GBP'],
    ['negative', -5, 'GBP'],
    ['NaN', Number.NaN, 'GBP'],
    ['infinite', Number.POSITIVE_INFINITY, 'GBP'],
    ['exponent form (tiny)', 1e-7, 'GBP'],
    ['exponent form (huge)', 1e21, 'GBP'],
    ['beyond the safe integer range', 1e17, 'GBP'],
    ['a currency with no known exponent', 412, 'QQQ'],
    ['a lower-case code (callers upper-case first)', 412, 'gbp'],
  ] as const)('null for %s', (_label, major, currency) => {
    expect(majorToMinor(major, currency)).toBeNull();
  });
});
