import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureSocs, lineAsker, parseExpiry } from '../src/captureSocs.js';
import { type EntryContext, EX_CONFIG } from '../src/run.js';
import { SYNTHETIC_ACCEPT, SYNTHETIC_REJECT } from './support/socsValues.js';
import { tmpDir } from './support/tmp.js';

const clock = fixedClock(asIsoDateTime('2026-10-18T05:00:00.000Z'));
function ctx(dataDir: string) {
  const out: string[] = [];
  const err: string[] = [];
  const c: EntryContext = { env: {}, dataDir, args: [], out: (l) => out.push(l), err: (l) => err.push(l) };
  return { c, out, err };
}
const asker = (answers: string[]) => async () => answers.shift() ?? '';

beforeEach(() => {
  expect.hasAssertions();
});

describe('capture-socs (devops-010)', () => {
  it('writes the capture from the four answers and never prints the value', async () => {
    const dir = join(tmpDir(), 'camoufox');
    const t = ctx(dir);
    expect(
      await captureSocs(
        t.c,
        asker([`  ${SYNTHETIC_REJECT}  `, '2027-11-20T10:00:00.000Z', 'y', 'lax']),
        clock,
      ),
    ).toBe(0);
    const saved = JSON.parse(readFileSync(join(dir, 'socs.json'), 'utf8'));
    expect(saved).toMatchObject({
      value: SYNTHETIC_REJECT,
      domain: '.google.com',
      path: '/',
      secure: true,
      sameSite: 'Lax',
      capturedAt: '2026-10-18T05:00:00.000Z',
    });
    expect(t.out.join()).not.toContain(SYNTHETIC_REJECT);
    expect(t.out.join()).toMatch(/written 0600/);
  });
  it.each([
    ['an empty value', ['', '1800000000', 'y', 'Lax'], /empty value/],
    ['secure false', ['v', '1800000000', 'n', 'Lax'], /Secure/],
    ['an unreadable expiry', ['v', 'whenever', 'y', 'Lax'], /expiry/],
    ['an expired cookie', ['v', '1000', 'y', 'Lax'], /expired/],
    ['an unknown SameSite', ['v', '1800000000', 'y', 'Sometimes'], /SameSite/],
  ])('refuses %s', async (_n, answers, re) => {
    const t = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(t.c, asker(answers), clock)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(re);
  });
  it('refuses a directory that exists with a looser mode', async () => {
    const dir = join(tmpDir(), 'loose');
    mkdirSync(dir, { mode: 0o755 });
    const t = ctx(dir);
    expect(await captureSocs(t.c, asker([SYNTHETIC_REJECT, '1800000000', 'y', 'Strict']), clock)).toBe(
      EX_CONFIG,
    );
    expect(t.err.join()).toMatch(/chmod 700/);
  });
  // why: review X1: capture-socs, the fallback, stores only a value whose own mark is a rejection
  it.each([
    [
      'an Accept all value',
      SYNTHETIC_ACCEPT,
      'the value records Accept all, and only a rejection is ever stored or applied',
    ],
    [
      'a value of no known shape',
      'pasted-from-somewhere',
      'the value does not show a rejection this version reads',
    ],
  ])(
    'refuses %s in plain words, writing nothing and keeping a record already there',
    async (_what, value, words) => {
      const dir = join(tmpDir(), 'camoufox');
      const first = ctx(dir);
      expect(await captureSocs(first.c, asker([SYNTHETIC_REJECT, '1800000000', 'y', 'Lax']), clock)).toBe(0);
      const before = readFileSync(join(dir, 'socs.json'));
      const t = ctx(dir);
      expect(await captureSocs(t.c, asker([value, '1800000000', 'y', 'Lax']), clock)).toBe(78);
      expect(t.err.join()).toContain(words);
      expect(t.err.join()).not.toContain(value);
      expect(readFileSync(join(dir, 'socs.json'))).toEqual(before);
    },
  );
  it('reads the expiry as seconds or as a date; SameSite none and no_restriction are None', async () => {
    expect(parseExpiry('1800000000.5')).toBe(1_800_000_000);
    expect(parseExpiry('2027-11-20T10:00:00.000Z')).toBe(Date.parse('2027-11-20T10:00:00.000Z') / 1000);
    expect(parseExpiry('nope')).toBeNull();
    const t = ctx(join(tmpDir(), 'camoufox'));
    expect(
      await captureSocs(t.c, asker([SYNTHETIC_REJECT, '1800000000', 'true', 'no_restriction']), clock),
    ).toBe(0);
    const u = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(u.c, asker([SYNTHETIC_REJECT, '1800000000', 'yes', 'None']), clock)).toBe(0);
    const w = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(w.c, asker([SYNTHETIC_REJECT, '1800000000', '1', 'strict']), clock)).toBe(0);
  });
});

// why: fix round 2: piped answers arrive before any prompt is asked; every line must still reach its prompt, and input
// that ends early must refuse, never exit 0 having written nothing
describe('capture-socs over a piped stream', () => {
  const piped = (text: string) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const shown: string[] = [];
    output.on('data', (b: Buffer) => shown.push(b.toString()));
    input.end(text);
    return { input, output, shown };
  };
  it('all four answers piped at once: every prompt is answered and the capture is written', async () => {
    const dir = join(tmpDir(), 'camoufox');
    const t = ctx(dir);
    const p = piped(`${SYNTHETIC_REJECT}\n2027-11-20T10:00:00.000Z\ny\nLax\n`);
    const asker = lineAsker(p.input, p.output);
    try {
      expect(await captureSocs(t.c, asker.ask, clock)).toBe(0);
    } finally {
      asker.close();
    }
    expect(JSON.parse(readFileSync(join(dir, 'socs.json'), 'utf8'))).toMatchObject({
      value: SYNTHETIC_REJECT,
      sameSite: 'Lax',
      secure: true,
    });
    expect(p.shown.join('')).toContain('SameSite (Lax, Strict or None): ');
  });
  it('only two answers piped: refuses with EX_CONFIG, naming the input ending, and writes nothing', async () => {
    const dir = join(tmpDir(), 'camoufox');
    const t = ctx(dir);
    const p = piped(`${SYNTHETIC_REJECT}\n2027-11-20T10:00:00.000Z\n`);
    const asker = lineAsker(p.input, p.output);
    try {
      expect(await captureSocs(t.c, asker.ask, clock)).toBe(EX_CONFIG);
    } finally {
      asker.close();
    }
    expect(t.err.join()).toMatch(/input ended before every answer was given/);
    expect(existsSync(join(dir, 'socs.json'))).toBe(false);
  });
});
