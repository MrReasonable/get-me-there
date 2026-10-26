import { describe, expect, it } from 'vitest';
import { rejectionMark as reExported } from '../src/consentLine.js';
import { rejectionMark } from '../src/socsMark.js';

// why: research 17.0c (2026-10-25) and review X1: the mark is read only from a value of the observed shape (field 1 a
// one-byte varint, then field 2 length-delimited, then well-formed fields). Every value here is synthetic, built from
// bytes chosen for the test (a filler spelling "test-only"); no recorded value is ever copied into a test.
const b64 = (bytes: readonly number[]): string => Buffer.from(bytes).toString('base64url');
const FIELD2 = [0x12, 0x09, ...Buffer.from('test-only')];
const FIELD3 = [0x1a, 0x02, 0x41, 0x42];
const REJECT = b64([0x08, 0x01, ...FIELD2, ...FIELD3]);
const ACCEPT = b64([0x08, 0x02, ...FIELD2, ...FIELD3]);
const mark = (bytes: readonly number[]) => rejectionMark(b64(bytes));

describe('rejectionMark: field 1 of a well-formed SOCS message', () => {
  it('reads field 1 = 1 as a rejection and 2 as an acceptance, in the observed shape', () => {
    expect(rejectionMark(REJECT)).toBe('reject');
    expect(rejectionMark(ACCEPT)).toBe('accept');
    // why: the two prefixes the recordings showed: CAES after Reject all, CAIS after Accept all
    expect(REJECT.startsWith('CAES')).toBe(true);
    expect(ACCEPT.startsWith('CAIS')).toBe(true);
    expect(reExported).toBe(rejectionMark);
  });
  it('field 2 alone, empty, or followed by fields of every wire type that fit, still reads', () => {
    expect(mark([0x08, 0x01, ...FIELD2])).toBe('reject');
    expect(mark([0x08, 0x02, 0x12, 0x00])).toBe('accept');
    expect(mark([0x08, 0x01, ...FIELD2, 0x18, 0x96, 0x01])).toBe('reject');
    expect(mark([0x08, 0x01, ...FIELD2, 0x21, 1, 2, 3, 4, 5, 6, 7, 8])).toBe('reject');
    expect(mark([0x08, 0x01, ...FIELD2, 0x2d, 1, 2, 3, 4])).toBe('reject');
    // why: a length of 200 takes two varint bytes; a ten-byte varint is the longest there is
    expect(mark([0x08, 0x01, 0x12, 0xc8, 0x01, ...Array.from({ length: 200 }, () => 0x41)])).toBe('reject');
    expect(mark([0x08, 0x01, ...FIELD2, 0x18, ...Array.from({ length: 9 }, () => 0x80), 0x01])).toBe(
      'reject',
    );
    // why: field 2 again later, as a varint (tag 16, the first allowed after field 1)
    expect(mark([0x08, 0x01, ...FIELD2, 0x10, 0x01])).toBe('reject');
    // why: a field number above 15 takes a two-byte tag
    expect(mark([0x08, 0x01, ...FIELD2, 0x80, 0x01, 0x05])).toBe('reject');
  });
  it.each([
    ['too short to hold field 2 (CAE)', [0x08, 0x01]],
    ['the first byte only', [0x08]],
    ['another varint value: 0', [0x08, 0x00, ...FIELD2]],
    ['another varint value: 3', [0x08, 0x03, ...FIELD2]],
    ['a multi-byte varint whose low bits read 1', [0x08, 0x81, 0x00, ...FIELD2]],
    ['a multi-byte varint whose low bits read 2', [0x08, 0x82, 0x00, ...FIELD2]],
    ['field 1 as a length-delimited field', [0x0a, 0x01, ...FIELD2]],
    ['field 2 first', [0x10, 0x01, ...FIELD2]],
    ['no tag: the value byte first', [0x01, 0x08, ...FIELD2]],
    ['field 2 as a varint, not length-delimited', [0x08, 0x01, 0x10, 0x01]],
    ['field 3 next instead of field 2', [0x08, 0x01, ...FIELD3]],
    ['field 2’s length past the end', [0x08, 0x01, 0x12, 0x0a, ...Buffer.from('test-only')]],
    ['field 2’s length cut off', [0x08, 0x01, 0x12, 0x80]],
    ['field 1 repeated later', [0x08, 0x01, ...FIELD2, 0x08, 0x02]],
    ['field 1 repeated as another wire type', [0x08, 0x01, ...FIELD2, 0x0a, 0x00]],
    ['a field 0 tag', [0x08, 0x01, ...FIELD2, 0x00, 0x00]],
    ['a field 0 tag of another wire type', [0x08, 0x01, ...FIELD2, 0x02, 0x00]],
    ['a varint cut off', [0x08, 0x01, ...FIELD2, 0x18, 0x96]],
    [
      'a varint of eleven bytes',
      [0x08, 0x01, ...FIELD2, 0x18, ...Array.from({ length: 10 }, () => 0x80), 0x01],
    ],
    ['a tag cut off', [0x08, 0x01, ...FIELD2, 0x80]],
    ['a 64-bit field cut short', [0x08, 0x01, ...FIELD2, 0x21, 1, 2, 3, 4, 5, 6, 7]],
    ['a 32-bit field cut short', [0x08, 0x01, ...FIELD2, 0x2d, 1, 2, 3]],
    // why: each followed by exactly the bytes a fixed-width field would take, so only the wire type refuses it
    ['a group start (wire type 3)', [0x08, 0x01, ...FIELD2, 0x1b, 0x41, 0x41, 0x41, 0x41]],
    ['a group end (wire type 4)', [0x08, 0x01, ...FIELD2, 0x1c, 0x41, 0x41, 0x41, 0x41]],
    ['wire type 6', [0x08, 0x01, ...FIELD2, 0x1e, 0x41, 0x41, 0x41, 0x41]],
    ['wire type 7', [0x08, 0x01, ...FIELD2, 0x1f, ...Array.from({ length: 8 }, () => 0x41)]],
    ['a later length past the end', [0x08, 0x01, ...FIELD2, 0x1a, 0x05, 0x41]],
  ] as const)('%s is unknown', (_what, bytes) => {
    expect(mark(bytes)).toBe('unknown');
  });
  it('an accept of any other shape is unknown too', () => {
    expect(mark([0x08, 0x02])).toBe('unknown');
    expect(mark([0x08, 0x02, ...FIELD2, 0x08, 0x01])).toBe('unknown');
  });
  it('an empty value is unknown', () => {
    expect(rejectionMark('')).toBe('unknown');
  });
  it.each([
    ['a character outside base64url at the end', `${REJECT}!`],
    ['a character outside base64url at the start', `!${REJECT}`],
    ['a space inside', `${REJECT.slice(0, 4)} ${REJECT.slice(4)}`],
    ['standard base64’s +', `${REJECT.slice(0, 4)}+${REJECT.slice(5)}`],
    ['padding', `${b64([0x08, 0x01, 0x12, 0x00])}==`],
    ['a length no byte string has (4n + 1)', `${REJECT}A`],
    ['trailing bits a canonical encoding never sets', `${b64([0x08, 0x01, 0x12, 0x00]).slice(0, -1)}B`],
  ])('%s is unknown, never read past', (_what, value) => {
    expect(rejectionMark(value)).toBe('unknown');
  });
});
