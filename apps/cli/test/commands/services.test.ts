import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { scriptedAsk, testIo } from '../support/deps.js';
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
  it('darwin: stop boots out the app and the job; start bootstraps them; restart kickstarts -k the app', async () => {
    const m = await setUp();
    expect(await runCli(['stop'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'launchctl bootout gui/501/local.get-me-there.backup',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['start'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['restart'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual(['launchctl kickstart -k gui/501/local.get-me-there.app']);
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
  it('refuses a source failing integrity_check before moving anything', async () => {
    const m = await setUp('darwin', {
      extra: (a) =>
        String(a[1]).endsWith('check-backup.mjs') && a[2] === '/b/bad.db' ? { code: 74 } : undefined,
    });
    m.running.clear();
    m.fs.file('/b/bad.db', 'garbage').file(DB, 'current', 0o600);
    expect(await runCli(['restore', '/b/bad.db'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('fails PRAGMA integrity_check');
    expect(m.executor.log).toEqual([]);
    expect(m.fs.read(DB)).toBe('current');
  });
  it('removes -wal and -shm, keeps the current file as .before-restore, puts the backup in place 0600, and says to check the dashboards', async () => {
    const m = await setUp('darwin', {
      extra: (a) => (a[0] === 'git' && a[1] === 'symbolic-ref' ? { code: 1 } : undefined),
    });
    m.running.clear();
    m.fs.file('/b/x.db', 'backup').file(DB, 'current', 0o600).file(`${DB}-wal`, 'w').file(`${DB}-shm`, 's');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.fs.read(DB)).toBe('backup');
    expect(m.fs.mode(DB)).toBe(0o600);
    expect(m.fs.read(`${DB}.before-restore`)).toBe('current');
    expect(m.fs.read(`${DB}-wal`)).toBeNull();
    expect(m.fs.read(`${DB}-shm`)).toBeNull();
    expect(m.io.stdout).toContain('check each vendor’s dashboard');
    expect(m.io.stdout).toContain('git switch main');
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
    expect(naming.map((f) => f.slice(src.length + 1))).toEqual(['commands/smoke.ts']);
    const wf = join(import.meta.dirname, '..', '..', '..', '..', '.github', 'workflows');
    for (const f of readdirSync(wf)) expect(readFileSync(join(wf, f), 'utf8')).not.toMatch(/gmt smoke/);
  });
  it('setup, update and status never call it (scripted runs record no such request)', async () => {
    const m = await setUp();
    m.deps.ask = scriptedAsk([]);
    await runCli(['status'], m.deps);
    await runCli(['setup'], m.deps);
    expect(m.io.stderr).not.toContain('smoke');
    m.deps.io = testIo();
  });
});
