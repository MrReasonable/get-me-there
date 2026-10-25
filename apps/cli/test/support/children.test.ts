import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { exited, guarded, killTracked } from './children.js';

// The teardown check itself (follow-ups PR): killTracked() must tell an exited child that is not yet reaped (a zombie,
// or on macOS one still exiting) from one still running, on macOS too, where there is no /proc. It reads the state
// with `ps -o stat=`: a zombie is never reported, and every child still running is, whoever its parent is now.
const started: ChildProcess[] = [];
afterEach(() => {
  for (const c of started.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  killTracked();
});

/**
 * A guarded `node -e` grandchild under a parent that never reaps it: `sh` starts it in the background and then becomes
 * `sleep`, which holds no fd 3. The grandchild writes its pid on fd 3, then runs `then`. Resolves with that pid and the
 * fd 3 closing.
 */
async function underNonReapingParent(then: string) {
  const script = guarded(`require('fs').writeSync(3, String(process.pid)); ${then}`);
  const sh = spawn('sh', ['-c', `"$0" -e "$1" & exec 3>&-; exec sleep 30`, process.execPath, script], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  started.push(sh);
  const fd3 = sh.stdio[3];
  if (fd3 === null || fd3 === undefined || !('on' in fd3)) throw new Error('no fd 3 pipe');
  // why: listened for before the pid arrives, so a close that follows the data at once is never missed
  const closed = once(fd3, 'close').then(
    () => undefined,
    () => undefined,
  );
  const [chunk] = await once(fd3, 'data');
  return { pid: Number(String(chunk)), closed };
}

describe('exited: the ps states of a process that has ended', () => {
  it.each(['Z', 'Z+', 'Zs', 'X', 'RE', 'SE+', 'UE'])('%s has ended', (stat) => {
    expect(exited(stat)).toBe(true);
  });
  it.each(['R', 'R+', 'S', 'Ss', 'S+', 'I', 'T', 'U', 'D', 'Sl', 'SN', 'SX'])('%s is running', (stat) => {
    expect(exited(stat)).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')(
  'killTracked on a real process tree',
  { timeout: 20_000 },
  () => {
    it('a zombie (exited, its parent not reaping it) is not reported', async () => {
      const { closed } = await underNonReapingParent('process.exit(0)');
      // fd 3 closes only once the grandchild, its one remaining holder, has exited
      await closed;
      expect(killTracked()).toEqual([]);
    });
    it('a child still running under another parent is reported, and killed', async () => {
      const { pid } = await underNonReapingParent('setInterval(() => {}, 1000)');
      expect(killTracked()).toEqual([pid]);
    });
    it('a child of this process still running is reported, and killed', async () => {
      const c = spawn(
        process.execPath,
        ['-e', guarded("process.stdout.write('up'); setInterval(() => {}, 1000)")],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );
      started.push(c);
      await once(c.stdout, 'data');
      const gone = once(c, 'exit');
      expect(killTracked()).toEqual([c.pid]);
      expect(await gone).toEqual([null, 'SIGKILL']);
    });
  },
);
