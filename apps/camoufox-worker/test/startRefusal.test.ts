import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_FIX, START_REFUSAL_REASONS, startRefusalSchema } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { EntryContext } from '../src/run.js';
import { check, clearStartRefusal, writeStartRefusal } from '../src/startRefusal.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers } from './support/timers.js';
import { fakeInstall, tmpDir } from './support/tmp.js';

const clock = fakeTimers().clock;
const AT = clock.now();
const CAPTURE = {
  value: SYNTHETIC_REJECT,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
function ctxFor(o: { home: string; installDir?: string; args?: string[]; env?: Record<string, string> }) {
  const dataDir = tmpDir();
  const out: string[] = [];
  const err: string[] = [];
  const ctx: EntryContext = {
    env: {
      CAMOUFOX_WORKER_KEY: 'synthetic-worker-key-0123456789abcdef',
      HOME: o.home,
      ...(o.installDir === undefined ? {} : { CAMOUFOX_INSTALL_DIR: o.installDir }),
      ...o.env,
    },
    dataDir,
    args: o.args ?? ['--json'],
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  return { ctx, out, err, dataDir };
}
const mac = { platform: 'darwin', arch: 'arm64', clock, locked: () => false };

describe('the refusal file (decision 75)', () => {
  it('is { reason, at } only, 0600, for every reason; cleared by a start', () => {
    const d = tmpDir();
    for (const reason of START_REFUSAL_REASONS) {
      expect(writeStartRefusal(d, reason, AT)).toEqual({ reason, at: AT });
      const text = readFileSync(join(d, 'start-refusal.json'), 'utf8');
      expect(startRefusalSchema.parse(JSON.parse(text))).toEqual({ reason, at: AT });
      expect(statSync(join(d, 'start-refusal.json')).mode & 0o777).toBe(0o600);
    }
    clearStartRefusal(d);
    expect(existsSync(join(d, 'start-refusal.json'))).toBe(false);
    clearStartRefusal(d);
  });
});

describe('run.ts check --json (decision 75): the start’s result, nothing started', () => {
  it('prints { "ok": true } when every check passes, writing nothing', async () => {
    const f = fakeInstall('darwin-arm64');
    const t = ctxFor({ home: f.home, installDir: f.root });
    writeFileSync(join(t.dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
    expect(await check(t.ctx, mac)).toBe(0);
    expect(t.out).toEqual(['{"ok":true}']);
    expect(existsSync(join(t.dataDir, 'start-refusal.json'))).toBe(false);
  });
  it('prints the refusal in startRefusalSchema’s terms, exits 78, and writes no file', async () => {
    const f = fakeInstall('darwin-arm64');
    const t = ctxFor({ home: f.home, installDir: f.root });
    expect(await check(t.ctx, mac)).toBe(78);
    expect(t.out.map((l) => JSON.parse(l))).toEqual([{ reason: 'consent-missing', at: AT }]);
    expect(t.err).toEqual([
      `the camoufox worker would refuse to start: no consent record: capture one; fix: ${CONSENT_FIX.command}`,
    ]);
    expect(existsSync(join(t.dataDir, 'start-refusal.json'))).toBe(false);
  });
  it('names the lock, the flags, the layout and the build in core’s order', async () => {
    const f = fakeInstall('darwin-arm64');
    const locked = ctxFor({ home: f.home, installDir: f.root });
    expect(await check(locked.ctx, { ...mac, locked: () => true })).toBe(78);
    expect(JSON.parse(locked.out[0] ?? '')).toEqual({ reason: 'locked', at: AT });
    const linux = ctxFor({ home: f.home, installDir: f.root });
    await check(linux.ctx, { ...mac, platform: 'darwin', arch: 'x64' });
    expect(JSON.parse(linux.out[0] ?? '')).toEqual({ reason: 'flags-unset', at: AT });
    const elsewhere = ctxFor({ home: f.home, installDir: '/elsewhere' });
    await check(elsewhere.ctx, mac);
    expect(JSON.parse(elsewhere.out[0] ?? '')).toEqual({ reason: 'layout', at: AT });
    expect(elsewhere.err.join()).toContain('(CAMOUFOX_INSTALL_DIR is not');
    const other = fakeInstall('darwin-arm64', {
      bundleVersion: { version: '153.0.1', release: 'beta.30' },
      top: { version: '153.0.1', release: 'beta.30' },
    });
    const mismatch = ctxFor({ home: other.home, installDir: other.root });
    await check(mismatch.ctx, mac);
    expect(JSON.parse(mismatch.out[0] ?? '')).toEqual({ reason: 'build-mismatch', at: AT });
  });
  // why: W1 (dev-b1-003): bad settings are a config refusal the CLI can read, their words on stderr
  it('refuses another argument printing nothing on stdout; bad settings print a config refusal and say why', async () => {
    const t = ctxFor({ home: '/h', args: [] });
    expect(await check(t.ctx, mac)).toBe(78);
    expect([t.out, t.err]).toEqual([[], ['usage: run.ts check --json']]);
    const bad = ctxFor({ home: '/h', env: { CAMOUFOX_WORKER_KEY: 'short' } });
    expect(await check(bad.ctx, mac)).toBe(78);
    expect(bad.out.map((l) => JSON.parse(l))).toEqual([{ reason: 'config', at: AT }]);
    expect(bad.err.join()).toContain('CAMOUFOX_WORKER_KEY');
    expect(existsSync(join(bad.dataDir, 'start-refusal.json'))).toBe(false);
  });
  // why: CodeRabbit (PR #15): the install directory comes from the settings' own HOME, as the start's does
  it('the install directory is the settings’ HOME’s: no HOME is a config refusal, never a layout under an empty one', async () => {
    const f = fakeInstall('darwin-arm64');
    const t = ctxFor({ home: f.home, installDir: f.root, env: { HOME: '' } });
    expect(await check(t.ctx, mac)).toBe(78);
    expect(JSON.parse(t.out[0] ?? '')).toEqual({ reason: 'config', at: AT });
    expect(t.err.join()).toContain('HOME');
  });
});
