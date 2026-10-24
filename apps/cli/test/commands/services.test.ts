import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { scriptedAsk } from '../support/deps.js';
import { machine } from '../support/machine.js';

const show = (log: readonly Action[]) =>
  log.map((a) => (a.kind === 'run' ? a.describe : `${a.kind} ${'path' in a ? a.path : ''}`));
async function setUp(os: 'darwin' | 'linux' = 'darwin', extra?: Parameters<typeof machine>[0]) {
  const m = machine({ os, ...extra });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  return m;
}

describe('start, stop, restart (each service the setup installed)', () => {
  it('darwin: stop boots out the app and the job; start bootstraps them; restart boots the app out and in', async () => {
    const m = await setUp();
    expect(await runCli(['stop'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      'launchctl bootout gui/501/local.get-me-there.backup',
      'waitGone ',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['start'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['restart'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    ]);
  });
  it('linux: stop and start act on the app and the job’s timer, never running the job', async () => {
    const m = await setUp('linux');
    expect(await runCli(['stop'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'systemctl --user stop get-me-there-app.service',
      'systemctl --user stop get-me-there-backup.timer',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['start'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'systemctl --user start get-me-there-app.service',
      'systemctl --user start get-me-there-backup.timer',
    ]);
  });
  it('start refuses a settings file readable by others, naming the chmod; --dry-run applies nothing', async () => {
    const m = await setUp();
    m.fs.file(
      '/Users/op/.config/get-me-there/app.env',
      m.fs.read('/Users/op/.config/get-me-there/app.env') ?? '',
      0o644,
    );
    expect(await runCli(['start'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('chmod 600 /Users/op/.config/get-me-there/app.env');
    m.fs.file(
      '/Users/op/.config/get-me-there/app.env',
      m.fs.read('/Users/op/.config/get-me-there/app.env') ?? '',
      0o600,
    );
    m.running.clear();
    expect(await runCli(['start', '--dry-run'], m.deps)).toBe(0);
    expect(m.executor.log).toEqual([]);
    expect(m.io.stdout).toContain('launchctl kickstart gui/501/local.get-me-there.app');
  });
  it('start refuses a unit whose Node binary is gone, with pnpm gmt setup as the fix', async () => {
    const m = await setUp();
    m.deps.execPath = '/opt/other/bin/node';
    m.fs.delete('/opt/node/bin/node');
    expect(await runCli(['start'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('/opt/node/bin/node');
    expect(m.io.stderr).toContain('pnpm gmt setup');
  });
  it('nothing installed refuses with pnpm gmt setup', async () => {
    const m = machine();
    expect(await runCli(['start'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('pnpm gmt setup');
  });
});

describe('logs and backup', () => {
  it('darwin logs runs tail -n 200 -F on the log files as an argv', async () => {
    const m = await setUp();
    m.fs
      .file('/Users/op/Library/Logs/get-me-there/app.log', 'x')
      .file('/Users/op/Library/Logs/get-me-there/backup.log', 'y');
    const attached: string[][] = [];
    m.deps.attach = async (argv) => {
      attached.push([...argv]);
      return 0;
    };
    expect(await runCli(['logs'], m.deps)).toBe(0);
    expect(attached).toEqual([
      [
        'tail',
        '-n',
        '200',
        '-F',
        '/Users/op/Library/Logs/get-me-there/app.log',
        '/Users/op/Library/Logs/get-me-there/backup.log',
      ],
    ]);
  });
  it('linux logs runs journalctl, with the group hint when the journal shows nothing', async () => {
    const m = await setUp('linux', {
      extra: (a) => (a[0] === 'journalctl' ? { code: 0, stdout: '-- No entries --\n' } : undefined),
    });
    const attached: string[][] = [];
    m.deps.attach = async (argv) => {
      attached.push([...argv]);
      return 0;
    };
    expect(await runCli(['logs'], m.deps)).toBe(0);
    expect(attached).toEqual([['journalctl', '--user', '-u', 'get-me-there-app', '-n', '200', '-f']]);
    expect(m.io.stdout).toContain('systemd-journal');
  });
  it('backup runs the job once: kickstart on darwin, systemctl --user start on linux, naming the new file', async () => {
    const m = await setUp();
    expect(await runCli(['backup'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual(['launchctl kickstart gui/501/local.get-me-there.backup']);
    expect(m.io.stdout).toContain('backup written: /Users/op/.local/share/get-me-there/backups/daily/');
    const l = await setUp('linux');
    expect(await runCli(['backup'], l.deps)).toBe(0);
    expect(show(l.executor.log)).toEqual(['systemctl --user start get-me-there-backup.service']);
  });
  it('after pnpm gmt stop on darwin the job is not loaded: the job’s own command runs directly, naming the file (dev-b1-010)', async () => {
    const m = await setUp();
    expect(await runCli(['stop', '--force'], m.deps)).toBe(0);
    m.executor.log.length = 0;
    m.runner.calls.length = 0;
    expect(await runCli(['backup'], m.deps)).toBe(0);
    const ran = m.executor.log.filter((a) => a.kind === 'run').map((a) => (a.kind === 'run' ? a.argv : []));
    expect(ran).toHaveLength(1);
    expect(ran[0]).toEqual(
      expect.arrayContaining(['--dir', '/Users/op/.local/share/get-me-there/backups/daily', '--keep', '14']),
    );
    expect(show(m.executor.log).some((x) => x.startsWith('launchctl'))).toBe(false);
    expect(m.io.stdout).toContain('backup written: /Users/op/.local/share/get-me-there/backups/daily/');
  });
  it('a backup that writes nothing fails with exit 1', async () => {
    const m = await setUp('darwin', { backupWrites: false });
    expect(await runCli(['backup'], m.deps)).toBe(1);
  });
});

describe('restore <file> (spec §13 Restore (native))', () => {
  const DB = '/Users/op/.local/share/get-me-there/get-me-there.db';
  it('requires the app stopped', async () => {
    const m = await setUp();
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('pnpm gmt stop');
    expect(m.executor.log).toEqual([]);
  });
  it('refuses a copy failing integrity_check before moving anything, and removes the copy', async () => {
    const m = await setUp('darwin', {
      extra: (a) =>
        String(a[1]).endsWith('check-backup.mjs') && a[2] === `${DB}.importing` ? { code: 74 } : undefined,
    });
    m.running.clear();
    m.fs.file('/b/bad.db', 'garbage').file(DB, 'current', 0o600);
    expect(await runCli(['restore', '/b/bad.db'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('fails PRAGMA integrity_check; nothing was changed');
    expect(m.fs.read(DB)).toBe('current');
    expect(m.fs.read(`${DB}.importing`)).toBeNull();
    expect(m.executor.log.some((a) => a.kind === 'rename')).toBe(false);
  });
  it('keeps the current file with its -wal and -shm under a timestamped name, puts the backup in place 0600, and says to check the dashboards (U8)', async () => {
    const m = await setUp('darwin', {
      extra: (a) => (a[0] === 'git' && a[1] === 'symbolic-ref' ? { code: 1 } : undefined),
    });
    m.running.clear();
    m.fs.file('/b/x.db', 'backup').file(DB, 'current', 0o600).file(`${DB}-wal`, 'w').file(`${DB}-shm`, 's');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    const kept = `${DB}.before-restore-2026-10-24T09-30-00-000Z`;
    expect(m.fs.read(DB)).toBe('backup');
    expect(m.fs.mode(DB)).toBe(0o600);
    expect(m.fs.read(kept)).toBe('current');
    expect(m.fs.read(`${kept}-wal`)).toBe('w');
    expect(m.fs.read(`${kept}-shm`)).toBe('s');
    expect(m.fs.read(`${DB}-wal`)).toBeNull();
    expect(m.fs.read(`${DB}-shm`)).toBeNull();
    // why: the check runs on the 0600 copy, through the one placement code (ca-b1-010)
    expect(
      m.runner.calls.some(
        (c) => String(c.argv[1]).endsWith('check-backup.mjs') && c.argv[2] === `${DB}.importing`,
      ),
    ).toBe(true);
    expect(m.io.stdout).toContain(`the previous file is ${kept}`);
    expect(m.io.stdout).toContain('check each vendor’s dashboard');
    expect(m.io.stdout).toContain('git switch main');
  });
  it('a second restore keeps both earlier files (CodeRabbit …k7U, sec-b1-007)', async () => {
    const m = await setUp();
    m.running.clear();
    m.fs.file('/b/x.db', 'backup').file(DB, 'first', 0o600);
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    m.deps.now = () => new Date('2026-10-24T09:31:00.000Z');
    m.fs.file(DB, 'second', 0o600);
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.fs.read(`${DB}.before-restore-2026-10-24T09-30-00-000Z`)).toBe('first');
    expect(m.fs.read(`${DB}.before-restore-2026-10-24T09-31-00-000Z`)).toBe('second');
  });
  it.each([
    ['trial', 'raise SEARCHAPI_TRIAL_USED'],
    ['40usd', 'lower SEARCHAPI_MONTHLY_CALL_CAP'],
  ])('the dashboard advice fits the SearchApi plan (%s; cb-b1-010)', async (plan, text) => {
    const m = await setUp();
    m.running.clear();
    const env = '/Users/op/.config/get-me-there/app.env';
    m.fs.file(env, `${m.fs.read(env) ?? ''}SEARCHAPI_PLAN=${plan}\n`, 0o600);
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(text);
  });
  it('names the runs a start would resume and the scheduled searches it may catch up (cb-b1-010)', async () => {
    const m = await setUp('darwin', {
      extra: (a) =>
        String(a[1]).endsWith('check-backup.mjs')
          ? { code: 0, stdout: `${JSON.stringify({ ok: true, file: a[2], resumable: 1, scheduled: 2 })}\n` }
          : undefined,
    });
    m.running.clear();
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('Starting the app resumes 1 unfinished run from this database');
    expect(m.io.stdout).toContain('AUTO_RESUME=false');
    expect(m.io.stdout).toContain('2 scheduled searches may each catch up their latest missed firing once');
  });
});

describe('the smoke is never run by setup, update, status or CI', () => {
  it('only commands/smoke.ts names the smoke route, and no workflow runs gmt smoke', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const src = join(import.meta.dirname, '..', '..', 'src');
    const naming = walk(src).filter((f) => readFileSync(f, 'utf8').includes('/api/tools/smoke'));
    expect(naming.map((f) => f.slice(src.length + 1).replaceAll('\\', '/'))).toEqual(['commands/smoke.ts']);
    // why: found upwards, so the mutation run's sandbox copy (nested under the package) reads the real workflows
    const { existsSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    let root = import.meta.dirname;
    while (!existsSync(join(root, 'pnpm-workspace.yaml')) && root !== dirname(root)) root = dirname(root);
    const wf = join(root, '.github', 'workflows');
    expect(readdirSync(wf).length).toBeGreaterThan(0);
    for (const f of readdirSync(wf)) expect(readFileSync(join(wf, f), 'utf8')).not.toMatch(/gmt smoke/);
  });
  it('setup, update and status never call it: no recorded request names the smoke route (CodeRabbit …k7m)', async () => {
    const { stubHttp } = await import('../support/deps.js');
    const http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
      'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
    });
    const m = await setUp('darwin', {
      http,
      extra: (a) =>
        a[0] === 'git'
          ? a[1] === 'symbolic-ref'
            ? { code: 0, stdout: 'main\n' }
            : a[1] === 'rev-parse'
              ? { code: 0, stdout: 'same\n' }
              : { code: 0, stdout: '' }
          : undefined,
    });
    m.deps.ask = scriptedAsk([]);
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(await runCli(['update'], m.deps)).toBe(0);
    expect(http.requests.length).toBeGreaterThan(0);
    expect(http.requests.filter((r) => r.url.includes('/api/tools/smoke'))).toEqual([]);
  });
});

describe('stop and restart ask the app first (U1, cb-b1-008)', () => {
  const ACTIVE = {
    execution: {
      id: 'e',
      definitionId: 'd',
      definitionName: 'London to New York weekly',
      kind: 'run',
      startedAt: '2026-10-24T09:00:00.000Z',
      estimatedFinishAt: null,
    },
  };
  it.each(['stop', 'restart'])(
    '%s refuses while a run is active (75), and --force says what it interrupts first',
    async (cmd) => {
      const { stubHttp } = await import('../support/deps.js');
      const m = await setUp();
      m.deps.http = stubHttp({ 'GET /api/executions/active': () => ({ status: 200, body: ACTIVE }) });
      expect(await runCli([cmd], m.deps)).toBe(75);
      expect(m.io.stderr).toContain('a search is running in the app: London to New York weekly');
      expect(m.executor.log).toEqual([]);
      expect(await runCli([cmd, '--force'], m.deps)).toBe(0);
      expect(m.io.stdout).toContain('Going ahead anyway (--force)');
      expect(m.executor.log.length).toBeGreaterThan(0);
    },
  );
});
