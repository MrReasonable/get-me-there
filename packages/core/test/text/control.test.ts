import { describe, expect, it } from 'vitest';
import { hasControlChars, stripControlChars } from '../../src/text/control.js';

describe('control characters (spec §8.3; review arch-r2-003)', () => {
  it.each([
    ['plain text', false],
    ['emoji 🛫 and accents é', false],
    ['tab\there', true],
    ['line\r\nbreak', true],
    ['nul\u0000', true],
    ['del\u007f', true],
    ['c1\u0085', true],
    ['c1 end\u009f', true],
    ['just past C1 ', false],
    ['space ', false],
  ])('%j → %s', (s, expected) => {
    expect(hasControlChars(s)).toBe(expected);
  });

  it('strips every control character and keeps everything else', () => {
    expect(stripControlChars('Seller\r\nInjected\u0000 🛫\u0085 ')).toBe('SellerInjected 🛫 ');
    expect(stripControlChars('clean')).toBe('clean');
  });
});
