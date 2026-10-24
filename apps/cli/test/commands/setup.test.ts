import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

const ENV = '/Users/op/.config/get-me-there/app.env';
const PASS = Buffer.alloc(24, 7).toString('base64url');
const show = (log: readonly Action[]) =>
  log.map((a) =>
    a.kind === 'run'
      ? `run ${a.describe}`
      : a.kind === 'waitHealthy'
        ? `wait ${a.url}`
        : `${a.kind} ${'path' in a ? a.path : ''}`,
  );
const answersFile = (m: ReturnType<typeof machine>, body: unknown) =>
  m.fs.file('/work/a.json', JSON.stringify(body), 0o600);

/** A machine that has been through one Enter-only setup. */
async function setUp(os: 'darwin' | 'linux' = 'darwin') {
  const m = machine({ os });
  answersFile(m, {});
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.io.stdout = '';
  return m;
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('setup must not call fetch');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setup on a clean machine (brief Task 16b.6)', () => {
  it('plans the directories, app.env, install and build, both services, the health wait and the first backup', async () => {
    const m = machine();
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'mkdir /Users/op/.config/get-me-there',
      'mkdir /Users/op/.local/share/get-me-there',
      'mkdir /Users/op/.local/share/get-me-there/backups',
      'mkdir /Users/op/.local/share/get-me-there/backups/daily',
      'mkdir /Users/op/.local/share/get-me-there/backups/update',
      'mkdir /Users/op/.local/state/get-me-there',
      'mkdir /Users/op/Library/Logs/get-me-there',
      'mkdir /Users/op/Library/LaunchAgents',
      `writeFile ${ENV}`,
      'writeFile /Users/op/.local/state/get-me-there/setup.json',
      'run pnpm install --frozen-lockfile',
      'run pnpm build',
      'writeFile /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'writeFile /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
      'wait http://127.0.0.1:3000/api/health',
      'writeFile /Users/op/.local/state/get-me-there/setup.json',
      'run launchctl kickstart gui/501/local.get-me-there.backup',
    ]);
    for (const a of m.executor.log)
      if (a.kind === 'mkdir') expect(a.mode).toBe(a.path.endsWith('LaunchAgents') ? 0o755 : 0o700);
    const env = m.executor.log.find((a) => a.kind === 'writeFile' && a.path === ENV);
    expect(env).toMatchObject({ mode: 0o600, secret: true });
    expect(parseEnv(m.fs.read(ENV) ?? '')).toEqual({
      NODE_ENV: 'production',
      DATABASE_PATH: '/Users/op/.local/share/get-me-there/get-me-there.db',
      BIND_ADDRESS: '127.0.0.1',
      PORT: '3000',
      SCHEDULER_TIMEZONE: 'Europe/London',
      POINT_OF_SALE: 'GB',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: PASS,
    });
    expect(PASS).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(m.executor.log.find((a) => a.kind === 'waitHealthy')).toMatchObject({ timeoutSeconds: 240 });
  });

  it('on Linux: units, daemon-reload, enable --now, the oneshot backup, and linger', async () => {
    const m = machine({ os: 'linux' });
    answersFile(m, { linger: 'enable', port: 3917 });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    const runs = show(m.executor.log).filter((s) => s.startsWith('run '));
    expect(runs).toEqual([
      'run pnpm install --frozen-lockfile',
      'run pnpm build',
      'run systemctl --user daemon-reload',
      'run systemctl --user enable --now get-me-there-app.service',
      'run systemctl --user daemon-reload',
      'run systemctl --user enable --now get-me-there-backup.timer',
      'run systemctl --user start get-me-there-backup.service',
      'run loginctl enable-linger op',
    ]);
    expect(show(m.executor.log)).toContain('wait http://127.0.0.1:3917/api/health');
  });

  it('a failed first backup still finishes, saying so with pnpm gmt backup as the fix', async () => {
    const m = machine({ backupWrites: false });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'The first daily backup did not complete; take one with `pnpm gmt backup`.',
    );
  });

  it('a failing step stops setup with the report, exit 1', async () => {
    const m = machine({ fail: (a) => a[0] === 'pnpm' && a[1] === 'build' });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('stopped at a failed step; nothing was undone');
    expect(m.io.stderr).toContain('failed:  run pnpm build');
    expect(m.executor.log.some((a) => a.kind === 'waitHealthy')).toBe(false);
  });

  it('every check runs before any action: an unmet prerequisite applies nothing', async () => {
    const m = machine({ extra: (a) => (a[0] === 'git' ? { code: 127 } : undefined) });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('git is not installed');
    expect(m.executor.log).toEqual([]);
  });

  it('a Node under a shim directory is refused before anything', async () => {
    const m = machine({ deps: { execPath: '/Users/op/.volta/bin/node' } });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('shim directory');
    expect(m.executor.log).toEqual([]);
  });

  it('a busy port 3000 makes the next free one the default', async () => {
    const m = machine({ deps: { portFree: async (p) => p !== 3000 } });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').PORT).toBe('3001');
  });
  it('an answered port that is busy is refused with the next free one', async () => {
    const m = machine({ deps: { portFree: async (p) => p !== 3917 } });
    answersFile(m, { port: 3917 });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('port 3917 is in use on 127.0.0.1');
    expect(m.io.stderr).toContain('choose 3918');
  });

  it('interactive: Enter through the prompts, the paste question before any action, then the browser offer', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '', '', false]);
    const m = machine({ ask, io: testIo({ tty: true }) });
    const asked: number[] = [];
    const orig = ask.secret;
    ask.secret = async (q) => {
      asked.push(m.executor.log.length);
      return orig(q);
    };
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(ask.asked.filter((q) => q.startsWith('Paste a token now?'))).toHaveLength(1);
    expect(asked.at(-1)).toBe(0);
    expect(ask.asked.at(-1)).toBe('Open the app in your browser now?');
  });

  it('a pasted token is written as TRAVELPAYOUTS_TOKEN and the closing screen has a source', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '', 'tp-token-0123456789', false]);
    const m = machine({ ask, io: testIo({ tty: true }) });
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').TRAVELPAYOUTS_TOKEN).toBe('tp-token-0123456789');
    expect(m.io.stdout).not.toContain('No price source is set up yet');
    expect(m.io.stdout).toContain('Next: open http://127.0.0.1:3000, choose Definitions and add a search');
  });
});

describe('the closing screen (brief §6)', () => {
  it('with no price source its first line says so and points at Travelpayouts; it names URL, user, file and password command, never the password', async () => {
    const m = machine();
    answersFile(m, {});
    await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps);
    const closing = m.io.stdout.slice(m.io.stdout.indexOf('No price source'));
    expect(closing.split('\n')[0]).toBe(
      'No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at https://www.travelpayouts.com/, then open the API token page (https://support.travelpayouts.com/hc/en-us/articles/203956083) and run `pnpm gmt setup --reconfigure travelpayouts`.',
    );
    for (const s of [
      'http://127.0.0.1:3000',
      'User name: operator',
      `The password is in ${ENV}; show it with \`pnpm gmt password\` (if scrollback or a shared screen may have kept it, \`pnpm gmt setup --reconfigure password\` replaces it).`,
      'Only if you want to reach it from another device: an SSH tunnel (ssh -L 3000:127.0.0.1:3000 <this machine>)',
      'docs/setup.md section 3',
      'plain HTTP',
      'Scheduled searches run while this machine is awake; a missed one is caught up once when it wakes, without the browser provider.',
      'Next: open http://127.0.0.1:3000, choose Definitions and add a search with your airports and dates',
      'Nothing runs on a schedule until you give a search one',
    ])
      expect(closing).toContain(s);
    expect(m.io.stdout).not.toContain(PASS);
  });
});

describe('a second setup (spec §16: the first failing test)', () => {
  it('over an app.env whose PORT differs from the plan’s reports the difference and plans no writeFile for it', async () => {
    const m = await setUp();
    answersFile(m, { port: 3917 });
    const before = m.fs.read(ENV);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('app.env differs from what setup would write: PORT');
    expect(m.io.stdout).toContain('pnpm gmt setup --reconfigure port');
    expect(m.executor.log.filter((a) => a.kind === 'writeFile' && a.path === ENV)).toEqual([]);
    expect(m.fs.read(ENV)).toBe(before);
    expect(show(m.executor.log)).toContain('wait http://127.0.0.1:3000/api/health');
  });

  it('a re-run on a fully set-up machine plans nothing but waitHealthy', async () => {
    const m = await setUp();
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual(['wait http://127.0.0.1:3000/api/health']);
    const l = await setUp('linux');
    expect(await runCli(['setup'], l.deps)).toBe(0);
    expect(show(l.executor.log)).toEqual(['wait http://127.0.0.1:3000/api/health']);
  });

  it('a re-run with a stopped app starts it', async () => {
    const m = await setUp();
    m.running.clear();
    await runCli(['setup'], m.deps);
    expect(show(m.executor.log)).toEqual([
      'run launchctl kickstart gui/501/local.get-me-there.app',
      'wait http://127.0.0.1:3000/api/health',
    ]);
  });

  it('--dry-run prints the plan with the literal launchctl commands and applies nothing', async () => {
    const m = machine();
    answersFile(m, {});
    expect(
      await runCli(['setup', '--dry-run', '--non-interactive', '--answers', '/work/a.json'], m.deps),
    ).toBe(0);
    expect(m.executor.log).toEqual([]);
    expect(m.io.stdout).toContain(
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
    expect(m.io.stdout).toContain(`write ${ENV} (0600, 10 lines, values hidden)`);
    expect(m.io.stdout).toContain('then: run launchctl kickstart gui/501/local.get-me-there.backup');
    expect(m.io.stdout).not.toContain(PASS);
  });
});

describe('--reconfigure <group>', () => {
  it('port replaces only that line, keeps lines it does not own, and restarts the app', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}LOG_LEVEL=debug\n`, 0o600);
    const before = (m.fs.read(ENV) ?? '').split('\n');
    m.deps.ask = scriptedAsk(['3917']);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'port'], m.deps)).toBe(0);
    const after = (m.fs.read(ENV) ?? '').split('\n');
    expect(after.filter((l) => !before.includes(l))).toEqual(['PORT="3917"']);
    expect(before.filter((l) => !after.includes(l))).toEqual(['PORT="3000"']);
    expect(show(m.executor.log)).toEqual([
      `writeFile ${ENV}`,
      'run launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'wait http://127.0.0.1:3917/api/health',
    ]);
  });

  it.each([
    ['timezone', ['America/New_York'], ['SCHEDULER_TIMEZONE']],
    ['travelpayouts', ['tp-token-0123456789'], ['TRAVELPAYOUTS_TOKEN']],
    [
      'searchapi',
      ['40usd', 'sa-key-0123456789', '5'],
      ['SEARCHAPI_KEY', 'SEARCHAPI_PLAN', 'SEARCHAPI_BILLING_DAY'],
    ],
    [
      'email',
      [true, 'smtp.example.com', '', '', 'me', 'smtp-pass-0123', 'me@example.com', 'gmt@example.com'],
      ['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'SMTP_PASS', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM'],
    ],
    ['password', [], ['APP_BASIC_AUTH_PASS']],
  ] as const)('%s touches only its lines', async (group, answers, names) => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}LOG_LEVEL=debug\n`, 0o600);
    const before = parseEnv(m.fs.read(ENV) ?? '');
    m.deps.ask = scriptedAsk([...answers]);
    m.deps.io = testIo({ tty: true });
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    expect(await runCli(['setup', '--reconfigure', group], m.deps)).toBe(0);
    const after = parseEnv(m.fs.read(ENV) ?? '');
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k])
      .sort();
    expect(changed).toEqual([...names].sort());
    expect(after.LOG_LEVEL).toBe('debug');
    expect(show(m.executor.log)).toContain(
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
    expect(m.io.stdout).not.toContain(after.APP_BASIC_AUTH_PASS ?? 'none');
  });

  it('refuses before a first setup', async () => {
    const m = machine();
    expect(await runCli(['setup', '--reconfigure', 'port'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('run pnpm gmt setup first');
  });

  const ACTIVE = {
    execution: {
      id: 'e1',
      definitionId: 'd1',
      definitionName: 'London to New York weekly',
      kind: 'run',
      startedAt: '2026-10-24T09:00:00.000Z',
      estimatedFinishAt: '2026-10-24T10:15:00.000Z',
    },
  };
  it('browser refuses while a run is active, naming it', async () => {
    const m = await setUp();
    m.deps.http = stubHttp({ 'GET /api/executions/active': () => ({ status: 200, body: ACTIVE }) });
    m.deps.ask = scriptedAsk([]);
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('a search is running in the app: London to New York weekly');
    expect(m.io.stderr).toContain('estimated to finish 2026-10-24T10:15:00.000Z');
    expect(m.executor.log).toEqual([]);
  });
  it('browser --force states the interruption first, asks row 9 with the current value, writes only CAMOUFOX_BROWSER_WINDOW and restarts the app only', async () => {
    const m = await setUp();
    const http = stubHttp({ 'GET /api/executions/active': () => ({ status: 200, body: ACTIVE }) });
    m.deps.http = http;
    m.deps.ask = scriptedAsk([true]);
    const io = testIo({ tty: true });
    m.deps.io = io;
    const before = parseEnv(m.fs.read(ENV) ?? '');
    expect(await runCli(['setup', '--reconfigure', 'browser', '--force'], m.deps)).toBe(0);
    expect(io.stdout).toContain('a search is running in the app: London to New York weekly');
    expect(io.stdout).toContain('Going ahead anyway (--force): the app stops within 30 s');
    expect(io.stdout).toContain('The new value applies when the run resumes.');
    expect(io.stdout.indexOf('Going ahead anyway')).toBeLessThan(io.stdout.indexOf('written'));
    const after = parseEnv(m.fs.read(ENV) ?? '');
    expect(after).toEqual({ ...before, CAMOUFOX_BROWSER_WINDOW: 'any' });
    expect(show(m.executor.log).filter((s) => s.startsWith('run '))).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.app',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    ]);
    expect(http.requests[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`operator:${PASS}`).toString('base64')}`,
    );
  });
  it('browser with no run active asks and writes scheduled for no', async () => {
    const m = await setUp();
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    });
    m.deps.ask = scriptedAsk([false]);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_BROWSER_WINDOW).toBe('scheduled');
  });
});

describe('password', () => {
  it('prints the password to a terminal only, read with parseEnv; refuses a pipe and a missing app.env (CodeRabbit …k7n)', async () => {
    const m = await setUp();
    const tty = testIo({ tty: true });
    m.deps.io = tty;
    expect(await runCli(['password'], m.deps)).toBe(0);
    expect(tty.stdout).toBe(`${PASS}\n`);
    const pipe = testIo({ tty: false });
    m.deps.io = pipe;
    expect(await runCli(['password'], m.deps)).toBe(78);
    expect(pipe.stdout).toBe('');
    expect(pipe.stderr).toContain('prints only to a terminal');
    const none = machine({ io: testIo({ tty: true }) });
    expect(await runCli(['password'], none.deps)).toBe(78);
  });
});

describe('no secret reaches any output (spec §9 item 9, sentinel secrets)', () => {
  it('a full run with every secret set leaks none into stdout, stderr, plan text or rendered services, raw or base64url', async () => {
    const secrets = {
      tp: 'SENTINEL-tp-Zx81Lq0w',
      sa: 'SENTINEL-sa-Pq73Ns2k',
      smtp: 'SENTINEL-smtp-Rt55Jm',
    };
    const m = machine({ deps: { secretEnv: (n) => (n === 'SMTP_P' ? secrets.smtp : undefined) } });
    answersFile(m, {
      travelpayouts: { token: secrets.tp },
      searchApi: { plan: '40usd', key: secrets.sa },
      email: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'implicit',
        user: 'u',
        pass: { fromEnv: 'SMTP_P' },
        to: 'a@example.com',
        from: 'b@example.com',
      },
    });
    expect(
      await runCli(['setup', '--dry-run', '--non-interactive', '--answers', '/work/a.json'], m.deps),
    ).toBe(0);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    const outputs = [
      m.io.stdout,
      m.io.stderr,
      ...m.executor.log.filter((a) => !(a.kind === 'writeFile' && a.secret)).map((a) => JSON.stringify(a)),
      ...m.runner.calls.map((c) => JSON.stringify(c.argv)),
    ];
    const pass = parseEnv(m.fs.read(ENV) ?? '').APP_BASIC_AUTH_PASS ?? 'missing';
    for (const s of [...Object.values(secrets), pass])
      for (const o of outputs) {
        expect(o).not.toContain(s);
        expect(o).not.toContain(Buffer.from(s).toString('base64url'));
      }
  });
});
