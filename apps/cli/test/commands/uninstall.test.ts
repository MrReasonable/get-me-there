import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { purgeRefusal, uninstallPaths } from '../../src/commands/uninstall.js';
import { scriptedAsk, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

async function setUp(os: 'darwin' | 'linux' = 'darwin', linger: 'skip' | 'enable' = 'skip') {
  const m = machine({ os });
  m.fs.file('/work/a.json', JSON.stringify({ linger }), 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.io.stdout = '';
  return m;
}
const show = (m: ReturnType<typeof machine>) =>
  m.executor.log.map((a) => (a.kind === 'run' ? a.describe : `${a.kind} ${'path' in a ? a.path : ''}`));

describe('gmt uninstall (spec §13)', () => {
  it('darwin: boots out and removes both agents, removes the log files, keeps and prints config, data and state', async () => {
    const m = await setUp();
    m.fs.file('/Users/op/Library/Logs/get-me-there/app.log', 'x');
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(0);
    expect(show(m)).toEqual([
      'launchctl bootout gui/501/local.get-me-there.app',
      'remove /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'launchctl bootout gui/501/local.get-me-there.backup',
      'remove /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
      'remove /Users/op/Library/Logs/get-me-there',
    ]);
    const p = uninstallPaths(m.deps.platform);
    for (const r of p.removed) expect(m.io.stdout).toContain(`removed: ${r}`);
    for (const k of p.kept) {
      expect(m.io.stdout).toContain(`kept: ${k}`);
      expect(m.fs.isDir(k)).toBe(true);
    }
    for (const r of p.removed) expect(m.fs.mode(r)).toBeNull();
  });
  it('linux: stop, disable, delete, daemon-reload and reset-failed; offers to disable the linger setup enabled', async () => {
    const m = await setUp('linux', 'enable');
    m.deps.ask = scriptedAsk([true]);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    const s = show(m);
    for (const c of [
      'systemctl --user stop get-me-there-app.service',
      'systemctl --user disable get-me-there-app.service',
      'systemctl --user daemon-reload',
      'systemctl --user reset-failed',
      'loginctl disable-linger op',
    ])
      expect(s).toContain(c);
    expect(s).toContain('remove /home/op/.config/systemd/user/get-me-there-backup.timer');
  });
  it('linger setup did not enable is never offered; --non-interactive never offers it', async () => {
    const m = await setUp('linux', 'skip');
    m.deps.ask = scriptedAsk([]);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    const n = await setUp('linux', 'enable');
    n.deps.ask = scriptedAsk([]);
    expect(await runCli(['uninstall', '--non-interactive'], n.deps)).toBe(0);
    expect(show(n)).not.toContain('loginctl disable-linger op');
  });

  it('--purge lists the three directories, needs the typed word purge, and deletes them', async () => {
    const m = await setUp();
    m.deps.ask = scriptedAsk(['purge']);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(0);
    for (const d of [
      '/Users/op/.config/get-me-there',
      '/Users/op/.local/share/get-me-there',
      '/Users/op/.local/state/get-me-there',
    ])
      expect(m.fs.isDir(d)).toBe(false);
    const n = await setUp();
    n.deps.ask = scriptedAsk(['Purge']);
    n.deps.io = testIo({ tty: true });
    expect(await runCli(['uninstall', '--purge'], n.deps)).toBe(78);
    expect(n.fs.isDir('/Users/op/.config/get-me-there')).toBe(true);
  });
  it('--purge refuses --non-interactive and a symlinked directory, deleting nothing', async () => {
    const m = await setUp();
    expect(await runCli(['uninstall', '--purge', '--non-interactive'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('--purge never runs non-interactively');
    expect(m.fs.isDir('/Users/op/.config/get-me-there')).toBe(true);
    const s = await setUp();
    s.fs.delete('/Users/op/.config/get-me-there');
    s.fs.dir('/Users/op/Documents').symlink('/Users/op/.config/get-me-there', '/Users/op/Documents');
    s.deps.ask = scriptedAsk([]);
    const io = testIo({ tty: true });
    s.deps.io = io;
    expect(await runCli(['uninstall', '--purge'], s.deps)).toBe(78);
    expect(io.stderr).toContain('/Users/op/.config/get-me-there is a symbolic link');
    expect(s.fs.isDir('/Users/op/Documents')).toBe(true);
    expect(s.fs.isDir('/Users/op/.local/share/get-me-there')).toBe(true);
  });
  it.each([
    ['/Users/op', 'is your home directory'],
    ['/', 'is the root directory'],
    ['/Users/op/.config/other', 'is not named get-me-there'],
  ])('purgeRefusal refuses %s (%s)', (path, why) => {
    const m = machine();
    m.fs.dir(path);
    expect(purgeRefusal(path, '/Users/op', m.fs)).toContain(why);
  });
  it('purgeRefusal accepts the real directories', () => {
    const m = machine();
    m.fs.dir('/Users/op/.config/get-me-there');
    expect(purgeRefusal('/Users/op/.config/get-me-there', '/Users/op', m.fs)).toBeNull();
  });
});
