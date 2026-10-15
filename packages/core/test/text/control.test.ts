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

  it('replaces each control character with the given replacement, one for one', () => {
    expect(stripControlChars('a\r\nb\u0000c', ' ')).toBe('a  b c');
    expect(stripControlChars('clean', ' ')).toBe('clean');
    expect(stripControlChars('a\tb', '')).toBe('ab');
  });

  it('covers exactly Cc: U+0000-U+001F, U+007F, U+0080-U+009F', () => {
    const cc = (code: number) => String.fromCharCode(code);
    for (const code of [0x00, 0x1f, 0x7f, 0x80, 0x9f]) expect(stripControlChars(`x${cc(code)}y`)).toBe('xy');
    // first code point either side of each range, and the Unicode line/paragraph separators, stay
    for (const code of [0x20, 0x7e, 0xa0, 0x2028, 0x2029])
      expect(stripControlChars(`x${cc(code)}y`)).toBe(`x${cc(code)}y`);
  });
});
