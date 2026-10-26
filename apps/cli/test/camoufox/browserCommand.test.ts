import { parseEnv } from 'node:util';
import { CAMOUFOX_BUILDS } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommandLine } from '../../src/args.js';
import { bundleVersionText } from '../../src/camoufox/install.js';
import { runCli } from '../../src/cli.js';
import type { RunHandler } from '../../src/exec/memory.js';
import type { Action } from '../../src/plan/action.js';
import { stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: W1: `gmt browser install` works whether the app runs natively, in Docker or not at all; W5: `--only` per command
const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
const DATA = '/Users/op/.local/state/get-me-there/camoufox';
const WORKER_ENV = `${DATA}/worker.env`;
const ENV = '/Users/op/.config/get-me-there/app.env';
const PLIST = '/Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];
const BUNDLE = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
const OLD = `${ROOT}/browsers/official/152.0.4-beta.27-aaaaaaaa`;
const KEY = 'k'.repeat(48);

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('no fetch in these tests');
  });
});

function world(o: { check?: string; os?: 'darwin' | 'linux'; ldd?: string; active?: boolean } = {}) {
  const checks: string[][] = [];
  const state = { check: o.check ?? '{"ok":true}' };
  const handler: RunHandler = (argv) => {
    if (argv.includes('check') && argv.includes('--json') && argv.some((a) => a.endsWith('run.ts'))) {
      checks.push([...argv]);
      return { code: 0, stdout: `${state.check}\n` };
    }
    if (argv[0] === 'df') return { code: 0, stdout: 'h\n/dev/disk 1 1 99999999 1% /\n' };
    if (argv[0] === 'ldd') return { code: 0, stdout: o.ldd ?? '' };
    if (argv[0] === 'ln') {
      m.fs.symlink(argv[3] ?? '', argv[2] ?? '');
      return { code: 0 };
    }
    return undefined;
  };
  const m = machine({
    os: o.os ?? 'darwin',
    extra: handler,
    http: stubHttp({
      'GET /api/executions/active': () => ({
        status: 200,
        body: {
          execution:
            o.active === true
              ? {
                  id: 'e1',
                  definitionId: 'd1',
                  definitionName: 'London to New York',
                  status: 'running',
                  stage: 'discovery',
                  startedAt: '2026-10-24T09:00:00.000Z',
                  providers: ['camoufox'],
                  progress: { done: 1, total: 10 },
                  estimatedFinishAt: null,
                }
              : null,
        },
      }),
      'GET /api/health': () => ({ status: 200, body: { ok: true } }),
    }),
  });
  m.fs.dir('/repo/apps/camoufox-worker');
  const deps = m.deps;
  const inner = deps.executor;
  // why: the memory tree's unpack makes an empty directory; the macOS asset holds Camoufox.app and Linux's camoufox-bin
  deps.executor = {
    run: async (a: Action) => {
      const out = await inner.run(a);
      if (a.kind === 'unpack') m.fs.dir(`${a.to}/Camoufox.app`).file(`${a.to}/camoufox-bin`, 'ELF', 0o755);
      return out;
    },
  };
  return { ...m, checks, state };
}
const runs = (log: readonly Action[]) =>
  log.filter((a) => a.kind === 'run').map((a) => (a.kind === 'run' ? a.argv.join(' ') : ''));
const kinds = (log: readonly Action[]) =>
  log.map((a) =>
    a.kind === 'run'
      ? `run ${a.argv[0]} ${a.argv[1] ?? ''}`.trim()
      : `${a.kind} ${'path' in a ? a.path : 'to' in a ? a.to : ''}`,
  );

describe('gmt browser install (W1)', () => {
  it('with no app and no worker set up (a fresh machine, CI): the install alone, the archive kept on request, no service asked', async () => {
    const m = world();
    expect(await runCli(['browser', 'install', '--keep-archive'], m.deps), m.io.stderr).toBe(0);
    const log = kinds(m.executor.log);
    expect(log).toContain(`download ${ROOT}/.download-152.0.4-beta.28-8b7680a6.zip`);
    expect(log).not.toContain(`remove ${ROOT}/.download-152.0.4-beta.28-8b7680a6.zip`);
    expect(m.fs.read(`${BUNDLE}/version.json`)).toBe(bundleVersionText(MAC));
    expect(m.fs.realpath(`${ROOT}/Camoufox.app`)).toBe(`${BUNDLE}/Camoufox.app`);
    expect(m.runner.calls.some((c) => c.argv[0] === 'launchctl')).toBe(false);
    expect(m.checks).toEqual([]);
    // why: po-b1-005: the long steps say what they are and how big, then that they are done
    expect(m.io.stdout).toContain(
      'Downloading Camoufox 152.0.4-beta.28 for darwin-arm64 (313 MB) from github.com; this can take several minutes\nChecking and unpacking it (about 670 MB on disk)\n',
    );
    expect(m.io.stdout).toContain(`Camoufox 152.0.4-beta.28 is in place for darwin-arm64: ${BUNDLE}\n`);
    // a second run: nothing downloaded again
    m.executor.log.length = 0;
    expect(await runCli(['browser', 'install'], m.deps)).toBe(0);
    expect(kinds(m.executor.log).some((k) => k.startsWith('download'))).toBe(false);
  });

  it('the app in Docker and a hand-set worker: its retired lines go, its agent is replaced by gmt’s and started once its check passes, the older bundle removed', async () => {
    const m = world();
    m.fs
      .dir(DATA, 0o700)
      .file(
        WORKER_ENV,
        `CAMOUFOX_WORKER_KEY="${KEY}"\nCAMOUFOX_BINARY_BUILD="152.0.4-beta.28"\nPOINT_OF_SALE="GB"\n`,
        0o600,
      )
      .file(PLIST, '<plist>hand-written</plist>', 0o644)
      .file(`${OLD}/version.json`, '{}');
    m.loaded.add('local.get-me-there.camoufox-worker');
    expect(await runCli(['browser', 'install'], m.deps), m.io.stderr).toBe(0);
    expect(m.io.stdout).toContain('worker.env: removing CAMOUFOX_BINARY_BUILD (the install owns these now)');
    expect(parseEnv(m.fs.read(WORKER_ENV) ?? '')).toEqual({ CAMOUFOX_WORKER_KEY: KEY, POINT_OF_SALE: 'GB' });
    expect(m.fs.mode(WORKER_ENV)).toBe(0o600);
    expect(m.fs.read(PLIST)).toContain('<string>/repo/apps/camoufox-worker/src/run.ts</string>');
    expect(m.checks).toHaveLength(1);
    const r = runs(m.executor.log);
    const stop = r.indexOf('launchctl bootout gui/501/local.get-me-there.camoufox-worker');
    const link = r.findIndex((x) => x.startsWith('ln -s'));
    const start = r.findIndex((x) => x.startsWith('launchctl bootstrap'));
    expect([stop >= 0, link > stop, start > link]).toEqual([true, true, true]);
    expect(m.fs.isDir(OLD)).toBe(false);
    expect(m.loaded.has('local.get-me-there.camoufox-worker')).toBe(true);
  });

  it('a worker set up by hand with no agent at all gets gmt’s service, started once its check passes', async () => {
    const m = world();
    m.fs.dir(DATA, 0o700).file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${KEY}"\n`, 0o600);
    expect(await runCli(['browser', 'install'], m.deps), m.io.stderr).toBe(0);
    expect(m.fs.read(PLIST)).toContain('<string>/repo/apps/camoufox-worker/src/run.ts</string>');
    expect(m.loaded.has('local.get-me-there.camoufox-worker')).toBe(true);
  });

  it('a worker whose check refuses is installed but not started, its refusal and fix said', async () => {
    const m = world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    m.fs.dir(DATA, 0o700).file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${KEY}"\n`, 0o600).file(PLIST, 'old', 0o644);
    expect(await runCli(['browser', 'install'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'worker: not started: refused, not retrying: no consent record: capture one; fix: pnpm gmt consent',
    );
    expect(runs(m.executor.log).some((x) => x.startsWith('launchctl bootstrap'))).toBe(false);
  });

  it('a native app with a run active refuses with 75, saying so; --force goes ahead', async () => {
    const m = world({ active: true });
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    m.executor.log.length = 0;
    expect(await runCli(['browser', 'install'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('a search is running in the app');
    expect(m.executor.log).toEqual([]);
    expect(await runCli(['browser', 'install', '--force'], m.deps)).toBe(0);
  });

  it('Linux: missing libraries are said with 78 and the worker is not started; on Windows it refuses', async () => {
    const m = world({ os: 'linux', ldd: '\tlibgtk-3.so.0 => not found\n' });
    m.deps.platform = { ...m.deps.platform, arch: 'x64' };
    expect(await runCli(['browser', 'install'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('Firefox’s libraries are missing on this machine (libgtk-3.so.0)');
    const w = world();
    w.deps.platform = { ...w.deps.platform, os: 'win32' };
    expect(await runCli(['browser', 'install'], w.deps)).toBe(78);
  });

  it('a download that fails is 1 with the plan’s report; a refused layout is 78 naming the fix', async () => {
    const m = world();
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a) => (a.kind === 'download' ? Promise.reject(new Error('offline')) : inner.run(a)),
    };
    expect(await runCli(['browser', 'install'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('browser install: stopped at a failed step');
    const d = world();
    d.fs.dir(`${ROOT}/Camoufox.app`);
    expect(await runCli(['browser', 'install'], d.deps)).toBe(78);
    expect(d.io.stderr).toContain('move it aside, then run pnpm gmt browser install');
  });
});

describe('the command line (W5)', () => {
  it('--only names a service for start, stop and restart, and nothing for any other command', () => {
    expect(parseCommandLine(['start', '--only', 'database'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('unknown service for --only: database (one of app, backup, worker)'),
    });
    for (const verb of ['start', 'stop', 'restart'])
      expect(parseCommandLine([verb, '--only', 'worker'])).toMatchObject({
        kind: 'command',
        flags: { only: 'worker' },
      });
    // why: W5: status's --only is WP18's area list, checked by the status report, never as a service
    expect(parseCommandLine(['status', '--only', 'database'])).toMatchObject({
      kind: 'command',
      command: 'status',
      flags: { only: 'database' },
    });
  });
  it('browser takes one action of two, each with its own options', () => {
    expect(parseCommandLine(['browser']).kind).toBe('usage');
    expect(parseCommandLine(['browser', 'sideways'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('browser needs an action: install or counts'),
    });
    expect(parseCommandLine(['browser', 'install', '--pages', '3'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('install takes --keep-archive, --wait and --force only'),
    });
    expect(parseCommandLine(['browser', 'counts', '--keep-archive'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('counts does not take --keep-archive'),
    });
    expect(parseCommandLine(['browser', 'counts', '--pages', '1x'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('--pages takes a whole number'),
    });
    expect(parseCommandLine(['browser', 'counts', '--pages', '12', '--scrolls', '0'])).toMatchObject({
      kind: 'command',
      command: 'browser',
      positional: 'counts',
    });
  });
});

describe('the worker’s service under --only (W5) and its start check', () => {
  async function on(o: { active?: boolean; check?: string } = {}) {
    const m = world({ ...(o.active === undefined ? {} : { active: o.active }) });
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    m.fs.file(
      ENV,
      `${m.fs.read(ENV) ?? ''}CAMOUFOX_ENABLED="true"\nCAMOUFOX_WORKER_URL="http://127.0.0.1:8090"\nCAMOUFOX_WORKER_KEY="${KEY}"\n`,
      0o600,
    );
    m.fs.dir(DATA, 0o700).file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${KEY}"\n`, 0o600);
    // why: the worker's unit is installed the way an operator does it, then its check answers as the test says
    expect(await runCli(['browser', 'install', '--force'], m.deps), m.io.stderr).toBe(0);
    expect(m.fs.read(PLIST)).not.toBeNull();
    if (o.check !== undefined) m.state.check = o.check;
    m.executor.log.length = 0;
    m.checks.length = 0;
    m.io.stdout = '';
    m.io.stderr = '';
    return m;
  }
  // why: ca-b1-002: stopping the worker interrupts a browser page, so the run guard asks the app first
  it('stop and restart --only worker keep the active-run guard; --only backup asks nothing', async () => {
    const m = await on({ active: true });
    expect(await runCli(['stop', '--only', 'worker'], m.deps)).toBe(75);
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(75);
    expect(m.executor.log).toEqual([]);
    const http = m.deps.http;
    let asked = 0;
    m.deps.http = async (r) => {
      asked++;
      return http(r);
    };
    expect(await runCli(['stop', '--only', 'backup'], m.deps)).toBe(0);
    expect(asked).toBe(0);
  });
  // why: ca-b1-003, CodeRabbit (PR #15): --only app never reads or acts on the worker
  it('start --only app neither checks the worker nor boots it out, whatever its refusal file says', async () => {
    const m = await on();
    await runCli(['stop'], m.deps);
    m.fs.file(`${DATA}/start-refusal.json`, '{"reason":"layout","at":"2026-10-24T09:30:00.000Z"}', 0o600);
    m.loaded.add('local.get-me-there.camoufox-worker');
    m.executor.log.length = 0;
    expect(await runCli(['start', '--only', 'app'], m.deps)).toBe(0);
    expect(m.checks).toEqual([]);
    expect(m.io.stdout).not.toContain('worker');
    expect(runs(m.executor.log).filter((r) => r.includes('camoufox-worker'))).toEqual([]);
  });
  // why: CodeRabbit (PR #15): a restart starts the worker only once its check passes; a refused one stays stopped,
  // and (U5, 2026-10-26) the restart is then not done: it says so and exits non-zero
  it('restart runs the worker’s check after the stop: refused, the worker stays stopped, its refusal said, exit 78', async () => {
    const m = await on({ check: '{"reason":"consent-expired","at":"2026-10-24T09:30:00.000Z"}' });
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(78);
    expect(m.checks).toHaveLength(1);
    expect(m.io.stderr).toContain(
      'worker: not restarted: refused, not retrying: the consent record has expired',
    );
    expect(m.io.stdout).not.toContain('restart: done');
    expect(runs(m.executor.log)).toEqual(['launchctl bootout gui/501/local.get-me-there.camoufox-worker']);
  });
  // why: W1: with the app in Docker there is no app.env here; the worker alone still starts and stops
  it('a worker alone (no app.env here) starts and stops with --only worker', async () => {
    const m = await on();
    await runCli(['stop'], m.deps);
    m.fs.delete(ENV);
    m.executor.log.length = 0;
    expect(await runCli(['start', '--only', 'worker'], m.deps), m.io.stderr).toBe(0);
    expect(runs(m.executor.log).some((r) => r.includes('camoufox-worker'))).toBe(true);
    expect(await runCli(['start', '--only', 'app'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('app.env is missing');
  });
});

describe('setup’s browser step and its exit (CodeRabbit, PR #15)', () => {
  it('a re-run with the provider on re-renders a changed unit only once the worker’s check passes', async () => {
    const m = world({ check: '{"reason":"locked","at":"2026-10-24T09:30:00.000Z"}' });
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    m.fs.file(
      ENV,
      `${m.fs.read(ENV) ?? ''}CAMOUFOX_ENABLED="true"\nCAMOUFOX_WORKER_URL="http://127.0.0.1:8090"\nCAMOUFOX_WORKER_KEY="${KEY}"\n`,
      0o600,
    );
    m.executor.log.length = 0;
    m.io.stdout = '';
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'worker: not started: refused, not retrying: another worker holds the lock',
    );
    expect(m.fs.read(PLIST)).toBeNull();
  });
  it('a failed browser step fails setup instead of showing the closing screen', async () => {
    const m = world();
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    m.fs.file('/work/b.json', JSON.stringify({ browser: { window: 'scheduled', enabled: true } }), 0o600);
    const inner = m.deps.executor;
    let browserStep = false;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'writeFile' && a.path === WORKER_ENV) browserStep = true;
        if (a.kind === 'waitHealthy' && browserStep) throw new Error('unhealthy');
        return inner.run(a);
      },
    };
    m.io.stdout = '';
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'the browser provider’s step failed (above); pnpm gmt setup --reconfigure browser repeats it.',
    );
    expect(m.io.stdout).not.toContain('Open the app');
  });
});
