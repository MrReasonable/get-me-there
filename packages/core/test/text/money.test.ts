import { describe, expect, it } from 'vitest';
import { formatPence } from '../../src/text/money.js';

describe('formatPence (the one money formatter; review arch-004)', () => {
  it.each([
    [0, '£0'],
    [5, '£0.05'],
    [41_200, '£412'],
    [41_205, '£412.05'],
    [123_456, '£1,234.56'],
    [100_000_000, '£1,000,000'],
  ])('%i → %s', (pence, text) => {
    expect(formatPence(pence)).toBe(text);
  });

  it.each([412.5, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (pence) => {
    expect(() => formatPence(pence)).toThrow(RangeError);
  });
});
