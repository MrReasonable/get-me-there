import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { CooldownStore } from '../src/cooldown.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');
const asRoot = process.getuid?.() === 0;

beforeEach(() => {
  expect.hasAssertions();
});

describe('CooldownStore (spec §2: cool-down by cause, persisted, fail closed)', () => {
  it('a bot check cools down for the configured hours', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('captcha');
    expect(s.active()).toEqual({ until: '2026-10-20T05:00:00.000Z', cause: 'captcha' });
  });
  it('an unrecognised page cools down for exactly one hour', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('unrecognised');
    expect(s.active()?.until).toBe('2026-10-18T06:00:00.000Z');
    expect(s.hoursFor('unrecognised')).toBe(1);
    expect(s.hoursFor('sign-in')).toBe(48);
  });
  it('no record is no cool-down', () => {
    expect(new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) }).active()).toBeNull();
  });
  it('survives a restart and ends at the boundary', () => {
    const dir = tmpDir();
    new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).start('sign-in');
    expect(
      new CooldownStore({
        dir,
        botHours: 48,
        clock: fixedClock(asIsoDateTime('2026-10-19T05:00:00.000Z')),
      }).active()?.until,
    ).toBe('2026-10-20T05:00:00.000Z');
    expect(
      new CooldownStore({
        dir,
        botHours: 48,
        clock: fixedClock(asIsoDateTime('2026-10-20T05:00:00.000Z')),
      }).active(),
    ).toBeNull();
  });
  it('a later, shorter cool-down never shortens a longer one', () => {
    const dir = tmpDir();
    new CooldownStore({ dir, botHours: 72, clock: fixedClock(T0) }).start('captcha');
    const s = new CooldownStore({
      dir,
      botHours: 48,
      clock: fixedClock(asIsoDateTime('2026-10-18T06:00:00.000Z')),
    });
    s.start('unrecognised');
    expect(s.active()).toEqual({ until: '2026-10-21T05:00:00.000Z', cause: 'captcha' });
  });
  it('a later, longer cool-down replaces a shorter one with its own cause', () => {
    const clock = fixedClock(T0);
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock });
    s.start('unrecognised');
    clock.advance(60_000);
    expect(s.start('sign-in')).toEqual({ until: '2026-10-20T05:01:00.000Z', cause: 'sign-in' });
  });
  it('equal ends keep the earlier-recorded cause (ties keep the current record)', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('sign-in');
    expect(s.start('off-allowlist')).toEqual({ until: '2026-10-20T05:00:00.000Z', cause: 'sign-in' });
  });
  it('a consent-unhandled start over an active captcha of the same end keeps captcha', () => {
    const s = new CooldownStore({ dir: tmpDir(), botHours: 48, clock: fixedClock(T0) });
    s.start('captcha');
    s.start('consent-unhandled');
    expect(s.active()?.cause).toBe('captcha');
  });
  it.each([
    ['not json', '{not json'],
    ['not an object', '42'],
    ['a non-date until', JSON.stringify({ until: 'tomorrow', cause: 'captcha' })],
    ['an unknown cause', JSON.stringify({ until: '2026-10-19T00:00:00.000Z', cause: 'x' })],
    ['a missing cause', JSON.stringify({ until: '2026-10-19T00:00:00.000Z' })],
  ])('a record that is %s fails closed: a fresh bot-length cool-down from now', (_n, content) => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'cooldown.json'), content);
    expect(new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).active()).toEqual({
      until: '2026-10-20T05:00:00.000Z',
      cause: 'unrecognised',
    });
    expect(JSON.parse(readFileSync(join(dir, 'cooldown.json'), 'utf8')).cause).toBe('unrecognised');
  });
  it.skipIf(asRoot)(
    `a read error other than ENOENT is thrown, never read as "no cool-down"${asRoot ? ' (skipped as root)' : ''}`,
    () => {
      const dir = tmpDir();
      writeFileSync(join(dir, 'cooldown.json'), '{}', { mode: 0o000 });
      expect(() => new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).active()).toThrow(
        /EACCES/,
      );
    },
  );
  it('refuses fewer than 24 bot hours, and a fraction', () => {
    expect(() => new CooldownStore({ dir: tmpDir(), botHours: 23, clock: fixedClock(T0) })).toThrow(
      /CAMOUFOX_COOLDOWN_HOURS/,
    );
    expect(() => new CooldownStore({ dir: tmpDir(), botHours: 24.5, clock: fixedClock(T0) })).toThrow(
      /CAMOUFOX_COOLDOWN_HOURS/,
    );
  });
  it('writes the record 0600', async () => {
    const dir = tmpDir();
    new CooldownStore({ dir, botHours: 48, clock: fixedClock(T0) }).start('captcha');
    const { statSync } = await import('node:fs');
    expect(statSync(join(dir, 'cooldown.json')).mode & 0o777).toBe(0o600);
  });
});

// why: fix round 1 (TS M5): the lower bound is inclusive
describe('CooldownStore bounds', () => {
  it('accepts 24 hours and refuses 23', () => {
    expect(() => new CooldownStore({ dir: tmpDir(), botHours: 24, clock: fixedClock(T0) })).not.toThrow();
    expect(() => new CooldownStore({ dir: tmpDir(), botHours: 23, clock: fixedClock(T0) })).toThrow(
      /at least 24/,
    );
  });
});
