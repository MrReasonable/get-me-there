import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { purgeRefusal } from '../../src/commands/uninstall.js';
import type { RunHandler } from '../../src/exec/memory.js';
import { scriptedAsk, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

// why: Ian's ruling on PR #11 (survivors before merge): what uninstall removes, keeps and prints, its refusals, and the
// linger lines the operator follows, asserted as behaviour.
async function setUp(
  os: 'darwin' | 'linux' = 'darwin',
  linger: 'skip' | 'enable' = 'skip',
  extra?: RunHandler,
) {
  let started = false;
  const m = machine({ os, extra: (a, c) => (started ? extra?.(a, c) : undefined) });
  m.fs.file('/work/a.json', JSON.stringify({ linger }), 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return m;
}
const tty = (m: Awaited<ReturnType<typeof setUp>>, answers: Array<string | boolean>) => {
  const ask = scriptedAsk(answers);
  const io = testIo({ tty: true });
  m.deps.ask = ask;
  m.deps.io = io;
  return { ask, io };
};

describe('uninstall: what it prints (survivors, PR #11)', () => {
  it('darwin: every removed and kept path, one a line, exactly', async () => {
    const m = await setUp();
    m.fs.file('/Users/op/Library/Logs/get-me-there/app.log', 'x');
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(0);
    expect(m.io.stdout).toBe(
      [
        'removed: /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
        'removed: /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
        'removed: /Users/op/Library/Logs/get-me-there',
        'kept: /Users/op/.config/get-me-there',
        'kept: /Users/op/.local/share/get-me-there',
        'kept: /Users/op/.local/state/get-me-there',
        '',
      ].join('\n'),
    );
    const logs = m.executor.log.find(
      (a) => a.kind === 'remove' && a.path === '/Users/op/Library/Logs/get-me-there',
    );
    expect(logs).toEqual({ kind: 'remove', path: '/Users/op/Library/Logs/get-me-there', recursive: true });
  });
  it('linux: the three unit files, no log directory', async () => {
    const m = await setUp('linux');
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(0);
    expect(m.io.stdout.split('\n').filter((l) => l.startsWith('removed: '))).toEqual([
      'removed: /home/op/.config/systemd/user/get-me-there-app.service',
      'removed: /home/op/.config/systemd/user/get-me-there-backup.service',
      'removed: /home/op/.config/systemd/user/get-me-there-backup.timer',
    ]);
  });
  it('darwin without a log directory plans no removal for it', async () => {
    const m = await setUp();
    m.fs.delete('/Users/op/Library/Logs/get-me-there');
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(0);
    expect(m.executor.log.some((a) => a.kind === 'remove' && a.path.includes('/Library/Logs/'))).toBe(false);
  });
  it('--dry-run prints the plan and removes nothing', async () => {
    const m = await setUp();
    expect(await runCli(['uninstall', '--dry-run'], m.deps)).toBe(0);
    expect(m.io.stdout.split('\n')[0]).toBe('uninstall:');
    expect(m.executor.log).toEqual([]);
    expect(m.fs.read('/Users/op/Library/LaunchAgents/local.get-me-there.app.plist')).not.toBeNull();
  });
  it('a failed step reports it and exits 1, printing no removed list', async () => {
    const m = await setUp('darwin', 'skip', (a) =>
      a[0] === 'launchctl' && a[1] === 'bootout' ? { code: 5 } : undefined,
    );
    expect(await runCli(['uninstall', '--non-interactive'], m.deps)).toBe(1);
    expect(m.io.stderr.startsWith('uninstall: stopped at a failed step; nothing was undone\n')).toBe(true);
    expect(m.io.stdout).not.toContain('removed:');
  });
});

describe('uninstall --purge (survivors, PR #11)', () => {
  it('lists the directories exactly before asking; a wrong word removes nothing and says so', async () => {
    const m = await setUp();
    const { io } = tty(m, ['Purge']);
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(78);
    expect(io.stdout).toBe(
      '--purge deletes these directories and everything in them:\n  /Users/op/.config/get-me-there\n  /Users/op/.local/share/get-me-there\n  /Users/op/.local/state/get-me-there\n',
    );
    expect(io.stderr).toBe('not purged; nothing was removed\n');
    expect(m.executor.log).toEqual([]);
  });
  it('removes each directory that exists, whole; one already gone is not planned', async () => {
    const m = await setUp();
    m.fs.delete('/Users/op/.local/share/get-me-there');
    tty(m, ['purge']);
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(0);
    const removes = m.executor.log.filter((a) => a.kind === 'remove' && a.path.includes('/.'));
    expect(removes).toEqual([
      { kind: 'remove', path: '/Users/op/.config/get-me-there', recursive: true },
      { kind: 'remove', path: '/Users/op/.local/state/get-me-there', recursive: true },
    ]);
  });
  it('two refusals are named together, nothing deleted', async () => {
    const m = await setUp();
    for (const d of ['/Users/op/.config/get-me-there', '/Users/op/.local/share/get-me-there']) {
      m.fs.delete(d);
      m.fs.dir('/Users/op/elsewhere').symlink(d, '/Users/op/elsewhere');
    }
    const { io } = tty(m, []);
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(78);
    expect(io.stderr).toBe(
      '--purge refused, nothing was deleted: /Users/op/.config/get-me-there is a symbolic link; /Users/op/.local/share/get-me-there is a symbolic link\n',
    );
  });
  it('the home is refused with or without its trailing slash', () => {
    const m = machine();
    expect(purgeRefusal('/Users/op', '/Users/op/', m.fs)).toBe('/Users/op is your home directory');
    expect(purgeRefusal('/Users/op', '/Users/op', m.fs)).toBe('/Users/op is your home directory');
  });
  it('on the default layout the worker’s directory goes with the state, and nothing is said to be left', async () => {
    const m = await setUp('linux');
    m.fs.dir('/home/op/.local/state/get-me-there/camoufox');
    const { io } = tty(m, ['purge']);
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(0);
    expect(io.stdout).toContain('removed: /home/op/.local/state/get-me-there');
    expect(io.stdout).not.toContain('left in place');
  });
  it('with the state moved and no worker directory, nothing is said to be left', async () => {
    const { currentPlatform } = await import('../../src/platform/current.js');
    const m = await setUp('linux');
    m.deps.platform = currentPlatform({
      platform: 'linux',
      arch: 'x64',
      uid: 501,
      env: { HOME: '/home/op', XDG_STATE_HOME: '/home/op/st' },
    });
    m.fs.dir('/home/op/st/get-me-there');
    m.fs.delete('/home/op/.local/state/get-me-there');
    const { io } = tty(m, ['purge']);
    expect(await runCli(['uninstall', '--purge'], m.deps)).toBe(0);
    expect(io.stdout).not.toContain('left in place');
  });
});

describe('uninstall and linger (survivors, PR #11)', () => {
  it('on macOS a recorded linger is never offered: linger is Linux only', async () => {
    const m = await setUp('darwin');
    m.fs.file(
      '/Users/op/.local/state/get-me-there/setup.json',
      JSON.stringify({ linger: 'enable', installed: true, import: null, moved: false }),
    );
    const { ask, io } = tty(m, []);
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    expect(ask.asked).toEqual([]);
    expect(io.stdout).not.toContain('linger');
  });
  it('Enter keeps linger on and prints how to turn it off later', async () => {
    const m = await setUp('linux', 'enable');
    const { io } = tty(m, ['']);
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    expect(io.stdout).toContain('Linger stays on; to turn it off later: loginctl disable-linger op\n');
    expect(m.runner.calls.some((c) => c.argv.join(' ') === 'loginctl disable-linger op')).toBe(false);
  });
  it('a refused loginctl prints the sudo line to run', async () => {
    const m = await setUp('linux', 'enable', (a) =>
      a[0] === 'loginctl' && a[1] === 'disable-linger' ? { code: 1 } : undefined,
    );
    const { io } = tty(m, [true]);
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    expect(io.stdout).toContain('loginctl refused; run it yourself: sudo loginctl disable-linger op\n');
  });
  it('a loginctl that worked says nothing more', async () => {
    const m = await setUp('linux', 'enable');
    const { io } = tty(m, [true]);
    expect(await runCli(['uninstall'], m.deps)).toBe(0);
    expect(m.runner.calls.some((c) => c.argv.join(' ') === 'loginctl disable-linger op')).toBe(true);
    expect(io.stdout).not.toContain('loginctl refused');
    expect(io.stdout).not.toContain('Linger stays on');
  });
});
