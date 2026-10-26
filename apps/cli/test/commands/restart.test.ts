import { join } from 'node:path/posix';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { memoryExecutor, type RunHandler } from '../../src/exec/memory.js';
import type { Action } from '../../src/plan/action.js';
import { workerEntry } from '../../src/services/set.js';
import { machine } from '../support/machine.js';

/**
 * `gmt restart` and the worker (WP16b ruling U5; the operator's 2026-10-26 report): the old worker gets up to 270 s to
 * finish a page in flight, and its lock (`<workerData>/worker.lock`, its pid) stays held until it has exited. The
 * restart stops it, waits until the service manager has let it go and no live process holds the lock, then runs the
 * worker's check and starts it; a refused check is said, with its fix, and exits non-zero. Time is the executors': the
 * memory executor checks the lock once a simulated second, so a bound of n seconds is n + 1 checks, and nothing sleeps.
 */
const OLD_PID = 4242;
const WORKER_LABEL = 'local.get-me-there.camoufox-worker';
const WORKER_UNIT = 'get-me-there-camoufox-worker.service';
const ok = '{"ok":true}';
const refusal = (reason: string) => `{"reason":"${reason}","at":"2026-10-24T09:30:00.000Z"}`;

/**
 * A machine with the app set up and the worker's service installed and running, its old process holding the lock.
 * `releasesAfter` is how many lock checks the old process outlives once stopped (null: it never exits); the worker's
 * check answers `locked` while that process lives, else `check`.
 */
async function world(
  o: { os?: 'darwin' | 'linux'; releasesAfter?: number | null; check?: string; deactivating?: number } = {},
) {
  const os = o.os ?? 'darwin';
  const order: string[] = [];
  const state = { oldAlive: true, lockChecks: 0, stopped: false, showProbes: 0 };
  const extra: RunHandler = (argv) => {
    const line = argv.join(' ');
    if (argv.includes('check') && argv.includes('--json') && argv.some((a) => a.endsWith('run.ts'))) {
      order.push('check');
      return { code: 0, stdout: `${state.oldAlive ? refusal('locked') : (o.check ?? ok)}\n` };
    }
    if (line.includes(`bootout gui/501/${WORKER_LABEL}`) || line === `systemctl --user stop ${WORKER_UNIT}`) {
      order.push('stop');
      state.stopped = true;
    }
    if (line.startsWith('launchctl bootstrap') && line.endsWith(`${WORKER_LABEL}.plist`)) order.push('start');
    if (line === `systemctl --user start ${WORKER_UNIT}`) order.push('start');
    // why: systemd may still be stopping the unit when `systemctl stop` returns control; the wait reads past it
    if (
      line.endsWith(`--property=ActiveState --value ${WORKER_UNIT}`) &&
      state.showProbes < (o.deactivating ?? 0)
    ) {
      state.showProbes++;
      return { code: 0, stdout: 'deactivating\n' };
    }
    return undefined;
  };
  const m = machine({ os, extra });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  const worker = workerEntry(m.deps);
  for (const r of worker.rendered) m.fs.file(r.path, r.contents, 0o644);
  if (os === 'darwin') m.loaded.add(WORKER_LABEL);
  m.running.add(os === 'darwin' ? WORKER_LABEL : WORKER_UNIT);
  const lock = join(m.deps.platform.paths.workerData, 'worker.lock');
  m.fs.dir(m.deps.platform.paths.workerData, 0o700).file(lock, `${OLD_PID}\n`, 0o600);
  const releasesAfter = o.releasesAfter === undefined ? 0 : o.releasesAfter;
  const executor = memoryExecutor(m.fs, {
    runner: m.runner,
    // why: the old process lives until it is stopped and then `releasesAfter` lock checks have passed
    alive: (pid) => {
      if (pid !== OLD_PID) return false;
      if (state.stopped) {
        state.lockChecks++;
        if (releasesAfter !== null && state.lockChecks > releasesAfter) state.oldAlive = false;
      }
      return state.oldAlive;
    },
  });
  m.deps.executor = executor;
  m.io.stdout = '';
  m.io.stderr = '';
  return { ...m, executor, order, state, lock };
}

const kinds = (log: readonly Action[]) => log.map((a) => (a.kind === 'run' ? a.describe : a.kind));

describe('restart waits for the old worker to let go before it starts the new one (U5)', () => {
  it('darwin: a lock released only after 3 checks: bootout, the label gone, the lock free, then the check and bootstrap', async () => {
    const m = await world({ releasesAfter: 3 });
    expect(await runCli(['restart', '--only', 'worker'], m.deps), m.io.stderr).toBe(0);
    expect(m.order).toEqual(['stop', 'check', 'start']);
    expect(kinds(m.executor.log)).toEqual([
      `launchctl bootout gui/501/${WORKER_LABEL}`,
      'waitGone',
      'waitUnlocked',
      `launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/${WORKER_LABEL}.plist`,
    ]);
    // the lock was read until the old process had gone: three checks it outlived, and the one that found it free
    expect(m.state.lockChecks).toBe(4);
    expect(m.io.stdout).toBe('restart: done (4 steps)\n');
    expect(m.io.stderr).toBe('');
    expect(m.loaded.has(WORKER_LABEL)).toBe(true);
  });

  it('darwin: a lock never released: a bounded wait, a plain message naming the process, no start, a non-zero exit', async () => {
    const m = await world({ releasesAfter: null });
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(1);
    // why: the bound is the worker's stop timeout (270 s) plus 15 s, one check a second: 286 checks
    expect(m.state.lockChecks).toBe(286);
    expect(m.order).toEqual(['stop']);
    expect(m.io.stderr).toContain(
      `the worker (pid ${OLD_PID}) is still running and holds ${m.lock} after 285 s`,
    );
    expect(m.io.stderr).toContain('restart: stopped at a failed step');
    expect(`${m.io.stdout}${m.io.stderr}`).not.toContain('restart: done');
    expect(kinds(m.executor.log).some((k) => k.startsWith('launchctl bootstrap'))).toBe(false);
  });

  it('darwin: a refused start: no "done", the refusal and its fix said, the agent left booted out and said so, exit 78', async () => {
    const m = await world({ check: refusal('consent-expired') });
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(78);
    expect(m.order).toEqual(['stop', 'check']);
    expect(m.io.stderr).toBe(
      'worker: not restarted: refused, not retrying: the consent record has expired: capture again; fix: pnpm gmt consent\n' +
        'restart: not done: the worker is stopped (its launchd agent booted out) and was not started again\n',
    );
    expect(m.io.stdout).toBe('');
    expect(m.loaded.has(WORKER_LABEL)).toBe(false);
  });

  it('a check that fails (not a refusal) is not "done" either: exit 1, its words said', async () => {
    const m = await world({ check: 'not json' });
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'worker: not restarted: the worker’s start check exited 0 and said nothing',
    );
    expect(m.io.stderr).toContain('restart: not done');
  });

  it('linux: stop, a wait until the unit reads inactive, the lock free, then the check and start', async () => {
    const m = await world({ os: 'linux', releasesAfter: 2, deactivating: 2 });
    expect(await runCli(['restart', '--only', 'worker'], m.deps), m.io.stderr).toBe(0);
    expect(m.order).toEqual(['stop', 'check', 'start']);
    expect(kinds(m.executor.log)).toEqual([
      `systemctl --user stop ${WORKER_UNIT}`,
      'waitState',
      'waitUnlocked',
      `systemctl --user start ${WORKER_UNIT}`,
    ]);
    // the unit was still deactivating for two probes; the old process outlived two lock checks
    expect(m.state.showProbes).toBe(2);
    expect(m.state.lockChecks).toBe(3);
    expect(m.io.stdout).toBe('restart: done (4 steps)\n');
  });

  it('linux: a lock never released and a refused start each exit non-zero without "done"', async () => {
    const stuck = await world({ os: 'linux', releasesAfter: null });
    expect(await runCli(['restart', '--only', 'worker'], stuck.deps)).toBe(1);
    expect(stuck.io.stderr).toContain(`the worker (pid ${OLD_PID}) is still running and holds ${stuck.lock}`);
    expect(stuck.order).toEqual(['stop']);
    const refused = await world({ os: 'linux', check: refusal('signed-in') });
    expect(await runCli(['restart', '--only', 'worker'], refused.deps)).toBe(78);
    expect(refused.io.stderr).toContain(
      'worker: not restarted: refused, not retrying: the browser profile is signed in to an account: clear it; fix: pnpm --filter @gmt/camoufox-worker clear-signed-in\n',
    );
    expect(refused.io.stderr).toContain('the worker is stopped (its unit stopped) and was not started again');
    expect(`${refused.io.stdout}${refused.io.stderr}`).not.toContain('restart: done');
    expect(refused.running.has(WORKER_UNIT)).toBe(false);
  });

  it('linux: a unit that never reads inactive is a bounded wait that names its state', async () => {
    const m = await world({ os: 'linux', deactivating: 1000 });
    expect(await runCli(['restart', '--only', 'worker'], m.deps)).toBe(1);
    expect(m.state.showProbes).toBe(286);
    expect(m.io.stderr).toContain(
      `systemctl --user show --property=ActiveState --value ${WORKER_UNIT} still prints something else after 285 s`,
    );
    expect(m.order).toEqual(['stop']);
  });

  it('a whole restart: the worker stopped and let go, the app restarted, then the worker checked and started', async () => {
    const m = await world({ releasesAfter: 1 });
    expect(await runCli(['restart'], m.deps), m.io.stderr).toBe(0);
    const k = kinds(m.executor.log);
    expect(k.slice(0, 3)).toEqual([`launchctl bootout gui/501/${WORKER_LABEL}`, 'waitGone', 'waitUnlocked']);
    expect(k.at(-1)).toBe(`launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/${WORKER_LABEL}.plist`);
    expect(k).toContain('launchctl bootout gui/501/local.get-me-there.app');
    expect(m.order).toEqual(['stop', 'check', 'start']);
  });

  it('--dry-run prints the stop, both waits and the start, with the check rule, and changes nothing', async () => {
    const m = await world();
    expect(await runCli(['restart', '--only', 'worker', '--dry-run'], m.deps)).toBe(0);
    expect(m.executor.log).toEqual([]);
    expect(m.order).toEqual([]);
    expect(m.io.stdout).toBe(
      [
        'restart:',
        `  1. run launchctl bootout gui/501/${WORKER_LABEL}`,
        `  2. wait up to 285 s until launchctl print gui/501/${WORKER_LABEL} fails`,
        `  3. wait up to 285 s until the worker lets go of ${m.lock}`,
        `  4. run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/${WORKER_LABEL}.plist`,
        '  note: the worker starts again only once its check passes, after its old process has let go',
        '',
      ].join('\n'),
    );
  });

  it('stop --only worker waits for the lock too; a worker that is not running is not waited on', async () => {
    const m = await world({ releasesAfter: 2 });
    expect(await runCli(['stop', '--only', 'worker'], m.deps)).toBe(0);
    expect(kinds(m.executor.log)).toEqual([
      `launchctl bootout gui/501/${WORKER_LABEL}`,
      'waitGone',
      'waitUnlocked',
    ]);
    m.executor.log.length = 0;
    expect(await runCli(['stop', '--only', 'worker'], m.deps)).toBe(0);
    expect(m.executor.log).toEqual([]);
  });
});
