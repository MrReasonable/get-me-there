import { asIsoDateTime } from '@gmt/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CONSENT_LINE_PREFIX,
  type ConsentLine,
  consentLineSchema,
  decodeConsentLine,
  encodeConsentLine,
  rejectionMark,
} from '../src/consentLine.js';

// why: research 17.0c (2026-10-25): SOCS is the base64url of a protobuf message whose first field (tag 0x08, a varint)
// is 1 after "Reject all" and 2 after "Accept all". Every value here is synthetic, built from bytes chosen for the test
// (a varint prefix, then a filler that spells "test-only"); no recorded value is ever copied into a test.
const FILLER = [0x12, 0x09, ...Buffer.from('test-only')];
const b64 = (bytes: readonly number[]): string => Buffer.from(bytes).toString('base64url');
const socsOf = (prefix: readonly number[], rest: readonly number[] = FILLER): string =>
  b64([...prefix, ...rest]);
const REJECT = socsOf([0x08, 0x01]);
const ACCEPT = socsOf([0x08, 0x02]);

describe('rejectionMark (research 17.0c: the first protobuf field of the SOCS value)', () => {
  it('reads field 1 = 1 as a rejection and 2 as an acceptance', () => {
    expect(rejectionMark(REJECT)).toBe('reject');
    expect(rejectionMark(ACCEPT)).toBe('accept');
    // why: the two prefixes the recordings showed: CAES after Reject all, CAIS after Accept all
    expect(REJECT.startsWith('CAES')).toBe(true);
    expect(ACCEPT.startsWith('CAIS')).toBe(true);
  });
  it('needs nothing after the field: two bytes are enough, whatever follows', () => {
    expect(rejectionMark(b64([0x08, 0x01]))).toBe('reject');
    expect(rejectionMark(b64([0x08, 0x02]))).toBe('accept');
    expect(rejectionMark(socsOf([0x08, 0x01], [0xff, 0x00, 0x7f]))).toBe('reject');
  });
  it.each([
    ['another varint value: 0', [0x08, 0x00]],
    ['another varint value: 3', [0x08, 0x03]],
    ['another varint value: 127', [0x08, 0x7f]],
    ['a multi-byte varint whose low bits read 1', [0x08, 0x81, 0x00]],
    ['a multi-byte varint whose low bits read 2', [0x08, 0x82, 0x00]],
    ['field 1 as a length-delimited field', [0x0a, 0x01]],
    ['field 2 first', [0x10, 0x01]],
    ['no tag: the value byte first', [0x01, 0x08]],
    ['a zero byte first', [0x00, 0x01]],
  ] as const)('%s is unknown', (_what, prefix) => {
    expect(rejectionMark(socsOf(prefix))).toBe('unknown');
  });
  it('a truncated or empty value is unknown', () => {
    expect(rejectionMark(b64([0x08]))).toBe('unknown');
    expect(rejectionMark('')).toBe('unknown');
  });
  it.each([
    ['a character outside base64url at the end', `${REJECT}!`],
    ['a character outside base64url at the start', `!${REJECT}`],
    ['a space inside', `${REJECT.slice(0, 4)} ${REJECT.slice(4)}`],
    ['standard base64’s +', `${REJECT.slice(0, 4)}+${REJECT.slice(5)}`],
    ['padding', `${b64([0x08, 0x01])}=`],
    ['a length no byte string has (4n + 1)', `${b64([0x08, 0x01, 0x12])}A`],
    ['trailing bits a canonical encoding never sets', 'CAF'],
  ])('%s is unknown, never read past', (_what, value) => {
    expect(rejectionMark(value)).toBe('unknown');
  });
});

const LINE: ConsentLine = {
  socs: {
    name: 'SOCS',
    value: REJECT,
    domain: '.google.com',
    path: '/',
    expires: Date.parse('2027-11-20T10:00:00.000Z') / 1000,
    secure: true,
    sameSite: 'Lax',
  },
  capturedAt: asIsoDateTime('2026-10-25T10:00:00.000Z'),
  mark: 'reject',
};
/** A line as an attacker or a damaged paste would make it: any JSON, encoded as the codec does. */
const lineOf = (raw: unknown): string =>
  `${CONSENT_LINE_PREFIX}${Buffer.from(JSON.stringify(raw)).toString('base64url')}`;
const errorOf = (line: string): string => {
  const r = decodeConsentLine(line);
  if (!('error' in r)) throw new Error('expected the line to be refused');
  return r.error;
};

describe('the consent line (gmt-socs-v1.<base64url of { socs, capturedAt, mark }>)', () => {
  it('encodes as the prefix and the base64url of the fields, and decodes back to the same', () => {
    const line = encodeConsentLine(LINE);
    expect(line.startsWith('gmt-socs-v1.')).toBe(true);
    expect(/^gmt-socs-v1\.[A-Za-z0-9_-]+$/.test(line)).toBe(true);
    expect(JSON.parse(Buffer.from(line.slice(CONSENT_LINE_PREFIX.length), 'base64url').toString())).toEqual(
      LINE,
    );
    expect(decodeConsentLine(line)).toEqual(LINE);
  });
  it('encoding refuses fields the schema refuses', () => {
    expect(() => encodeConsentLine({ ...LINE, socs: { ...LINE.socs, value: '' } })).toThrow();
  });
  it('round-trips any valid line (property)', () => {
    const value = fc
      .tuple(fc.constantFrom(0x01, 0x02), fc.uint8Array({ minLength: 0, maxLength: 300 }))
      .map(([v, rest]) => b64([0x08, v, ...rest]));
    const line = fc
      .record({
        value,
        capturedMs: fc.integer({
          min: Date.parse('2026-01-01T00:00:00.000Z'),
          max: Date.parse('2030-01-01T00:00:00.000Z'),
        }),
        lifeSeconds: fc.integer({ min: 0, max: 380 * 86_400 }),
        sameSite: fc.constantFrom('Lax' as const, 'Strict' as const, 'None' as const),
      })
      .map(
        (r): ConsentLine => ({
          socs: {
            name: 'SOCS',
            value: r.value,
            domain: '.google.com',
            path: '/',
            expires: Math.floor(r.capturedMs / 1000) + r.lifeSeconds,
            secure: true,
            sameSite: r.sameSite,
          },
          capturedAt: asIsoDateTime(new Date(r.capturedMs).toISOString()),
          mark: rejectionMark(r.value),
        }),
      );
    fc.assert(
      fc.property(line, (l) => {
        expect(decodeConsentLine(encodeConsentLine(l))).toEqual(l);
      }),
    );
  });

  it('refuses a line without the prefix, or with another version’s', () => {
    const body = encodeConsentLine(LINE).slice(CONSENT_LINE_PREFIX.length);
    expect(errorOf(body)).toBe('the line does not start with gmt-socs-v1.');
    expect(errorOf(`gmt-socs-v2.${body}`)).toBe('the line does not start with gmt-socs-v1.');
    expect(errorOf(` ${CONSENT_LINE_PREFIX}${body}`)).toBe('the line does not start with gmt-socs-v1.');
  });
  it('refuses a body that is not base64url, or not JSON', () => {
    const line = encodeConsentLine(LINE);
    expect(errorOf(`${line}!`)).toBe('the line is not base64url');
    expect(errorOf(`${line}\n`)).toBe('the line is not base64url');
    expect(errorOf(CONSENT_LINE_PREFIX)).toBe('the line does not hold JSON');
    expect(errorOf(`${CONSENT_LINE_PREFIX}${Buffer.from('{not json').toString('base64url')}`)).toBe(
      'the line does not hold JSON',
    );
  });
  it.each([
    ['an extra field', { ...LINE, note: 'x' }, 'the line has a field it may not have'],
    [
      'an extra cookie field',
      { ...LINE, socs: { ...LINE.socs, httpOnly: false } },
      'the line has a field it may not have',
    ],
    [
      'a name other than SOCS',
      { ...LINE, socs: { ...LINE.socs, name: 'NID' } },
      'the line’s socs.name is refused',
    ],
    [
      'a domain other than .google.com',
      { ...LINE, socs: { ...LINE.socs, domain: 'google.com' } },
      'the line’s socs.domain is refused',
    ],
    [
      'a path other than /',
      { ...LINE, socs: { ...LINE.socs, path: '/x' } },
      'the line’s socs.path is refused',
    ],
    [
      'an insecure cookie',
      { ...LINE, socs: { ...LINE.socs, secure: false } },
      'the line’s socs.secure is refused',
    ],
    [
      'another SameSite',
      { ...LINE, socs: { ...LINE.socs, sameSite: 'lax' } },
      'the line’s socs.sameSite is refused',
    ],
    [
      'an expiry that is not a number',
      { ...LINE, socs: { ...LINE.socs, expires: '1800000000' } },
      'the line’s socs.expires is refused',
    ],
    ['no capture time', { ...LINE, capturedAt: '2026-10-25' }, 'the line’s capturedAt is refused'],
    ['a mark that is not one of the three', { ...LINE, mark: 'rejected' }, 'the line’s mark is refused'],
    ['no socs at all', { capturedAt: LINE.capturedAt, mark: 'reject' }, 'the line’s socs is refused'],
    ['an array', [LINE], 'the line’s fields are refused'],
  ])('refuses %s, naming the field and never a value', (_what, raw, words) => {
    expect(errorOf(lineOf(raw))).toBe(words);
  });
  // why: CodeRabbit (PR #18): a capture time that does not parse is refused as itself, never thrown on
  it('a capture time that does not parse is refused at capturedAt, not thrown on by the expiry check', () => {
    expect(errorOf(lineOf({ ...LINE, capturedAt: 'not-a-date' }))).toBe('the line’s capturedAt is refused');
  });
  it('names every field refused, in order', () => {
    expect(errorOf(lineOf({ ...LINE, mark: 'x', capturedAt: 'y' }))).toBe(
      'the line’s capturedAt is refused; the line’s mark is refused',
    );
  });
  it('bounds the value’s length and characters', () => {
    const at = (value: string) =>
      decodeConsentLine(lineOf({ ...LINE, socs: { ...LINE.socs, value }, mark: rejectionMark(value) }));
    const long = socsOf(
      [0x08, 0x01],
      Array.from({ length: 382 }, () => 0x41),
    );
    expect(long.length).toBe(512);
    expect(at(long)).toMatchObject({ socs: { value: long } });
    expect(at(`${long}AAAA`)).toEqual({ error: 'the line’s socs.value is refused' });
    expect(at('')).toEqual({ error: 'the line’s socs.value is refused' });
    // why: every character class of base64url is accepted (upper, lower, digits, - and _)
    for (const v of ['CAESAZaz09-_', 'CAES_-90zaZA']) expect(at(v)).toMatchObject({ socs: { value: v } });
    for (const v of [`${REJECT}=`, `${REJECT}.`, `.${REJECT}`, `${REJECT} `, `CAES+/`])
      expect(at(v), v).toEqual({ error: 'the line’s socs.value is refused' });
  });
  it('refuses an expiry later than 13 months after the capture; exactly 13 months passes', () => {
    const thirteen = Date.parse('2027-11-25T10:00:00.000Z') / 1000;
    const with_ = (expires: number) => lineOf({ ...LINE, socs: { ...LINE.socs, expires } });
    expect(decodeConsentLine(with_(thirteen))).toMatchObject({ socs: { expires: thirteen } });
    expect(errorOf(with_(thirteen + 1))).toBe(
      'the cookie’s expiry is later than 13 months after its capture',
    );
    // why: the 13 months are calendar months on the UTC date, clamped (2026-01-31 + 13 → 2027-02-28)
    const jan31 = { ...LINE, capturedAt: '2026-01-31T00:00:00.000Z' };
    const feb28 = Date.parse('2027-02-28T00:00:00.000Z') / 1000;
    expect(decodeConsentLine(lineOf({ ...jan31, socs: { ...LINE.socs, expires: feb28 } }))).toMatchObject({
      capturedAt: '2026-01-31T00:00:00.000Z',
    });
    expect(errorOf(lineOf({ ...jan31, socs: { ...LINE.socs, expires: feb28 + 1 } }))).toBe(
      'the cookie’s expiry is later than 13 months after its capture',
    );
  });
  it('recomputes the mark from the value and refuses a line whose carried mark differs (a forged reject)', () => {
    expect(errorOf(lineOf({ ...LINE, socs: { ...LINE.socs, value: ACCEPT }, mark: 'reject' }))).toBe(
      'the line’s mark (reject) is not its value’s own (accept)',
    );
    expect(errorOf(lineOf({ ...LINE, mark: 'accept' }))).toBe(
      'the line’s mark (accept) is not its value’s own (reject)',
    );
    // why: a line carrying a true accept or unknown decodes; the import refuses anything but reject itself
    const unknown = socsOf([0x08, 0x05]);
    expect(
      decodeConsentLine(lineOf({ ...LINE, socs: { ...LINE.socs, value: unknown }, mark: 'unknown' })),
    ).toMatchObject({
      mark: 'unknown',
    });
  });
  it('the schema is the one the codec applies', () => {
    expect(consentLineSchema.safeParse(LINE).success).toBe(true);
    expect(consentLineSchema.safeParse({ ...LINE, mark: 'nope' }).success).toBe(false);
  });
});
