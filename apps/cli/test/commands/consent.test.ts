import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { helpText, parseCommandLine } from '../../src/args.js';
import { runCli } from '../../src/cli.js';
import type { RunHandler } from '../../src/exec/memory.js';
import { currentPlatform } from '../../src/platform/current.js';
import { stubHttp } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: WP17 Task 17.5 (decision 74): gmt consent only spawns the worker's consent entry, stopping the worker service
// first and putting it back after; the worker's own behaviour is tested in the worker package
const DATA = '/Users/op/.local/state/get-me-there/camoufox';
const WORKER_ENV = `${DATA}/worker.env`;
const REFUSAL = `${DATA}/start-refusal.json`;
const PLIST = '/Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist';
const LABEL = 'local.get-me-there.camoufox-worker';
const RUN_TS = '/repo/apps/camoufox-worker/src/run.ts';
const ARGV = ['/opt/node/bin/node', '--conditions=@gmt/source', '--import', 'tsx', RUN_TS, 'consent'];
const SERVICE_ENV = { PATH: '/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: '/Users/op' };

interface Attached {
  argv: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>> | undefined;
  workerLoaded: boolean;
}

function world(
  o: {
    code?: number;
    check?: string;
    worker?: 'running' | 'stopped' | 'absent';
    env?: boolean;
    active?: boolean;
    /** The app in Docker (review X4): running with its port published, or a compose that cannot be read. */
    docker?: 'running' | 'unreadable';
  } = {},
) {
  const checks: string[][] = [];
  const handler: RunHandler = (argv) => {
    if (argv.includes('check') && argv.includes('--json') && argv.includes(RUN_TS)) {
      checks.push([...argv]);
      return { code: 0, stdout: `${o.check ?? '{"ok":true}'}\n` };
    }
    if (o.docker !== undefined && argv[0] === 'docker') {
      if (argv[1] === '--version') return { code: 0, stdout: 'Docker version 28\n' };
      if (argv.includes('ps'))
        return o.docker === 'unreadable'
          ? { code: 1, stderr: 'cannot connect' }
          : { code: 0, stdout: '{"Service":"app","State":"running"}\n' };
      if (argv.includes('port')) return { code: 0, stdout: '127.0.0.1:3000\n' };
    }
    return undefined;
  };
  const m = machine({
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
  if (o.env !== false)
    m.fs.dir(DATA, 0o700).file(WORKER_ENV, `CAMOUFOX_WORKER_KEY="${'k'.repeat(48)}"\n`, 0o600);
  const worker = o.worker ?? 'running';
  if (worker !== 'absent') {
    m.fs.file(PLIST, '<plist>gmt</plist>', 0o644);
    m.loaded.add(LABEL);
    if (worker === 'running') m.running.add(LABEL);
  }
  if (o.docker !== undefined)
    m.fs.file('/repo/.env', 'APP_BASIC_AUTH_USER=op\nAPP_BASIC_AUTH_PASS=synthetic-pass\nPORT=3000\n', 0o600);
  const attached: Attached[] = [];
  m.deps.attach = async (argv, cwd, env) => {
    attached.push({ argv, cwd, env, workerLoaded: m.loaded.has(LABEL) });
    return o.code ?? 0;
  };
  const runs = () =>
    m.executor.log.filter((a) => a.kind === 'run').map((a) => (a.kind === 'run' ? a.argv.join(' ') : ''));
  return { ...m, attached, checks, runs };
}

describe('gmt consent: the capture, with the worker stopped meanwhile', () => {
  it('stops the running worker, spawns run.ts consent with PATH and HOME, clears a consent refusal and starts the worker', async () => {
    const m = world();
    m.fs.file(REFUSAL, '{"reason":"consent-missing","at":"2026-10-24T09:00:00.000Z"}', 0o600);
    expect(await runCli(['consent'], m.deps), m.io.stderr).toBe(0);
    expect(m.attached).toEqual([
      { argv: ARGV, cwd: '/repo/apps/camoufox-worker', env: SERVICE_ENV, workerLoaded: false },
    ]);
    const r = m.runs();
    expect(r[0]).toBe(`launchctl bootout gui/501/${LABEL}`);
    expect(r.some((x) => x.startsWith('launchctl bootstrap'))).toBe(true);
    // why: spec §13: the worker started again is done only once it answers
    expect(m.executor.log.at(-1)?.kind).toBe('waitWorkerAnswers');
    expect(m.io.stdout).toContain('consent: the worker: done');
    expect(m.fs.read(REFUSAL)).toBeNull();
    expect(m.checks).toHaveLength(1);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  it('a stopped worker is started after a capture that succeeded', async () => {
    const m = world({ worker: 'stopped' });
    m.loaded.delete(LABEL);
    expect(await runCli(['consent'], m.deps)).toBe(0);
    expect(m.runs().some((x) => x.includes('bootout'))).toBe(false);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  it('a refused capture writes nothing and puts the worker back as it was: a running one started again, a stopped one left', async () => {
    const running = world({ code: 69 });
    running.fs.file(REFUSAL, '{"reason":"consent-expired","at":"2026-10-24T09:00:00.000Z"}', 0o600);
    expect(await runCli(['consent'], running.deps)).toBe(69);
    expect(running.loaded.has(LABEL)).toBe(true);
    // why: the record was not replaced, so the refusal that named it stands
    expect(running.fs.read(REFUSAL)).not.toBeNull();
    const stopped = world({ code: 78, worker: 'stopped' });
    stopped.loaded.delete(LABEL);
    expect(await runCli(['consent'], stopped.deps)).toBe(78);
    expect(stopped.loaded.has(LABEL)).toBe(false);
    expect(stopped.checks).toEqual([]);
  });
  it('a refusal other than consent’s is not cleared; the worker’s own check decides its start', async () => {
    const m = world({ check: '{"reason":"layout","at":"2026-10-24T09:00:00.000Z"}' });
    m.fs.file(REFUSAL, '{"reason":"layout","at":"2026-10-24T09:00:00.000Z"}', 0o600);
    expect(await runCli(['consent'], m.deps)).toBe(0);
    expect(m.fs.read(REFUSAL)).not.toBeNull();
    expect(m.io.stdout).toContain(
      'worker: not started: refused, not retrying: the browser install is incomplete',
    );
    expect(m.loaded.has(LABEL)).toBe(false);
  });
  it('with no worker service installed yet, says how to finish turning it on: browser install with the app in Docker, setup natively', async () => {
    const docker = world({ worker: 'absent' });
    expect(await runCli(['consent'], docker.deps)).toBe(0);
    expect(docker.io.stdout).toContain(
      'The worker service is not installed yet: pnpm gmt browser install installs the worker service and starts it.',
    );
    expect(docker.runs().some((x) => x.startsWith('launchctl'))).toBe(false);
    const native = world({ worker: 'absent' });
    native.fs.file('/Users/op/.config/get-me-there/app.env', 'PORT=3000\n', 0o600);
    expect(await runCli(['consent'], native.deps)).toBe(0);
    expect(native.io.stdout).toContain(
      'The worker service is not installed yet: pnpm gmt setup --reconfigure browser turns the browser provider on.',
    );
  });
  // why: ts-b1-002, review X3: a stop that fails does not go on, and the worker is put back as it was
  it('a worker stop that fails spawns nothing and starts the worker again: 1, with the plan’s report', async () => {
    const m = world();
    const inner = m.deps.executor;
    let failed = false;
    m.deps.executor = {
      run: async (a) => {
        if (!failed && a.kind === 'waitGone') {
          failed = true;
          return Promise.reject(new Error('the label stayed'));
        }
        return inner.run(a);
      },
    };
    expect(await runCli(['consent'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('consent: stop the worker: stopped at a failed step');
    expect(m.attached).toEqual([]);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  // why: sec-b1-001, review X3: SIGINT or SIGTERM is passed to the child and the worker is put back before the end
  // why: CodeRabbit (PR #18): the handler is in place from before the stop, so an interruption during it still ends
  // with the worker put back and no child started
  it('an interruption during the worker’s stop starts no child and puts the worker back', async () => {
    const m = world();
    const handlers: Array<() => void> = [];
    let listening = 0;
    m.deps.onInterrupt = (h) => {
      handlers.push(h);
      listening++;
      return () => {
        listening--;
      };
    };
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'waitGone') for (const h of handlers) h();
        return inner.run(a);
      },
    };
    expect(await runCli(['consent'], m.deps)).toBe(130);
    expect(m.attached).toEqual([]);
    expect(m.loaded.has(LABEL)).toBe(true);
    expect(listening).toBe(0);
  });
  it('an interruption reaches the child, then the worker is put back as it was and nothing is cleared', async () => {
    const m = world();
    m.fs.file(REFUSAL, '{"reason":"consent-missing","at":"2026-10-24T09:00:00.000Z"}', 0o600);
    const handlers: Array<() => void> = [];
    let listening = 0;
    m.deps.onInterrupt = (h) => {
      handlers.push(h);
      listening++;
      return () => {
        listening--;
      };
    };
    m.deps.attach = (_argv, _cwd, _env, signal) =>
      new Promise((resolve) => {
        signal?.addEventListener('abort', () => resolve(130), { once: true });
        for (const h of handlers) h();
      });
    expect(await runCli(['consent'], m.deps)).toBe(130);
    expect(m.loaded.has(LABEL)).toBe(true);
    expect(m.fs.read(REFUSAL)).not.toBeNull();
    expect(listening).toBe(0);
  });
  it('a failure to spawn still puts the worker back, and is not reported as success', async () => {
    const m = world();
    m.deps.attach = async () => {
      throw new Error('spawn failed');
    };
    await expect(runCli(['consent'], m.deps)).rejects.toThrow('spawn failed');
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  it('a worker start that fails after a capture is 1, with the plan’s report', async () => {
    const m = world();
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a) =>
        a.kind === 'run' && a.argv.includes('bootstrap')
          ? Promise.reject(new Error('launchd said no'))
          : inner.run(a),
    };
    expect(await runCli(['consent'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('consent: the worker');
  });
});

describe('gmt consent export and import', () => {
  // why: review X4: export needs only the pinned Camoufox, so it runs where no worker is set up
  it('export runs with no worker.env, making the worker’s data directory 0700 for its lock and spacing', async () => {
    const m = world({ env: false, worker: 'absent' });
    expect(await runCli(['consent', 'export'], m.deps), m.io.stderr).toBe(0);
    expect(m.fs.isDir(DATA)).toBe(true);
    expect(m.fs.mode(DATA)).toBe(0o700);
    expect(m.attached[0]?.argv).toEqual([...ARGV, 'export']);
    expect(m.io.stdout).toBe('');
  });
  it('capture or import with no worker.env names the steps for this machine: browser install with the app in Docker', async () => {
    for (const action of [[], ['import']]) {
      const m = world({ env: false, worker: 'absent' });
      expect(await runCli(['consent', ...action], m.deps)).toBe(78);
      expect(m.io.stderr).toContain(
        'no worker.env): write worker.env as docs/setup.md#the-app-in-docker-the-worker-on-this-machine says, then pnpm gmt browser install',
      );
      expect(m.attached).toEqual([]);
    }
  });
  // why: po-b1-007: with --wait or --force the guard's words go to standard error, never into the exported line
  it('export --force with a search running says so on standard error only', async () => {
    const m = world({ docker: 'running', active: true });
    expect(await runCli(['consent', 'export', '--force'], m.deps)).toBe(0);
    expect(m.io.stdout).toBe('');
    expect(m.io.stderr).toContain('a search is running in the Docker app');
  });
  it('export writes nothing here, so the worker goes back as it was, the refusal untouched', async () => {
    const m = world();
    m.fs.file(REFUSAL, '{"reason":"consent-missing","at":"2026-10-24T09:00:00.000Z"}', 0o600);
    expect(await runCli(['consent', 'export'], m.deps)).toBe(0);
    expect(m.attached[0]?.argv).toEqual([...ARGV, 'export']);
    expect(m.fs.read(REFUSAL)).not.toBeNull();
    expect(m.loaded.has(LABEL)).toBe(true);
    const stopped = world({ worker: 'stopped' });
    stopped.loaded.delete(LABEL);
    expect(await runCli(['consent', 'export'], stopped.deps)).toBe(0);
    expect(stopped.loaded.has(LABEL)).toBe(false);
  });
  // why: CodeRabbit (PR #18): what gmt consent says after an export goes to standard error, beside the worker's own
  it('export’s standard output holds nothing of gmt’s own: the worker’s restart is said on standard error', async () => {
    const m = world();
    expect(await runCli(['consent', 'export'], m.deps)).toBe(0);
    expect(m.io.stdout).toBe('');
    expect(m.io.stderr).toContain('consent: the worker');
    const c = world();
    expect(await runCli(['consent'], c.deps)).toBe(0);
    expect(c.io.stdout).toContain('consent: the worker');
  });
  it('import from a terminal is refused before the worker is stopped: the line comes from a pipe or a file', async () => {
    const m = world();
    m.deps.io = { ...m.deps.io, stdinIsTTY: true };
    expect(await runCli(['consent', 'import'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('consent import reads the line from a pipe or a file, not the terminal');
    expect(m.attached).toEqual([]);
    expect(m.runs()).toEqual([]);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  it('import, its line on the inherited standard input, is a capture: the worker is stopped first and started after', async () => {
    const m = world();
    expect(await runCli(['consent', 'import'], m.deps)).toBe(0);
    expect(m.attached).toEqual([
      { argv: [...ARGV, 'import'], cwd: '/repo/apps/camoufox-worker', env: SERVICE_ENV, workerLoaded: false },
    ]);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
  it('a line on the command line is a usage error: import reads standard input only', () => {
    expect(parseCommandLine(['consent', 'import', 'gmt-socs-v1.abc'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('consent takes at most one <action>'),
    });
    expect(parseCommandLine(['consent', 'bogus'])).toMatchObject({
      kind: 'usage',
      message: expect.stringContaining('consent takes no action or one of: export, import, check'),
    });
    expect(parseCommandLine(['consent'])).toMatchObject({
      kind: 'command',
      command: 'consent',
      positional: null,
    });
    expect(helpText('consent')).toContain('usage: pnpm gmt consent [<action>] [options]');
  });
});

describe('gmt consent check', () => {
  it('spawns run.ts consent check and returns its code, stopping nothing', async () => {
    const m = world({ code: 78 });
    expect(await runCli(['consent', 'check'], m.deps)).toBe(78);
    expect(m.attached[0]?.argv).toEqual([...ARGV, 'check']);
    expect(m.runs()).toEqual([]);
    expect(m.loaded.has(LABEL)).toBe(true);
  });
});

describe('gmt consent’s refusals', () => {
  // why: po-b1-003, review X4: on the operator's machine the app runs in Docker, and the guard asks it too
  it('the Docker app with a run active refuses with 75 before the worker is stopped; --force goes ahead', async () => {
    const m = world({ docker: 'running', active: true });
    expect(await runCli(['consent'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('a search is running in the Docker app');
    expect(m.attached).toEqual([]);
    expect(m.runs()).toEqual([]);
    expect(await runCli(['consent', '--force'], m.deps)).toBe(0);
    expect(m.attached).toHaveLength(1);
    // why: CodeRabbit (PR #18): --force says what going ahead does to the run in the Docker app
    expect(m.io.stdout).toContain(
      'Going ahead anyway (--force): the Docker app stops within 30 s on SIGTERM',
    );
  });
  it('a Docker app with no run active lets it go ahead; a Docker state that cannot be read refuses unless --force', async () => {
    const idle = world({ docker: 'running' });
    expect(await runCli(['consent'], idle.deps)).toBe(0);
    const unknown = world({ docker: 'unreadable' });
    expect(await runCli(['consent'], unknown.deps)).toBe(75);
    expect(unknown.io.stderr).toContain(
      'cannot tell whether a search is running in the Docker app (there is no native install, and Docker’s compose state could not be read)',
    );
    expect(unknown.attached).toEqual([]);
    expect(await runCli(['consent', '--force'], unknown.deps)).toBe(0);
  });
  it('with no worker.env: the browser worker is not set up, nothing spawned', async () => {
    const m = world({ env: false, worker: 'absent' });
    expect(await runCli(['consent'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('the browser worker is not set up on this machine (no worker.env)');
    expect(m.attached).toEqual([]);
  });
  it('a native app with a run active refuses with 75 before the worker is stopped; --force goes ahead', async () => {
    const m = world({ active: true });
    m.fs.file('/work/a.json', '{}', 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    m.executor.log.length = 0;
    expect(await runCli(['consent'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('a search is running in the app');
    expect(m.attached).toEqual([]);
    expect(m.runs()).toEqual([]);
    expect(await runCli(['consent', '--force'], m.deps)).toBe(0);
    expect(m.attached).toHaveLength(1);
  });
  it('on Windows it refuses', async () => {
    const m = world();
    m.deps.platform = { ...m.deps.platform, os: 'win32' };
    expect(await runCli(['consent'], m.deps)).toBe(78);
    expect(m.attached).toEqual([]);
  });
});

describe('the display variables reach the window, by group (decision 74)', () => {
  const linux = (env: Record<string, string>) =>
    currentPlatform({ platform: 'linux', arch: 'arm64', uid: 501, env: { HOME: '/home/op', ...env } })
      .displayEnv;
  it('DISPLAY with XAUTHORITY, WAYLAND_DISPLAY with XDG_RUNTIME_DIR, each only with its main variable; never D-Bus', () => {
    expect(linux({ DISPLAY: ':0', XAUTHORITY: '/x', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/b' })).toEqual({
      DISPLAY: ':0',
      XAUTHORITY: '/x',
    });
    expect(
      linux({ WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/501', XAUTHORITY: '/x' }),
    ).toEqual({
      WAYLAND_DISPLAY: 'wayland-0',
      XDG_RUNTIME_DIR: '/run/user/501',
    });
    expect(linux({ DISPLAY: ':0' })).toEqual({ DISPLAY: ':0' });
    expect(linux({ DISPLAY: '', XAUTHORITY: '/x', XDG_RUNTIME_DIR: '/r', WAYLAND_DISPLAY: '' })).toEqual({});
    expect(linux({ DISPLAY: ':1', XAUTHORITY: '', WAYLAND_DISPLAY: 'w', XDG_RUNTIME_DIR: '' })).toEqual({
      DISPLAY: ':1',
      WAYLAND_DISPLAY: 'w',
    });
    expect(
      currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/h', DISPLAY: ':0' } })
        .displayEnv,
    ).toEqual({});
  });
  it('the spawned environment is PATH and HOME plus the platform’s display groups, and nothing else', async () => {
    const m = world();
    m.deps.platform = { ...m.deps.platform, displayEnv: { DISPLAY: ':0', XAUTHORITY: '/x' } };
    await runCli(['consent', 'export'], m.deps);
    expect(m.attached[0]?.env).toEqual({ ...SERVICE_ENV, DISPLAY: ':0', XAUTHORITY: '/x' });
  });
  it('the command imports no worker code', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'src', 'commands', 'consent.ts'), 'utf8');
    expect(text).not.toMatch(/from '[^']*camoufox-worker/);
    expect(text).not.toMatch(/from '@gmt\/camoufox-worker/);
  });
});
