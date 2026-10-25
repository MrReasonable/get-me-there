import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentNotCaptured,
  loadSocs,
  monthsBefore,
  parseCapture,
  readBack,
  SOCS_NAME,
  socsCookie,
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
