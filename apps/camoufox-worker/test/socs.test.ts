import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentNotCaptured,
  captureExpiry,
  consentStatusOf,
  loadSocs,
  monthsAfter,
  monthsBefore,
  parseCapture,
  readBack,
  readConsentRecord,
  SOCS_NAME,
  socsCookie,
  startConsentOf,
  writeCapture,
} from '../src/socs.js';
import { SYNTHETIC_ACCEPT, SYNTHETIC_REJECT } from './support/socsValues.js';
import { tmpDir } from './support/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z'));
// A synthetic value: the real one is captured by the operator and never enters git.
const OK = {
  value: SYNTHETIC_REJECT,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
function dirWith(content: string | null, mode = 0o600): string {
  const d = tmpDir();
  if (content !== null) {
    writeFileSync(join(d, 'socs.json'), content);
    chmodSync(join(d, 'socs.json'), mode);
  }
  return d;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('loadSocs (spec §2: a captured, dated rejection value)', () => {
  it('loads a capture', () => {
    expect(loadSocs(dirWith(JSON.stringify(OK)), clock)).toEqual(OK);
  });
  it.each([
    ['missing', null, 0o600],
    ['malformed', '{not json', 0o600],
    ['not an object', '"x"', 0o600],
    ['group-readable', JSON.stringify(OK), 0o640],
    ['world-readable', JSON.stringify(OK), 0o604],
    ['another domain', JSON.stringify({ ...OK, domain: '.example.test' }), 0o600],
    ['another path', JSON.stringify({ ...OK, path: '/travel' }), 0o600],
    ['an empty value', JSON.stringify({ ...OK, value: '' }), 0o600],
    ['a missing field', JSON.stringify({ ...OK, sameSite: undefined }), 0o600],
    ['an unknown sameSite', JSON.stringify({ ...OK, sameSite: 'Sometimes' }), 0o600],
    ['no expiry', JSON.stringify({ ...OK, expires: 'soon' }), 0o600],
    // why: CodeRabbit (PR #15): an expiry past a date's range is refused here, never thrown later as it is printed
    ['an expiry past a date’s range', JSON.stringify({ ...OK, expires: -1e306 }), 0o600],
    ['an expiry far in the future', JSON.stringify({ ...OK, expires: 8.64e12 + 1 }), 0o600],
    ['not secure', JSON.stringify({ ...OK, secure: false }), 0o600],
    ['no capture time', JSON.stringify({ ...OK, capturedAt: 'yesterday' }), 0o600],
    ['older than 13 months', JSON.stringify({ ...OK, capturedAt: '2025-09-17T05:00:00.000Z' }), 0o600],
    ['in the future', JSON.stringify({ ...OK, capturedAt: '2026-10-19T05:00:00.000Z' }), 0o600],
  ])('%s refuses, saying how to capture it', (_n, content, mode) => {
    const d = dirWith(content, mode);
    expect(() => loadSocs(d, clock)).toThrow(ConsentNotCaptured);
    expect(() => loadSocs(d, clock)).toThrow(/pnpm gmt consent/);
  });
  // why: fix round 1 (prov-int M11): a capture whose cookie has expired would be dropped by addCookies
  it('refuses a capture whose cookie expiry has passed, naming pnpm gmt consent', () => {
    const now = Date.parse(clock.now()) / 1000;
    expect(() => loadSocs(dirWith(JSON.stringify({ ...OK, expires: now })), clock)).toThrow(
      /expired.*pnpm gmt consent/,
    );
    expect(loadSocs(dirWith(JSON.stringify({ ...OK, expires: now + 1 })), clock).expires).toBe(now + 1);
  });
  it('accepts exactly 13 months old', () => {
    expect(
      loadSocs(dirWith(JSON.stringify({ ...OK, capturedAt: '2025-09-18T05:00:00.000Z' })), clock).capturedAt,
    ).toBe('2025-09-18T05:00:00.000Z');
  });
  it('calendar months clamp to the month’s last day (TS-18)', () => {
    expect(monthsBefore(asIsoDateTime('2026-03-31T00:00:00.000Z'), 1)).toBe('2026-02-28');
    expect(monthsBefore(asIsoDateTime('2026-10-18T05:00:00.000Z'), 13)).toBe('2025-09-18');
    expect(monthsBefore(asIsoDateTime('2027-01-15T00:00:00.000Z'), 13)).toBe('2025-12-15');
  });
  it('parseCapture refuses a non-object', () => {
    expect(() => parseCapture(null, clock)).toThrow(/not a JSON object/);
  });
  it('the cookie set is SOCS with the captured attributes, nothing else', () => {
    expect(socsCookie(loadSocs(dirWith(JSON.stringify(OK)), clock))).toEqual({
      name: SOCS_NAME,
      value: OK.value,
      domain: '.google.com',
      path: '/',
      expires: OK.expires,
      secure: true,
      sameSite: 'Lax',
      httpOnly: false,
    });
  });
});

describe('readBack (ruling 9: compared by value everywhere)', () => {
  // why: WP16b (U10): loaded inside each test, so on a host without POSIX modes (Windows) the mode refusal fails these
  // tests by title instead of failing the whole file at collection
  const capture = () => loadSocs(dirWith(JSON.stringify(OK)), clock);
  const cases = [
    ['same', [{ name: 'SOCS', value: OK.value, domain: '.google.com' }], 'same'],
    ['changed', [{ name: 'SOCS', value: 'an-accept-value', domain: '.google.com' }], 'changed'],
    [
      'one same and one changed',
      [
        { name: 'SOCS', value: OK.value, domain: '.google.com' },
        { name: 'SOCS', value: 'x', domain: '.google.com' },
      ],
      'changed',
    ],
    ['missing', [{ name: 'NID', value: 'x', domain: '.google.com' }], 'missing'],
    ['a SOCS on another domain', [{ name: 'SOCS', value: OK.value, domain: 'www.google.com' }], 'missing'],
    // why: fix round 1 (sec M1): any SOCS the browser would send to www.google.com counts, host-only ones included
    ...(['google.com', 'www.google.com', '.www.google.com'] as const).map(
      (domain) =>
        [
          `a host-only SOCS on ${domain} with another value`,
          [
            { name: 'SOCS', value: OK.value, domain: '.google.com' },
            { name: 'SOCS', value: 'an-accept-value', domain },
          ],
          'changed',
        ] as const,
    ),
    [
      'a SOCS with another value on a domain never sent to www.google.com',
      [
        { name: 'SOCS', value: OK.value, domain: '.google.com' },
        { name: 'SOCS', value: 'x', domain: '.google.co.uk' },
      ],
      'same',
    ],
  ] as const;
  // why: fix round 1 (TS M10): readBack never reads SOCS_STABLE; that the flag changes nothing is proved by the session
  // test "SOCS changed after a settled page → consent-unhandled (SOCS_STABLE …)"
  it.each(cases)('%s', (_n, cookies, expected) => {
    expect(readBack(cookies, capture())).toBe(expected);
  });
});

describe('writeCapture (capture-socs)', () => {
  it('writes a 0600 file in a 0700 directory with the time from the clock and the domain and path fixed', () => {
    const dir = join(tmpDir(), 'camoufox');
    const c = writeCapture(
      dir,
      { value: SYNTHETIC_REJECT, expires: 1_800_000_000, secure: true, sameSite: 'Strict' },
      clock,
    );
    expect(c).toEqual({
      value: SYNTHETIC_REJECT,
      domain: '.google.com',
      path: '/',
      expires: 1_800_000_000,
      secure: true,
      sameSite: 'Strict',
      capturedAt: '2026-10-18T05:00:00.000Z',
    });
    expect(statSync(join(dir, 'socs.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(loadSocs(dir, clock)).toEqual(c);
  });
  // why: WP17 Task 17.5: consent import keeps the capture time the line carries, judged by the same date rules
  it('keeps a given capture time, and refuses one in the future or older than 13 months', () => {
    const input = { value: SYNTHETIC_REJECT, expires: 1_800_000_000, secure: true, sameSite: 'Lax' };
    const dir = tmpDir();
    expect(writeCapture(dir, input, clock, asIsoDateTime('2026-10-01T09:00:00.000Z')).capturedAt).toBe(
      '2026-10-01T09:00:00.000Z',
    );
    expect(loadSocs(dir, clock).capturedAt).toBe('2026-10-01T09:00:00.000Z');
    expect(() => writeCapture(tmpDir(), input, clock, asIsoDateTime('2026-10-18T05:00:00.001Z'))).toThrow(
      /dated in the future/,
    );
    expect(() => writeCapture(tmpDir(), input, clock, asIsoDateTime('2025-09-17T05:00:00.000Z'))).toThrow(
      /older than 13 months/,
    );
  });
  // why: review X1: capture-socs, consent and consent import all store through here, so only a rejection is stored
  it('refuses a value whose mark is not reject, writing nothing and keeping a record already there', () => {
    const dir = tmpDir();
    const kept = writeCapture(
      dir,
      { value: SYNTHETIC_REJECT, expires: 1_800_000_000, secure: true, sameSite: 'Lax' },
      clock,
    );
    const before = readFileSync(join(dir, 'socs.json'));
    for (const [value, words] of [
      [SYNTHETIC_ACCEPT, /the value records Accept all, and only a rejection is ever stored or applied/],
      ['not-a-socs-value', /does not show a rejection this version reads/],
    ] as const)
      expect(() =>
        writeCapture(dir, { value, expires: 1_800_000_000, secure: true, sameSite: 'Lax' }, clock),
      ).toThrow(words);
    expect(readFileSync(join(dir, 'socs.json'))).toEqual(before);
    expect(loadSocs(dir, clock)).toEqual(kept);
  });
  it('loadSocs refuses a stored value that is not a rejection, and the cookie is never built from one', () => {
    const d = dirWith(JSON.stringify({ ...OK, value: SYNTHETIC_ACCEPT }));
    expect(() => loadSocs(d, clock)).toThrow(/Accept all/);
    const stored = parseCapture(OK, clock);
    expect(() => socsCookie({ ...stored, value: SYNTHETIC_ACCEPT })).toThrow(/Accept all/);
    expect(() => socsCookie({ ...stored, value: 'x' })).toThrow(/does not show a rejection/);
    expect(socsCookie(stored).value).toBe(SYNTHETIC_REJECT);
  });
  it('accepts an existing 0700 directory', () => {
    const dir = tmpDir();
    expect(
      writeCapture(
        dir,
        { value: SYNTHETIC_REJECT, expires: 1_800_000_000, secure: true, sameSite: 'None' },
        clock,
      ).sameSite,
    ).toBe('None');
  });
  it('refuses an empty value, secure false, and a looser existing directory (naming chmod 700)', () => {
    expect(() =>
      writeCapture(join(tmpDir(), 'a'), { value: '', expires: 1, secure: true, sameSite: 'Lax' }, clock),
    ).toThrow(/empty value/);
    expect(() =>
      writeCapture(join(tmpDir(), 'b'), { value: 'v', expires: 1, secure: false, sameSite: 'Lax' }, clock),
    ).toThrow(/Secure/);
    const loose = join(tmpDir(), 'c');
    mkdirSync(loose, { mode: 0o755 });
    chmodSync(loose, 0o755);
    expect(() =>
      writeCapture(loose, { value: 'v', expires: 1, secure: true, sameSite: 'Lax' }, clock),
    ).toThrow(/chmod 700/);
  });
});

// why: decisions 74 and 75 (Task 17.2): the consent record the start checks and the status read
describe('the consent record (socs.json)', () => {
  const NOW = '2026-10-18T05:00:00.000Z';
  it('a capture whose expiry is past a date’s range reads as invalid, never throws', () => {
    expect(readConsentRecord(dirWith(JSON.stringify({ ...OK, expires: -1e306 })), clock)).toBe('invalid');
  });
  it('monthsAfter keeps the time and clamps the day', () => {
    expect(monthsAfter(asIsoDateTime('2026-10-18T04:00:00.000Z'), 13)).toBe('2027-11-18T04:00:00.000Z');
    expect(monthsAfter(asIsoDateTime('2027-01-31T23:59:59.999Z'), 1)).toBe('2027-02-28T23:59:59.999Z');
    expect(monthsAfter(asIsoDateTime('2027-12-31T00:00:00.000Z'), 2)).toBe('2028-02-29T00:00:00.000Z');
  });
  it('a capture expires at the earlier of the cookie’s expiry and capturedAt + 13 months, saying which', () => {
    expect(
      captureExpiry({ expires: 1_800_000_000, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') }),
    ).toEqual({
      expiresAt: '2027-01-15T08:00:00.000Z',
      boundedBy: 'cookie',
    });
    expect(
      captureExpiry({ expires: 1_900_000_000, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') }),
    ).toEqual({
      expiresAt: '2027-11-18T04:00:00.000Z',
      boundedBy: 'capture',
    });
    // why: review X2: a tie is the capture's bound, so an imported line's capped expiry never names the cookie
    const tie = Date.parse('2027-11-18T04:00:00.000Z') / 1000;
    expect(
      captureExpiry({ expires: tie, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') }).boundedBy,
    ).toBe('capture');
    expect(
      captureExpiry({ expires: tie - 1, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') }).boundedBy,
    ).toBe('cookie');
  });
  it('reads a capture with its mark, an older record by name only, and none', () => {
    const cap = readConsentRecord(dirWith(JSON.stringify(OK)), clock);
    expect(cap).toMatchObject({
      kind: 'socs',
      expiresAt: '2027-01-15T08:00:00.000Z',
      boundedBy: 'cookie',
      mark: 'reject',
    });
    expect(cap !== null && cap !== 'invalid' && cap.kind === 'socs' ? cap.capture.value : '').toBe(OK.value);
    // why: review X1: a capture of another mark is read with that mark, so the start refuses it by name
    expect(
      readConsentRecord(dirWith(JSON.stringify({ ...OK, value: SYNTHETIC_ACCEPT })), clock),
    ).toMatchObject({
      kind: 'socs',
      mark: 'accept',
    });
    expect(
      readConsentRecord(dirWith(JSON.stringify({ ...OK, value: 'not-a-socs-value' })), clock),
    ).toMatchObject({
      kind: 'socs',
      mark: 'unknown',
    });
    // why: review X5: no command writes the older shapes; one left behind is read only so the start can refuse it
    expect(
      readConsentRecord(dirWith(JSON.stringify({ consent: 'not-shown', checkedAt: NOW })), clock),
    ).toEqual({
      kind: 'legacy',
      was: 'not-shown',
    });
    expect(readConsentRecord(dirWith(JSON.stringify({ consent: 'voided', voidedAt: NOW })), clock)).toEqual({
      kind: 'legacy',
      was: 'voided',
    });
    expect(readConsentRecord(dirWith(null), clock)).toBeNull();
  });
  it('an expired or stale capture is returned with its past expiry, never as missing', () => {
    const stale = readConsentRecord(
      dirWith(JSON.stringify({ ...OK, capturedAt: '2025-01-01T00:00:00.000Z' })),
      clock,
    );
    expect(stale).toMatchObject({
      kind: 'socs',
      expiresAt: '2026-02-01T00:00:00.000Z',
      boundedBy: 'capture',
    });
  });
  it.each([
    ['readable by others', JSON.stringify(OK), 0o644],
    ['not JSON', '{', 0o600],
    ['not an object', '7', 0o600],
    ['a capture missing its value', JSON.stringify({ ...OK, value: '' }), 0o600],
    [
      'a capture dated in the future',
      JSON.stringify({ ...OK, capturedAt: '2026-10-19T00:00:00.000Z' }),
      0o600,
    ],
    ['another consent kind', JSON.stringify({ consent: 'accepted', checkedAt: NOW }), 0o600],
  ])('%s is invalid', (_why, content, mode) => {
    expect(readConsentRecord(dirWith(content, mode), clock)).toBe('invalid');
  });
  it('a file that cannot be read is invalid', () => {
    const d = tmpDir();
    mkdirSync(join(d, 'socs.json'), { mode: 0o700 });
    chmodSync(join(d, 'socs.json'), 0o700);
    expect(readConsentRecord(d, clock)).toBe('invalid');
  });
  it('the start checks see a capture’s expiry and mark, an older record by name, and nothing on none or an invalid one', () => {
    expect(startConsentOf(null)).toBeNull();
    expect(startConsentOf('invalid')).toBeNull();
    expect(startConsentOf({ kind: 'legacy', was: 'voided' })).toEqual({ kind: 'legacy', was: 'voided' });
    const cap = readConsentRecord(dirWith(JSON.stringify(OK)), clock);
    expect(startConsentOf(cap)).toEqual({
      kind: 'socs',
      expiresAt: '2027-01-15T08:00:00.000Z',
      mark: 'reject',
    });
  });
  it('the status names the kind, the expiry, what bounds it and the mark', () => {
    const cap = readConsentRecord(dirWith(JSON.stringify(OK)), clock);
    if (cap === null || cap === 'invalid' || cap.kind !== 'socs') throw new Error('capture');
    expect(consentStatusOf(cap)).toEqual({
      kind: 'socs',
      expiresAt: '2027-01-15T08:00:00.000Z',
      boundedBy: 'cookie',
      mark: 'reject',
    });
  });
});
