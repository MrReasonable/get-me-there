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

/** The recorded children that are still running, after killing each with SIGKILL. */
export function killTracked(): number[] {
  if (!existsSync(TRACK)) return [];
  const alive: number[] = [];
  for (const line of readFileSync(TRACK, 'utf8').split('\n')) {
    const pid = Number(line);
    if (!Number.isInteger(pid) || pid <= 0) continue;
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
