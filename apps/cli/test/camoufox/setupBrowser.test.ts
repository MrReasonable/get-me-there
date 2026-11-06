import { parseEnv } from 'node:util';
import { CAMOUFOX_BUILDS, readSharedSettings, sharedSettingDiffs } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installCamoufox } from '../../src/camoufox/installer.js';
import {
  costsSummary,
  ENABLE_QUESTION,
  SERVER_QUESTION,
  SERVER_TEXT,
  unavailableText,
} from '../../src/camoufox/offer.js';
import {
  appEnvWithBrowser,
  keysDiffer,
  newWorkerKey,
  renderWorkerEnv,
  retiredWorkerLines,
  workerUrlOf,
} from '../../src/camoufox/workerEnv.js';
import { runCli } from '../../src/cli.js';
import { localChecks } from '../../src/commands/status.js';
import type { RunHandler } from '../../src/exec/memory.js';
import type { Action } from '../../src/plan/action.js';
import { serviceSet } from '../../src/services/set.js';
import { setLines } from '../../src/setup/appEnv.js';
import { scriptedAsk, stubHttp, testIo, unsetFlags } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: WP17 Task 17.6: the browser provider in gmt setup, the worker service and key rotation (spec §13; decision 75)
const ENV = '/Users/op/.config/get-me-there/app.env';
const WORKER_ENV = '/Users/op/.local/state/get-me-there/camoufox/worker.env';
const ROOT = '/Users/op/.local/share/get-me-there/camoufox';
const PLIST = '/Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist';
const MAC = CAMOUFOX_BUILDS['darwin-arm64'];

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('setup must not call fetch');
  });
});

/** A machine with an Enter-only setup done; `check` answers the worker's start check, `os` and display as given. */
async function world(
  o: { check?: string; bootstrapCode?: number; os?: 'darwin' | 'linux'; display?: boolean; df?: number } = {},
) {
  let started = false;
  const checks: string[][] = [];
  let n = 0;
  const handler: RunHandler = (argv) => {
    if (!started) return undefined;
    if (argv.includes('check') && argv.includes('--json') && argv.some((a) => a.endsWith('run.ts'))) {
      checks.push([...argv]);
      return { code: 0, stdout: `${o.check ?? '{"ok":true}'}\n` };
    }
    if (o.bootstrapCode !== undefined && argv[0] === 'launchctl' && argv[1] === 'bootstrap')
      return { code: o.bootstrapCode, stderr: 'bootstrap failed\n' };
    if (argv[0] === 'df') return { code: 0, stdout: `h\n/dev/disk 1 1 ${o.df ?? 99_999_999} 1% /\n` };
    if (argv[0] === 'ln') {
      m.fs.symlink(argv[3] ?? '', argv[2] ?? '');
      return { code: 0 };
    }
    return undefined;
  };
  const m = machine({ os: o.os ?? 'darwin', extra: handler });
  m.fs.file('/work/a.json', '{}', 0o600).dir('/repo/apps/camoufox-worker');
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  if (o.display === false) m.deps.platform = { ...m.deps.platform, hasDisplay: false };
  // why: a key per draw, so a rotation's new key differs from the old
  m.deps.randomBytes = (k) => Buffer.alloc(k, ++n);
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return { ...m, checks, opts: o };
}
const answers = (m: Awaited<ReturnType<typeof world>>, browser: Record<string, unknown>) =>
  m.fs.file('/work/b.json', JSON.stringify({ browser: { window: 'scheduled', ...browser } }), 0o600);
const env = (m: Awaited<ReturnType<typeof world>>, path = ENV) => parseEnv(m.fs.read(path) ?? '');
const kinds = (log: readonly Action[]) =>
  log.map((a) =>
    a.kind === 'run'
      ? `run ${a.argv[0]} ${a.argv[1] ?? ''}`.trim()
      : `${a.kind} ${'path' in a ? a.path : 'to' in a ? a.to : ''}`,
  );

describe('the browser provider’s offer (Task 17.6)', () => {
  it('where the flags are unset (linux-arm64) setup says so once, installs nothing and leaves CAMOUFOX_ENABLED unset', async () => {
    const m = await world({ os: 'linux' });
    // why: WP17 Task 17.8 recorded every entry; an entry awaiting recordings (a new build) is stated here
    m.deps.flags = unsetFlags;
    m.fs.file('/work/b.json', JSON.stringify({ browser: { window: 'scheduled', enabled: true } }), 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    const text = unavailableText('linux-arm64');
    expect(text).toBe(
      'The browser provider is not available on this machine yet (no recordings for linux-arm64); SearchApi and Travelpayouts work',
    );
    expect(m.io.stdout.split(text)).toHaveLength(2);
    expect(kinds(m.executor.log).some((k) => k.startsWith('download'))).toBe(false);
    expect(
      parseEnv(m.fs.read('/home/op/.config/get-me-there/app.env') ?? '').CAMOUFOX_ENABLED,
    ).toBeUndefined();
  });

  it('the costs summary is printed before the question, on every machine', async () => {
    const m = await world();
    const ask = scriptedAsk(['', '', '', '', '', '', '', false, false]);
    const seenAt: number[] = [];
    const confirm = ask.confirm;
    ask.confirm = async (q, d) => {
      if (q === ENABLE_QUESTION) seenAt.push(m.io.stdout.indexOf(costsSummary(MAC)));
      return confirm(q, d);
    };
    m.deps.ask = ask;
    m.deps.io = { ...testIo({ tty: true }), out: m.deps.io.out, err: m.deps.io.err };
    m.fs.delete(ENV);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(seenAt).toHaveLength(1);
    expect(seenAt[0]).toBeGreaterThanOrEqual(0);
    expect(m.io.stdout).toContain('The browser provider stays off.');
    expect(costsSummary(MAC)).toContain('313 MB download and about 670 MB unpacked');
  });

  it('with no display: the server text, then a typed yes (interactive) or acceptServerAddress (answers); without it, off', async () => {
    const typed = await world({ display: false });
    typed.deps.ask = scriptedAsk([false, true, 'no']);
    typed.deps.io = { ...testIo({ tty: true }), out: typed.deps.io.out, err: typed.deps.io.err };
    expect(await runCli(['setup', '--reconfigure', 'browser'], typed.deps)).toBe(0);
    expect(typed.io.stdout).toContain(SERVER_TEXT);
    expect(typed.io.stdout.indexOf(SERVER_TEXT)).toBeLessThan(
      typed.io.stdout.indexOf('The browser provider stays off.'),
    );
    const off = await world({ display: false });
    answers(off, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], off.deps)).toBe(0);
    expect(env(off).CAMOUFOX_WORKER_KEY).toBeUndefined();
    const on = await world({ display: false });
    answers(on, { enabled: true, acceptServerAddress: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], on.deps)).toBe(0);
    expect(env(on).CAMOUFOX_ENABLED).toBe('true');
    expect(SERVER_QUESTION).toContain('Type yes');
  });
});

describe('choosing it (Task 17.6): costs, consent method, install, worker.env, then consent before CAMOUFOX_ENABLED', () => {
  it('installs, writes worker.env 0600 with a 48-hex key mirrored into app.env and equal shared settings, then turns on and starts the worker', async () => {
    const m = await world();
    answers(m, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    const out = m.io.stdout;
    expect(out.indexOf('Browser provider:')).toBeLessThan(out.indexOf('Consent:'));
    const log = kinds(m.executor.log);
    const download = log.findIndex((k) => k.startsWith('download'));
    const workerEnv = log.indexOf(`writeFile ${WORKER_ENV}`);
    expect(download).toBeGreaterThan(-1);
    expect(workerEnv).toBeGreaterThan(download);
    expect(m.fs.mode(WORKER_ENV)).toBe(0o600);
    const w = env(m, WORKER_ENV);
    const a = env(m);
    expect(w.CAMOUFOX_WORKER_KEY).toMatch(/^[0-9a-f]{48}$/);
    expect(a.CAMOUFOX_WORKER_KEY).toBe(w.CAMOUFOX_WORKER_KEY);
    expect(a.CAMOUFOX_WORKER_URL).toBe('http://127.0.0.1:8090');
    expect(
      sharedSettingDiffs(readSharedSettings(a).settings, readSharedSettings(w).settings, 'grid'),
    ).toEqual([]);
    expect(a.CAMOUFOX_ENABLED).toBe('true');
    expect(m.fs.read(PLIST)).not.toBeNull();
    expect(log.indexOf(`writeFile ${PLIST}`)).toBeGreaterThan(workerEnv);
    expect(m.checks).toHaveLength(1);
    expect(m.io.stdout).not.toContain(w.CAMOUFOX_WORKER_KEY ?? 'none');
    expect(m.io.stderr).not.toContain(w.CAMOUFOX_WORKER_KEY ?? 'none');
    expect(serviceSet(m.deps).map((e) => e.name)).toEqual(['app', 'backup', 'camoufox-worker']);
    expect(m.fs.read(`${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6/version.json`)).not.toBeNull();
  });

  it('without consent the worker’s check stops it: provider off, not-set-up, no worker service and no failing status row; a re-run resumes', async () => {
    const m = await world({ check: '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}' });
    answers(m, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    expect(m.io.stderr).toContain(
      'The worker needs your consent choice before it can start: no consent record: capture one.',
    );
    expect(m.io.stderr).toContain('resume with pnpm gmt setup --reconfigure browser');
    expect(env(m).CAMOUFOX_ENABLED).toBeUndefined();
    expect(env(m).CAMOUFOX_WORKER_KEY).toMatch(/^[0-9a-f]{48}$/);
    expect(m.fs.read(PLIST)).toBeNull();
    expect(serviceSet(m.deps).map((e) => e.name)).toEqual(['app', 'backup']);
    expect((await localChecks(m.deps)).filter((c) => c.level === 'fail').map((c) => c.name)).toEqual([]);
    // the operator captures consent, then resumes
    const key = env(m).CAMOUFOX_WORKER_KEY;
    const r = await world();
    r.fs.file(ENV, m.fs.read(ENV) ?? '', 0o600).file(WORKER_ENV, m.fs.read(WORKER_ENV) ?? '', 0o600);
    answers(r, { enabled: true });
    expect(
      await runCli(
        ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
        r.deps,
      ),
    ).toBe(0);
    expect(env(r).CAMOUFOX_ENABLED).toBe('true');
    expect(env(r).CAMOUFOX_WORKER_KEY).toBe(key);
  });

  it('a step that stops (free space, another refusal) leaves the provider off with the resume line', async () => {
    const small = await world({ df: 1 });
    answers(small, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], small.deps)).toBe(0);
    expect(small.io.stderr).toContain('Camoufox needs 983 MB free');
    expect(env(small).CAMOUFOX_WORKER_KEY).toBeUndefined();
    const locked = await world({ check: '{"reason":"locked","at":"2026-10-24T09:30:00.000Z"}' });
    answers(locked, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], locked.deps);
    expect(locked.io.stderr).toContain(
      'The worker would refuse to start: refused, not retrying: another worker holds the lock; fix: pnpm gmt restart',
    );
    expect(env(locked).CAMOUFOX_ENABLED).toBeUndefined();
    const garbled = await world({ check: 'not json' });
    answers(garbled, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], garbled.deps);
    expect(garbled.io.stderr).toContain('the worker’s start check exited 0 and said nothing');
  });
});

// why: ts-b1-003: each stop of the turn-on and the reconfigure says its own reason, and each restart its own steps
describe('the browser step’s stops and steps (ts-b1-003)', () => {
  const runs = (log: readonly Action[]) =>
    log.map((a) =>
      a.kind === 'run' ? a.argv.slice(0, 3).join(' ') : a.kind === 'waitHealthy' ? `wait ${a.url}` : a.kind,
    );
  const tty = (m: Awaited<ReturnType<typeof world>>, script: Array<string | boolean>) => {
    const ask = scriptedAsk(script);
    m.deps.ask = ask;
    m.deps.io = { ...testIo({ tty: true }), out: m.deps.io.out, err: m.deps.io.err };
    return ask;
  };

  const BUNDLE = `${ROOT}/browsers/official/152.0.4-beta.28-8b7680a6`;
  /** The provider on, then one reconfigure so app.env holds every line setup writes; logs and output cleared. */
  async function settled() {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    // why: the memory unpack writes no app inside the bundle; a real one does, and the link resolves to it
    m.fs.dir(`${BUNDLE}/Camoufox.app`, 0o755);
    await reconfigure(m);
    return m;
  }
  async function reconfigure(m: Awaited<ReturnType<typeof world>>) {
    m.executor.log.length = 0;
    m.runner.calls.length = 0;
    m.io.stdout = '';
    m.io.stderr = '';
    return runCli(
      ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
      m.deps,
    );
  }

  it('with a display: no server text, and Enter on the question is no', async () => {
    const m = await world();
    const ask = tty(m, ['', '']);
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(0);
    expect(m.io.stdout).not.toContain(SERVER_TEXT);
    expect(ask.defaults.find((d) => d.q === ENABLE_QUESTION)).toEqual({ q: ENABLE_QUESTION, def: false });
    expect(m.io.stdout).toContain('The browser provider stays off.');
  });

  it('the turn-on: no worker to stop, the app stopped, files written, the worker started, then the app and its health on its port', async () => {
    const m = await world();
    m.fs.file(ENV, setLines(m.fs.read(ENV) ?? '', new Set(['PORT']), [['PORT', '3101']]), 0o600);
    answers(m, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    const r = runs(m.executor.log);
    const after = r.slice(r.lastIndexOf('writeFile') - 1);
    expect(r.filter((x) => x.includes('camoufox-worker') && x.startsWith('launchctl bootout'))).toEqual([]);
    expect(r.at(-1)).toBe('wait http://127.0.0.1:3101/api/health');
    const appStop = r.indexOf('launchctl bootout gui/501/local.get-me-there.app');
    const workerStart = r.findIndex((x) => x.startsWith('launchctl bootstrap') && after.includes(x));
    expect(appStop).toBeGreaterThan(-1);
    expect(workerStart).toBeGreaterThan(appStop);
    expect(m.io.stdout).toContain('The browser provider is on: the worker service is installed and running.');
  });

  it('a worker.env whose port is not one stops with that reason', async () => {
    const m = await world();
    m.fs
      .dir('/Users/op/.local/state/get-me-there/camoufox', 0o700)
      .file(WORKER_ENV, 'CAMOUFOX_WORKER_PORT="80"\n', 0o600);
    answers(m, { enabled: true });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    expect(m.io.stderr).toContain('CAMOUFOX_WORKER_PORT in worker.env is not a port from 1024 to 65535');
    expect(m.io.stderr).toContain('resume with pnpm gmt setup --reconfigure browser');
    expect(env(m).CAMOUFOX_ENABLED).toBeUndefined();
  });

  it('a kept worker.env line spread over lines stops before anything is written', async () => {
    const m = await world();
    m.fs.dir('/Users/op/.local/state/get-me-there/camoufox', 0o700).file(WORKER_ENV, 'NOTE="a\nb"\n', 0o600);
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    expect(m.io.stderr).toContain('resume with pnpm gmt setup --reconfigure browser');
    expect(env(m).CAMOUFOX_WORKER_KEY).toBeUndefined();
  });

  it('--reconfigure browser: an install it cannot do says why and leaves the provider as it was (exit 0)', async () => {
    const m = await settled();
    m.fs.delete(BUNDLE);
    m.opts.df = 1;
    expect(await reconfigure(m)).toBe(0);
    expect(m.io.stderr).toContain('Camoufox needs 983 MB free');
  });

  it('--reconfigure browser with equal keys and no new bundle restarts nothing; a new bundle restarts the worker alone', async () => {
    const m = await settled();
    expect(await reconfigure(m)).toBe(0);
    expect(runs(m.executor.log).filter((x) => x.startsWith('launchctl'))).toEqual([]);
    expect(m.io.stdout).not.toContain('keys differ');
    m.fs.delete(BUNDLE);
    expect(await reconfigure(m)).toBe(0);
    const r = runs(m.executor.log).filter((x) => x.startsWith('launchctl'));
    expect(r).toEqual([
      'launchctl bootout gui/501/local.get-me-there.camoufox-worker',
      'launchctl bootstrap gui/501',
    ]);
    expect(runs(m.executor.log).some((x) => x.startsWith('wait '))).toBe(false);
  });

  it('a new bundle whose worker restart fails fails the reconfigure, naming the step', async () => {
    const m = await settled();
    m.fs.delete(BUNDLE);
    m.opts.bootstrapCode = 5;
    expect(await reconfigure(m)).toBe(1);
    expect(m.io.stderr).toContain('setup: the browser provider: stopped at a failed step');
    expect(m.io.stderr).not.toContain('repairs the keys');
  });

  it('a new bundle whose worker check refuses leaves the worker stopped, saying why; the reconfigure still succeeds', async () => {
    const m = await settled();
    m.fs.delete(BUNDLE);
    m.opts.check = '{"reason":"consent-missing","at":"2026-10-24T09:30:00.000Z"}';
    expect(await reconfigure(m)).toBe(0);
    expect(m.io.stdout).toContain('worker: not started: ');
    expect(runs(m.executor.log).filter((x) => x.startsWith('launchctl bootstrap'))).toEqual([]);
  });

  it('a download that fails in the reconfigure fails setup with its step', async () => {
    const m = await settled();
    m.fs.delete(BUNDLE);
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a: Action) => {
        if (a.kind === 'download') throw new Error('answered 503');
        return inner.run(a);
      },
    };
    expect(await reconfigure(m)).toBe(1);
    expect(m.io.stderr).toContain('setup: install Camoufox: stopped at a failed step');
  });

  it('a new key that cannot be written into worker.env fails the reconfigure with worker.env’s reason, writing nothing', async () => {
    const m = await settled();
    m.fs.file(WORKER_ENV, `${m.fs.read(WORKER_ENV) ?? ''}MY_NOTE="first\nsecond"\n`, 0o600);
    const before = m.fs.read(ENV);
    m.fs.file('/work/b.json', JSON.stringify({ browser: { window: 'scheduled', rotateKey: true } }), 0o600);
    expect(await reconfigure(m)).toBe(1);
    expect(m.io.stderr).toBe(
      'worker.env holds MY_NOTE over several lines; put it on one line, then run setup again\n',
    );
    expect(m.fs.read(ENV)).toBe(before);
  });

  it('a re-run whose worker unit changed and whose check passes rewrites and starts it', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.fs.file(PLIST, '<plist>old</plist>', 0o644);
    m.io.stderr = '';
    expect(
      await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps),
      m.io.stderr,
    ).toBe(0);
    expect(m.fs.read(PLIST)).toContain('<string>/repo/apps/camoufox-worker/src/run.ts</string>');
  });

  it('a re-run with the provider on and its unit unchanged plans nothing for the worker', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.executor.log.length = 0;
    m.checks.length = 0;
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(0);
    expect(m.checks).toEqual([]);
    expect(runs(m.executor.log).filter((x) => x.includes('camoufox-worker'))).toEqual([]);
  });

  it('a re-run whose changed unit fails to start fails setup, naming the worker service', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.fs.file(PLIST, '<plist>old</plist>', 0o644);
    m.opts.bootstrapCode = 5;
    m.io.stderr = '';
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('setup: the worker service: stopped at a failed step');
  });
});

describe('the worker service (Task 17.6)', () => {
  it('runs run.ts main from the worker package with PATH and HOME only; launchd KeepAlive on failure, ThrottleInterval 600', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    const plist = m.fs.read(PLIST) ?? '';
    for (const s of [
      '<string>/opt/node/bin/node</string>',
      '<string>--conditions=@gmt/source</string>',
      '<string>--import</string>',
      '<string>tsx</string>',
      '<string>/repo/apps/camoufox-worker/src/run.ts</string>',
      '<string>main</string>',
      '<key>WorkingDirectory</key>\n  <string>/repo/apps/camoufox-worker</string>',
      '<key>SuccessfulExit</key>\n    <false/>',
      '<key>ThrottleInterval</key>\n  <integer>600</integer>',
    ])
      expect(plist).toContain(s);
    const envKeys = [
      ...(plist.split('<key>EnvironmentVariables</key>')[1]?.split('</dict>')[0] ?? '').matchAll(
        /<key>(\w+)<\/key>/g,
      ),
    ].map((x) => x[1]);
    expect(envKeys).toEqual(['HOME', 'PATH']);
  });
  it('systemd: RestartPreventExitStatus=78', async () => {
    const m = machine({ os: 'linux' });
    const unit = serviceSet({
      ...m.deps,
      files: m.fs.file('/home/op/.config/get-me-there/app.env', 'CAMOUFOX_ENABLED="true"\n'),
    }).find((e) => e.name === 'camoufox-worker')?.rendered[0]?.contents;
    expect(unit).toContain('RestartPreventExitStatus=78');
    expect(unit).toContain('"/repo/apps/camoufox-worker/src/run.ts" "main"');
  });
  it('gmt start runs the worker’s check first and starts no worker on a refusal; a refusal file prints its line', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.fs.file(
      '/Users/op/.local/state/get-me-there/camoufox/start-refusal.json',
      '{"reason":"layout","at":"2026-10-24T09:30:00.000Z"}',
      0o600,
    );
    m.opts.check = '{"reason":"layout","at":"2026-10-24T09:30:00.000Z"}';
    m.checks.length = 0;
    m.executor.log.length = 0;
    m.io.stdout = '';
    expect(await runCli(['start'], m.deps), m.io.stderr).toBe(0);
    // why: ca-b1-012: one line, one formatter (WP16b's refusalLine) with the fix that works today
    expect(m.io.stdout).toContain(
      'worker: not started: refused, not retrying: the browser install is incomplete or has changed; fix: pnpm gmt browser install\n',
    );
    expect(m.io.stdout.match(/the browser install is incomplete/g)).toHaveLength(1);
    expect(m.checks).toHaveLength(1);
    // why: launchd cannot exclude exit 78, so the refused worker's loaded agent is booted out, never started
    const runs = m.executor.log
      .filter((a) => a.kind === 'run')
      .map((a) => (a.kind === 'run' ? a.argv.join(' ') : ''));
    expect(runs.filter((r) => r.includes('camoufox-worker'))).toEqual([
      'launchctl bootout gui/501/local.get-me-there.camoufox-worker',
    ]);
  });
  it('uninstall removes the worker service with the others', async () => {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(0);
    expect(m.fs.read(PLIST)).toBeNull();
  });
});

describe('key rotation under --reconfigure browser (Task 17.6)', () => {
  async function on() {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.executor.log.length = 0;
    m.io.stdout = '';
    m.io.stderr = '';
    return m;
  }
  it('keys that differ default to a new key: stop both, worker.env then app.env (0600), start the worker then the app; no key printed', async () => {
    const m = await on();
    const oldKey = env(m).CAMOUFOX_WORKER_KEY ?? '';
    m.fs.file(
      WORKER_ENV,
      setLines(m.fs.read(WORKER_ENV) ?? '', new Set(['CAMOUFOX_WORKER_KEY']), [
        ['CAMOUFOX_WORKER_KEY', 'f'.repeat(48)],
      ]),
      0o600,
    );
    m.deps.ask = scriptedAsk([false, '']);
    m.deps.io = { ...testIo({ tty: true }), out: m.deps.io.out, err: m.deps.io.err };
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/health': () => ({ status: 200, body: { ok: true } }),
    });
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('The app’s and the worker’s keys differ.');
    const log = kinds(m.executor.log);
    const order = [
      log.indexOf('run launchctl bootout'),
      log.indexOf(`writeFile ${WORKER_ENV}`),
      log.lastIndexOf(`writeFile ${ENV}`),
    ];
    expect(order.every((x) => x >= 0)).toBe(true);
    expect(order[1]).toBeLessThan(order[2] ?? 0);
    // why: ts-b1-008: the worker starts before the app, so the app's first status read finds it up
    const runs = m.executor.log.map((a) => (a.kind === 'run' ? a.argv.join(' ') : ''));
    const workerUp = runs.findIndex(
      (r, i) => i > (order[2] ?? 0) && r.startsWith('launchctl bootstrap') && r.includes('camoufox-worker'),
    );
    const appUp = runs.findIndex(
      (r, i) =>
        i > (order[2] ?? 0) && r.startsWith('launchctl bootstrap') && r.includes('local.get-me-there.app'),
    );
    expect(workerUp).toBeGreaterThan(order[2] ?? 0);
    expect(appUp).toBeGreaterThan(workerUp);
    // why: the executor's logged actions carry no key either
    const logged = JSON.stringify(m.executor.log.filter((a) => !(a.kind === 'writeFile' && a.secret)));
    const newKey = env(m).CAMOUFOX_WORKER_KEY ?? '';
    expect(newKey).toMatch(/^[0-9a-f]{48}$/);
    expect(newKey).not.toBe(oldKey);
    expect(env(m, WORKER_ENV).CAMOUFOX_WORKER_KEY).toBe(newKey);
    expect(m.fs.mode(WORKER_ENV)).toBe(0o600);
    expect(m.fs.mode(ENV)).toBe(0o600);
    for (const k of [oldKey, newKey, 'f'.repeat(48), Buffer.from(newKey).toString('base64url')]) {
      expect(m.io.stdout).not.toContain(k);
      expect(m.io.stderr).not.toContain(k);
      expect(logged).not.toContain(k);
    }
  });
  // why: ts-b1-008: an interruption after any one action of the rotation leaves a state a re-run repairs
  it('interrupted after each of its actions in turn, a re-run repairs the keys every time', async () => {
    const probe = await on();
    answers(probe, { enabled: true, rotateKey: true });
    const http = () =>
      stubHttp({
        'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
        'GET /api/health': () => ({ status: 200, body: { ok: true } }),
      });
    probe.deps.http = http();
    probe.executor.log.length = 0;
    expect(
      await runCli(
        ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
        probe.deps,
      ),
    ).toBe(0);
    const count = probe.executor.log.length;
    expect(count).toBeGreaterThan(4);
    for (let stopAt = 0; stopAt < count; stopAt++) {
      const m = await on();
      const inner = m.deps.executor;
      let n = 0;
      m.deps.executor = {
        run: async (a) => {
          if (n++ === stopAt) throw new Error('interrupted in the test');
          return inner.run(a);
        },
      };
      answers(m, { enabled: true, rotateKey: true });
      m.deps.http = http();
      expect(
        await runCli(
          ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
          m.deps,
        ),
        `interrupted at ${stopAt}`,
      ).toBe(1);
      m.deps.executor = inner;
      answers(m, { enabled: true });
      expect(
        await runCli(
          ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
          m.deps,
        ),
        `repaired after ${stopAt}`,
      ).toBe(0);
      expect(keysDiffer(env(m), env(m, WORKER_ENV)), `after ${stopAt}`).toBe(false);
    }
  });
  it('interrupted after the worker’s file, it says a re-run repairs the keys', async () => {
    const m = await on();
    const inner = m.deps.executor;
    let workerWritten = false;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'writeFile' && a.path === WORKER_ENV) workerWritten = true;
        else if (a.kind === 'writeFile' && a.path === ENV && workerWritten)
          throw new Error('interrupted in the test');
        return inner.run(a);
      },
    };
    answers(m, { enabled: true, rotateKey: true });
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/health': () => ({ status: 200, body: { ok: true } }),
    });
    expect(
      await runCli(
        ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
        m.deps,
      ),
    ).toBe(1);
    expect(keysDiffer(env(m), env(m, WORKER_ENV))).toBe(true);
    expect(m.io.stderr).toContain('A re-run of pnpm gmt setup --reconfigure browser repairs the keys.');
  });
});

describe('worker.env and its helpers', () => {
  it('a key is 24 random bytes as hex; keys compare by digest; a missing key differs', () => {
    expect(newWorkerKey((n) => Buffer.alloc(n, 255))).toBe('ff'.repeat(24));
    expect(keysDiffer({ CAMOUFOX_WORKER_KEY: 'a' }, { CAMOUFOX_WORKER_KEY: 'a' })).toBe(false);
    expect(keysDiffer({ CAMOUFOX_WORKER_KEY: 'a' }, { CAMOUFOX_WORKER_KEY: 'b' })).toBe(true);
    expect(keysDiffer({}, { CAMOUFOX_WORKER_KEY: 'b' })).toBe(true);
    expect(keysDiffer({ CAMOUFOX_WORKER_KEY: '' }, { CAMOUFOX_WORKER_KEY: '' })).toBe(true);
    expect(keysDiffer({ CAMOUFOX_WORKER_KEY: 'a' }, null)).toBe(true);
  });
  it('worker.env holds the key and the app’s effective shared settings, keeping the operator’s other lines', () => {
    const app = { CAMOUFOX_MODE: 'grid', CAMOUFOX_COOLDOWN_HOURS: '72' };
    const r = renderWorkerEnv(
      'k'.repeat(48),
      readSharedSettings(app).settings,
      'CAMOUFOX_WORKER_PORT="8091"\nCAMOUFOX_MODE="list"\n# a note\n',
    );
    if (!r.ok) throw new Error(r.error);
    const w = parseEnv(r.text);
    expect(w).toMatchObject({
      CAMOUFOX_WORKER_KEY: 'k'.repeat(48),
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_COOLDOWN_HOURS: '72',
      CAMOUFOX_WORKER_PORT: '8091',
    });
    const record = Object.fromEntries(
      Object.entries(w).filter((e): e is [string, string] => e[1] !== undefined),
    );
    expect(
      sharedSettingDiffs(readSharedSettings(app).settings, readSharedSettings(record).settings, 'grid'),
    ).toEqual([]);
  });
  it('worker.env is the header, the kept lines, then the owned ones: nothing else, comments not carried', () => {
    const r = renderWorkerEnv(
      'k'.repeat(48),
      readSharedSettings({}).settings,
      'CAMOUFOX_WORKER_PORT="8091"\n# mine\n\n',
    );
    if (!r.ok) throw new Error(r.error);
    const lines = r.text.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '# get-me-there browser worker settings, written by `pnpm gmt setup` (docs/setup.md section 14).',
      '# Keep this file 0600. The shared settings must equal app.env’s; setup keeps them equal.',
      'CAMOUFOX_WORKER_PORT="8091"',
      `CAMOUFOX_WORKER_KEY="${'k'.repeat(48)}"`,
    ]);
    expect(lines.filter((l) => l !== '' && !l.startsWith('#') && !/^[A-Z_]+=/.test(l))).toEqual([]);
    expect(r.text).not.toContain('# mine');
  });
  it('a multi-line value is refused whichever quote opens it, spaces before it or not; an owned one is replaced', () => {
    const shared = readSharedSettings({}).settings;
    for (const kept of ["MY_NOTE='first\nsecond'\n", 'MY_NOTE= "first\nsecond"\n'])
      expect(renderWorkerEnv('k'.repeat(48), shared, kept)).toMatchObject({ ok: false });
    expect(renderWorkerEnv('k'.repeat(48), shared, 'MY_NOTE=\'one line\'\nB="x=y"\n')).toMatchObject({
      ok: true,
    });
    const owned = renderWorkerEnv('k'.repeat(48), shared, 'CAMOUFOX_MODE="list\n');
    if (!owned.ok) throw new Error(owned.error);
    expect(parseEnv(owned.text).CAMOUFOX_MODE).toBe(shared.CAMOUFOX_MODE);
  });
  // why: sec-b1-007: the text is read back before it is written, and a value spread over lines is refused, never cut
  it('worker.env refuses a kept value spread over several lines', () => {
    const r = renderWorkerEnv('k'.repeat(48), readSharedSettings({}).settings, 'MY_NOTE="first\nsecond"\n');
    expect(r).toEqual({
      ok: false,
      error: 'worker.env holds MY_NOTE over several lines; put it on one line, then run setup again',
    });
  });
  it('app.env’s browser lines go through the one line editor, replaced in place, a duplicate dropped, read back', () => {
    expect(
      appEnvWithBrowser('A="1"\nCAMOUFOX_ENABLED="false"\nCAMOUFOX_ENABLED="x"\n', [
        ['CAMOUFOX_ENABLED', 'true'],
        ['CAMOUFOX_WORKER_URL', 'http://127.0.0.1:8090'],
      ]),
    ).toEqual({
      ok: true,
      text: 'A="1"\nCAMOUFOX_ENABLED="true"\nCAMOUFOX_WORKER_URL="http://127.0.0.1:8090"\n',
    });
    expect(appEnvWithBrowser('', [['CAMOUFOX_WORKER_KEY', 'a"b']])).toEqual({
      ok: false,
      error: 'app.env a value holds a character the file cannot carry: CAMOUFOX_WORKER_KEY',
    });
  });
  // why: ca-b1-008: the app's address is worker.env's own port, through core's one rule
  it('the worker’s address is its own port: 8090 unset, the configured one, none for a bad one', () => {
    expect(workerUrlOf(null)).toBe('http://127.0.0.1:8090');
    expect(workerUrlOf({ CAMOUFOX_WORKER_PORT: '8091' })).toBe('http://127.0.0.1:8091');
    expect(workerUrlOf({ CAMOUFOX_WORKER_PORT: '80' })).toBeNull();
  });
  it('the retired names are removed from worker.env, every other line kept', () => {
    expect(
      retiredWorkerLines('A="1"\nCAMOUFOX_BINARY_BUILD="x"\nexport CAMOUFOX_INSTALL_DIR=/y\nB=2\n'),
    ).toEqual({ text: 'A="1"\nB=2\n', removed: ['CAMOUFOX_BINARY_BUILD', 'CAMOUFOX_INSTALL_DIR'] });
    expect(retiredWorkerLines('A=1\n')).toEqual({ text: 'A=1\n', removed: [] });
  });
});

// why: the coordinator's ruling for Task 17.8: a recording session stops the browser worker alone, never a native app
describe('the installer off macOS and Linux', () => {
  it('refuses with the machine named and does nothing', async () => {
    const m = await world();
    m.deps.platform = { ...m.deps.platform, os: 'win32', arch: 'x64' };
    expect(await installCamoufox(m.deps, { command: 'browser install' })).toEqual({
      kind: 'refused',
      message: 'no Camoufox build is pinned for win32-x64; the browser provider runs on macOS and Linux',
    });
    expect(m.executor.log).toEqual([]);
  });
});

describe('start, stop and restart --only <service>', () => {
  async function on() {
    const m = await world();
    answers(m, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], m.deps);
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/health': () => ({ status: 200, body: { ok: true } }),
    });
    m.executor.log.length = 0;
    m.checks.length = 0;
    return m;
  }
  const runs = (log: readonly Action[]) =>
    log.filter((a) => a.kind === 'run').map((a) => (a.kind === 'run' ? a.argv.join(' ') : ''));
  it('stop --only worker stops the worker alone; the app keeps running', async () => {
    const m = await on();
    expect(await runCli(['stop', '--only', 'worker'], m.deps)).toBe(0);
    expect(runs(m.executor.log)).toEqual(['launchctl bootout gui/501/local.get-me-there.camoufox-worker']);
    expect(m.loaded.has('local.get-me-there.app')).toBe(true);
    expect(m.loaded.has('local.get-me-there.camoufox-worker')).toBe(false);
  });
  it('start --only worker checks the worker and starts it alone', async () => {
    const m = await on();
    await runCli(['stop', '--only', 'worker'], m.deps);
    m.executor.log.length = 0;
    expect(await runCli(['start', '--only', 'worker'], m.deps)).toBe(0);
    expect(m.checks).toHaveLength(1);
    expect(runs(m.executor.log)).toEqual([
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.camoufox-worker.plist',
    ]);
  });
  it('stop --only app leaves the worker; restart --only worker restarts it alone', async () => {
    const m = await on();
    expect(await runCli(['stop', '--only', 'app'], m.deps)).toBe(0);
    expect(runs(m.executor.log)).toEqual(['launchctl bootout gui/501/local.get-me-there.app']);
    m.executor.log.length = 0;
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(0);
    expect(runs(m.executor.log).every((r) => r.includes('camoufox-worker'))).toBe(true);
    expect(runs(m.executor.log).length).toBeGreaterThan(0);
  });
  it('a service that is not installed is refused with 78, nothing done; an unknown one is a usage error', async () => {
    const m = await world();
    for (const verb of ['start', 'stop', 'restart']) {
      m.io.stderr = '';
      expect(await runCli([verb, '--only', 'worker'], m.deps), verb).toBe(78);
      expect(m.io.stderr).toBe('the worker service is not installed: nothing to do\n');
    }
    expect(m.executor.log).toEqual([]);
    expect(await runCli(['stop', '--only', 'browser'], m.deps)).toBe(64);
    expect(m.io.stderr).toContain('unknown service for --only: browser (one of app, backup, worker)');
    m.io.stdout = '';
    expect(await runCli(['stop', '--help'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('--only <service>          act on one service only: app, backup, worker');
  });
});
