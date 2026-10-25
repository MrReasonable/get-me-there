import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { RunHandler } from '../../src/exec/memory.js';
import { machine } from '../support/machine.js';

// why: Ian's ruling on PR #11 (survivors before merge): restore's refusals, what it leaves on disk and what it tells
// the operator to do next, asserted as behaviour.
const DB = '/Users/op/.local/share/get-me-there/get-me-there.db';
const KEPT = `${DB}.before-restore-2026-10-24T09-30-00-000Z`;

async function stopped(extra?: RunHandler) {
  let started = false;
  const m = machine({ extra: (a, c) => (started ? extra?.(a, c) : undefined) });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.running.clear();
  m.executor.log.length = 0;
  m.runner.calls.length = 0;
  m.io.stdout = '';
  m.io.stderr = '';
  started = true;
  return m;
}

describe('restore (survivors, PR #11)', () => {
  it('a failed app is refused like a running one: nothing is copied', async () => {
    const m = await stopped((a) =>
      a[0] === 'launchctl' && a[1] === 'print' && String(a[2]).endsWith('.app')
        ? { code: 0, stdout: '\tstate = not running\n\tlast exit code = 1\n' }
        : undefined,
    );
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(78);
    expect(m.io.stderr).toBe('the app is running: stop it first with pnpm gmt stop, then restore\n');
    expect(m.executor.log).toEqual([]);
  });
  it('a missing file is refused naming the path it looked at, resolved from where pnpm gmt ran', async () => {
    const m = await stopped();
    expect(await runCli(['restore', 'b/none.db'], m.deps)).toBe(78);
    expect(m.io.stderr).toBe('there is no backup file at /work/b/none.db\n');
    expect(m.executor.log).toEqual([]);
  });
  it('a relative path is read from where pnpm gmt ran', async () => {
    const m = await stopped();
    m.fs.file('/work/b/x.db', 'backup');
    expect(await runCli(['restore', 'b/x.db'], m.deps)).toBe(0);
    expect(m.fs.read(DB)).toBe('backup');
  });
  it('--dry-run prints the placement and changes nothing on disk', async () => {
    const m = await stopped();
    m.fs.file('/b/x.db', 'backup').file(DB, 'current', 0o600);
    expect(await runCli(['restore', '/b/x.db', '--dry-run'], m.deps)).toBe(0);
    expect(m.io.stdout.split('\n')[0]).toBe('restore:');
    expect(m.io.stdout).not.toContain('note:');
    expect(m.io.stdout).toContain(`copy /b/x.db to ${DB}.importing (0600)`);
    expect(m.io.stdout).toContain(`move ${DB} to ${KEPT}`);
    expect(m.executor.log).toEqual([]);
    expect(m.fs.read(DB)).toBe('current');
    expect(m.fs.read(KEPT)).toBeNull();
  });
  it('a failed move after the check reports the step and exits 1, leaving the current database in place', async () => {
    const m = await stopped();
    m.fs.file('/b/x.db', 'backup').file(DB, 'current', 0o600);
    const inner = m.deps.executor;
    m.deps.executor = {
      run: async (a) => {
        if (a.kind === 'rename' && a.from === DB) throw new Error('permission denied');
        return inner.run(a);
      },
    };
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(1);
    expect(m.io.stderr.startsWith('restore: stopped at a failed step; nothing was undone\n')).toBe(true);
    expect(m.fs.read(DB)).toBe('current');
  });
  it('with no current database it says nothing about a previous file; it always ends with how to start', async () => {
    const m = await stopped();
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.io.stdout).not.toContain('the previous file is');
    expect(m.io.stdout.split('\n')[0]).toBe(
      `Restored /b/x.db as ${DB}. A restored ledger lacks any call made after its backup, so check each vendor’s dashboard.`,
    );
    expect(m.io.stdout).toContain('\nStart the app with pnpm gmt start.\n');
  });
  it('the detached-checkout line follows git: printed when symbolic-ref fails, not on a branch', async () => {
    const onBranch = await stopped((a) =>
      a[0] === 'git' && a[1] === 'symbolic-ref' ? { code: 0 } : undefined,
    );
    onBranch.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], onBranch.deps)).toBe(0);
    expect(onBranch.io.stdout).not.toContain('detached');
    const ref = onBranch.runner.calls.find((c) => c.argv[0] === 'git');
    expect(ref?.argv).toEqual(['git', 'symbolic-ref', '-q', 'HEAD']);
    expect(ref?.cwd).toBe(onBranch.deps.checkout);
    const off = await stopped((a) => (a[0] === 'git' && a[1] === 'symbolic-ref' ? { code: 1 } : undefined));
    off.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], off.deps)).toBe(0);
    expect(
      off.io.stdout.endsWith(
        'This checkout is on a detached commit: run git switch main before the next pnpm gmt update.\n',
      ),
    ).toBe(true);
  });
  it('without app.env it still restores, with the plan-free dashboard advice', async () => {
    const m = await stopped();
    m.fs.delete('/Users/op/.config/get-me-there/app.env');
    m.fs.file('/b/x.db', 'backup');
    expect(await runCli(['restore', '/b/x.db'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('so check each vendor’s dashboard.');
    expect(m.fs.read(DB)).toBe('backup');
  });
});
