import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Real `node -e` children the tests start (PR #11: a mutant or a killed test worker once left ~100 of them running).
 * `guarded(script)` prefixes a child script so that it records its pid here, exits as soon as its parent goes away
 * (POSIX re-parents an orphan, so its ppid changes), and exits after 30 s whatever it is waiting on (stdin included);
 * `killTracked()`, in each such file's afterEach, kills every recorded child still running.
 */
const TRACK = join(tmpdir(), `gmt-test-children-${process.pid}`);

export function guarded(script: string): string {
  const prefix = [
    `require('fs').appendFileSync(${JSON.stringify(TRACK)}, process.pid + '\\n');`,
    '{ const p = process.ppid;',
    'setInterval(() => { if (process.ppid !== p) process.exit(97); }, 200).unref();',
    'setTimeout(() => process.exit(96), 30000).unref(); }',
  ].join(' ');
  return `${prefix} ${script}`;
}

/**
 * Whether the pid is a zombie: exited, waiting for its new parent to reap it (on Linux an orphan goes to a subreaper,
 * which may take a moment). A signal to a zombie succeeds, so it would otherwise read as still running.
 */
function zombie(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch {
    // why: no /proc (macOS, where launchd reaps at once), or the process is gone
    return false;
  }
}

/** The recorded children that are still running (zombies aside), after killing each with SIGKILL. */
export function killTracked(): number[] {
  if (!existsSync(TRACK)) return [];
  const alive: number[] = [];
  for (const line of readFileSync(TRACK, 'utf8').split('\n')) {
    const pid = Number(line);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // why: read before the kill, which itself makes a running child a zombie
    if (zombie(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
      alive.push(pid);
    } catch {
      // why: already gone (ESRCH), the expected case
    }
  }
  rmSync(TRACK, { force: true });
  return alive;
}

/** Whether a process with this pid still exists. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const trackFile = TRACK;
export const record = (pid: number): void => appendFileSync(TRACK, `${pid}\n`);
