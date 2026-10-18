import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureSocs, parseExpiry } from '../src/captureSocs.js';
import { type EntryContext, EX_CONFIG } from '../src/run.js';
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
        asker(['  synthetic-reject-value  ', '2027-11-20T10:00:00.000Z', 'y', 'lax']),
        clock,
      ),
    ).toBe(0);
    const saved = JSON.parse(readFileSync(join(dir, 'socs.json'), 'utf8'));
    expect(saved).toMatchObject({
      value: 'synthetic-reject-value',
      domain: '.google.com',
      path: '/',
      secure: true,
      sameSite: 'Lax',
      capturedAt: '2026-10-18T05:00:00.000Z',
    });
    expect(t.out.join()).not.toContain('synthetic-reject-value');
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
    expect(await captureSocs(t.c, asker(['v', '1800000000', 'y', 'Strict']), clock)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/chmod 700/);
  });
  it('reads the expiry as seconds or as a date; SameSite none and no_restriction are None', async () => {
    expect(parseExpiry('1800000000.5')).toBe(1_800_000_000);
    expect(parseExpiry('2027-11-20T10:00:00.000Z')).toBe(Date.parse('2027-11-20T10:00:00.000Z') / 1000);
    expect(parseExpiry('nope')).toBeNull();
    const t = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(t.c, asker(['v', '1800000000', 'true', 'no_restriction']), clock)).toBe(0);
    const u = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(u.c, asker(['v', '1800000000', 'yes', 'None']), clock)).toBe(0);
    const w = ctx(join(tmpDir(), 'camoufox'));
    expect(await captureSocs(w.c, asker(['v', '1800000000', '1', 'strict']), clock)).toBe(0);
  });
});
