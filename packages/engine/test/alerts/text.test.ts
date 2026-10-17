import { describe, expect, it } from 'vitest';
import { cleanLine } from '../../src/notifiers/operatorTemplates.js';
import { controlFree, stripControl } from '../../src/text.js';

// Spec §8.3 "provider strings CRLF/control-stripped"; decision 21; review TS-14, sec-007, arch-wp11-006.
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const C0 = range(0x00, 0x1f);
const C1 = range(0x80, 0x9f);
const SEPARATORS = [0x2028, 0x2029];
// bidi embeddings, overrides and isolates; zero-width and invisible characters; the byte-order mark
const HIDDEN = [
  0x00ad,
  0x061c,
  0x180e,
  ...range(0x200b, 0x200f),
  ...range(0x202a, 0x202e),
  ...range(0x2060, 0x2064),
  ...range(0x2066, 0x206f),
  0xfeff,
];

describe('the engine cleaner (text.ts)', () => {
  it.each([...C0, 0x7f, ...C1, ...SEPARATORS].map((c) => [c.toString(16).padStart(4, '0'), c]))(
    'U+%s becomes a space',
    (_hex, c) => {
      expect(controlFree(`a${String.fromCodePoint(c)}b`)).toBe('a b');
      expect(stripControl(`a${String.fromCodePoint(c)}b`)).toBe('a b');
    },
  );

  it.each(HIDDEN.map((c) => [c.toString(16).padStart(4, '0'), c]))('U+%s is removed', (_hex, c) => {
    expect(controlFree(`a${String.fromCodePoint(c)}b`)).toBe('ab');
  });

  it('a lone CR, a lone LF and CRLF each become one space; runs collapse and the ends are trimmed', () => {
    expect(stripControl('one\rtwo')).toBe('one two');
    expect(stripControl('one\ntwo')).toBe('one two');
    expect(stripControl('  one\r\n\r\ntwo\t ')).toBe('one two');
  });

  it('controlFree keeps leading spaces (a body line keeps its indentation) and every other character', () => {
    expect(controlFree('   Seller: Café Ünïcode £412 → 東京 🛫')).toBe(
      '   Seller: Café Ünïcode £412 → 東京 🛫',
    );
  });

  it('a right-to-left override cannot reverse the host a reader sees', () => {
    expect(stripControl('www.google.com\u202Emoc.live\u202C')).toBe('www.google.commoc.live');
  });

  it("the operator templates' cleanLine is the same cleaner after URL stripping", () => {
    expect(cleanLine('paused\r\nBcc: x\u2028\u202Ey https://h.example/p?key=1')).toBe(
      'paused Bcc: x y https://h.example/p',
    );
  });
});
