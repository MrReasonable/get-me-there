import { parseEnv } from 'node:util';
import { CAMOUFOX_BUILDS, readSharedSettings, sharedSettingDiffs } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pagesFromProviders } from '../../src/camoufox/browserSetup.js';
import {
  costsSummary,
  ENABLE_QUESTION,
  SERVER_QUESTION,
  SERVER_TEXT,
  unavailableText,
} from '../../src/camoufox/offer.js';
import {
  keysDiffer,
  newWorkerKey,
  renderWorkerEnv,
  settingsDiffer,
  withBrowserLines,
} from '../../src/camoufox/workerEnv.js';
import { runCli } from '../../src/cli.js';
import { localChecks } from '../../src/commands/status.js';
import type { RunHandler } from '../../src/exec/memory.js';
import type { Action } from '../../src/plan/action.js';
import { serviceSet } from '../../src/services/set.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
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
async function world(o: { check?: string; os?: 'darwin' | 'linux'; display?: boolean; df?: number } = {}) {
  let started = false;
  const checks: string[][] = [];
  let n = 0;
  const handler: RunHandler = (argv) => {
    if (!started) return undefined;
    if (argv.includes('check') && argv.includes('--json') && argv.some((a) => a.endsWith('run.ts'))) {
      checks.push([...argv]);
      return { code: 0, stdout: `${o.check ?? '{"ok":true}'}\n` };
    }
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
      'The worker would refuse to start: another worker holds the lock (fix: pnpm gmt restart)',
    );
    expect(env(locked).CAMOUFOX_ENABLED).toBeUndefined();
    const garbled = await world({ check: 'not json' });
    answers(garbled, { enabled: true });
    await runCli(['setup', '--non-interactive', '--answers', '/work/b.json'], garbled.deps);
    expect(garbled.io.stderr).toContain('the worker’s start check printed no result');
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
    expect(m.io.stdout).toContain(
      'worker: refused, not retrying: the browser install is incomplete or has changed',
    );
    expect(m.io.stdout).toContain(
      'worker: not started: the browser install is incomplete or has changed (fix: pnpm gmt setup --reconfigure browser)',
    );
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
      withBrowserLines(m.fs.read(WORKER_ENV) ?? '', [['CAMOUFOX_WORKER_KEY', 'f'.repeat(48)]]),
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
      log.findIndex((k) => k === 'run launchctl bootout'),
      log.indexOf(`writeFile ${WORKER_ENV}`),
      log.lastIndexOf(`writeFile ${ENV}`),
    ];
    expect(order.every((x) => x >= 0)).toBe(true);
    expect(order[1]).toBeLessThan(order[2] ?? 0);
    expect(log.lastIndexOf('run launchctl bootstrap')).toBeGreaterThan(order[2] ?? 0);
    const newKey = env(m).CAMOUFOX_WORKER_KEY ?? '';
    expect(newKey).toMatch(/^[0-9a-f]{48}$/);
    expect(newKey).not.toBe(oldKey);
    expect(env(m, WORKER_ENV).CAMOUFOX_WORKER_KEY).toBe(newKey);
    expect(m.fs.mode(WORKER_ENV)).toBe(0o600);
    expect(m.fs.mode(ENV)).toBe(0o600);
    for (const k of [oldKey, newKey, 'f'.repeat(48), Buffer.from(newKey).toString('base64url')]) {
      expect(m.io.stdout).not.toContain(k);
      expect(m.io.stderr).not.toContain(k);
    }
  });
  it('interrupted after the worker’s file the keys differ, and a re-run repairs them', async () => {
    const m = await on();
    const inner = m.deps.executor;
    let workerWritten = false;
    let interrupted = false;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'writeFile' && a.path === WORKER_ENV) workerWritten = true;
        else if (a.kind === 'writeFile' && a.path === ENV && workerWritten && !interrupted) {
          interrupted = true;
          throw new Error('interrupted in the test');
        }
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
    answers(m, { enabled: true });
    expect(
      await runCli(
        ['setup', '--reconfigure', 'browser', '--non-interactive', '--answers', '/work/b.json'],
        m.deps,
      ),
    ).toBe(0);
    expect(keysDiffer(env(m), env(m, WORKER_ENV))).toBe(false);
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
    const app = { CAMOUFOX_MODE: 'grid', CAMOUFOX_BILLING_DAY: '15' };
    const text = renderWorkerEnv(
      'k'.repeat(48),
      readSharedSettings(app).settings,
      'CAMOUFOX_WORKER_PORT="8091"\nCAMOUFOX_MODE="list"\n# a note\n',
    );
    const w = parseEnv(text);
    expect(w).toMatchObject({
      CAMOUFOX_WORKER_KEY: 'k'.repeat(48),
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_BILLING_DAY: '15',
      CAMOUFOX_WORKER_PORT: '8091',
    });
    expect(
      settingsDiffer(
        app,
        Object.fromEntries(Object.entries(w).filter((e): e is [string, string] => e[1] !== undefined)),
      ),
    ).toEqual([]);
    expect(settingsDiffer(app, { CAMOUFOX_MODE: 'list' })).toEqual(['CAMOUFOX_MODE', 'CAMOUFOX_BILLING_DAY']);
  });
  it('withBrowserLines replaces in place, drops a duplicate, appends what is new and keeps every other line', () => {
    expect(
      withBrowserLines('A="1"\nCAMOUFOX_ENABLED="false"\nCAMOUFOX_ENABLED="x"\n', [
        ['CAMOUFOX_ENABLED', 'true'],
        ['CAMOUFOX_WORKER_URL', 'u'],
      ]),
    ).toBe('A="1"\nCAMOUFOX_ENABLED="true"\nCAMOUFOX_WORKER_URL="u"\n');
  });
  it('reads the camoufox provider-month pages from GET /api/providers', () => {
    const body = (usage: unknown) =>
      JSON.stringify({
        providers: [
          { providerId: 'searchapi', usage: [] },
          { providerId: 'camoufox', usage },
        ],
      });
    expect(pagesFromProviders(body([{ scope: 'provider-month:camoufox', calls: 12 }]))).toBe(12);
    expect(pagesFromProviders(body([{ scope: 'global-month', calls: 1 }]))).toBeNull();
    expect(pagesFromProviders(body('x'))).toBeNull();
    expect(pagesFromProviders('{')).toBeNull();
    expect(pagesFromProviders('{"providers":1}')).toBeNull();
  });
});
