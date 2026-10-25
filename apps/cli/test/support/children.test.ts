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
 * `cat`, which holds no fd 3 and lives until the test closes its stdin (or teardown kills it). The grandchild writes its
 * pid on fd 3, then exits, or with `stay` keeps reading fd 3 and lives until the test's end of it closes. Resolves
 * with that pid, the fd 3 stream and the stream's closing (once every holder of fd 3 has exited).
 */
async function underNonReapingParent(stay: boolean) {
  const then = stay
    ? "new (require('net').Socket)({ fd: 3 }).resume().write(String(process.pid))"
    : "require('fs').writeSync(3, String(process.pid)); process.exit(0)";
  const sh = spawn(
    'sh',
    ['-c', `"$0" -e "$1" & exec 3>&-; exec cat > /dev/null`, process.execPath, guarded(then)],
    {
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    },
  );
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
      const { closed } = await underNonReapingParent(false);
      // fd 3 closes only once the grandchild, its one remaining holder, has exited
      await closed;
      expect(killTracked()).toEqual([]);
    });
    it('a child still running under another parent is reported, and killed', async () => {
      const { pid } = await underNonReapingParent(true);
      expect(killTracked()).toEqual([pid]);
    });
    it('a child of this process still running is reported, and killed', async () => {
      const c = spawn(
        process.execPath,
        // the child lives until its stdin, the test's pipe, ends
        ['-e', guarded("process.stdout.write('up'); process.stdin.resume()")],
        {
          stdio: ['pipe', 'pipe', 'ignore'],
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
