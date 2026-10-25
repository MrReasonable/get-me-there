import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
import { tmpDir } from './support/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z'));
// A synthetic value: the real one is captured by the operator and never enters git.
const OK = {
  value: 'synthetic-socs-rejection-value',
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
    expect(() => loadSocs(d, clock)).toThrow(/capture-socs/);
  });
  // why: fix round 1 (prov-int M11): a capture whose cookie has expired would be dropped by addCookies
  it('refuses a capture whose cookie expiry has passed, naming capture-socs', () => {
    const now = Date.parse(clock.now()) / 1000;
    expect(() => loadSocs(dirWith(JSON.stringify({ ...OK, expires: now })), clock)).toThrow(
      /expired.*capture-socs/,
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
      { value: 'v-synthetic', expires: 1_800_000_000, secure: true, sameSite: 'Strict' },
      clock,
    );
    expect(c).toEqual({
      value: 'v-synthetic',
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
  it('accepts an existing 0700 directory', () => {
    const dir = tmpDir();
    expect(
      writeCapture(dir, { value: 'v', expires: 1_800_000_000, secure: true, sameSite: 'None' }, clock)
        .sameSite,
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
    const tie = Date.parse('2027-11-18T04:00:00.000Z') / 1000;
    expect(
      captureExpiry({ expires: tie, capturedAt: asIsoDateTime('2026-10-18T04:00:00.000Z') }).boundedBy,
    ).toBe('cookie');
  });
  it('reads a capture, a not-shown and a voided record, and none', () => {
    const cap = readConsentRecord(dirWith(JSON.stringify(OK)), clock);
    expect(cap).toMatchObject({ kind: 'socs', expiresAt: '2027-01-15T08:00:00.000Z', boundedBy: 'cookie' });
    expect(cap !== null && cap !== 'invalid' && cap.kind === 'socs' ? cap.capture.value : '').toBe(OK.value);
    expect(
      readConsentRecord(dirWith(JSON.stringify({ consent: 'not-shown', checkedAt: NOW })), clock),
    ).toEqual({
      kind: 'not-shown',
      checkedAt: NOW,
      expiresAt: '2027-11-18T05:00:00.000Z',
    });
    expect(readConsentRecord(dirWith(JSON.stringify({ consent: 'voided', voidedAt: NOW })), clock)).toEqual({
      kind: 'voided',
      voidedAt: NOW,
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
    [
      'a not-shown record dated in the future',
      JSON.stringify({ consent: 'not-shown', checkedAt: '2026-10-19T00:00:00.000Z' }),
      0o600,
    ],
    [
      'a not-shown record with an extra field',
      JSON.stringify({ consent: 'not-shown', checkedAt: NOW, x: 1 }),
      0o600,
    ],
    ['a not-shown record with no time', JSON.stringify({ consent: 'not-shown' }), 0o600],
    ['a voided record with no time', JSON.stringify({ consent: 'voided', voidedAt: 'soon' }), 0o600],
    [
      'a voided record with an extra field',
      JSON.stringify({ consent: 'voided', voidedAt: NOW, checkedAt: NOW }),
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
  it('the start checks see no expiry on a voided record, and nothing on none or an invalid one', () => {
    expect(startConsentOf(null)).toBeNull();
    expect(startConsentOf('invalid')).toBeNull();
    expect(startConsentOf({ kind: 'voided', voidedAt: asIsoDateTime(NOW) })).toEqual({ kind: 'voided' });
    expect(
      startConsentOf({ kind: 'not-shown', checkedAt: asIsoDateTime(NOW), expiresAt: asIsoDateTime(NOW) }),
    ).toEqual({ kind: 'not-shown', expiresAt: NOW });
  });
  it('the status names the kind, the expiry and what bounds it (null for voided)', () => {
    const cap = readConsentRecord(dirWith(JSON.stringify(OK)), clock);
    if (cap === null || cap === 'invalid') throw new Error('capture');
    expect(consentStatusOf(cap)).toEqual({
      kind: 'socs',
      expiresAt: '2027-01-15T08:00:00.000Z',
      boundedBy: 'cookie',
    });
    expect(
      consentStatusOf({ kind: 'not-shown', checkedAt: asIsoDateTime(NOW), expiresAt: asIsoDateTime(NOW) }),
    ).toEqual({
      kind: 'not-shown',
      expiresAt: NOW,
      boundedBy: 'check',
    });
    expect(consentStatusOf({ kind: 'voided', voidedAt: asIsoDateTime(NOW) })).toEqual({
      kind: 'voided',
      expiresAt: null,
      boundedBy: null,
    });
  });
});
