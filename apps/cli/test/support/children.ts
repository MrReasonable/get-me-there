import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileTempDir } from './tempdirs.js';

/**
 * Real `node -e` children the tests start (PR #11: a mutant or a killed test worker once left ~100 of them running).
 * `guarded(script)` prefixes a child script so that it records its pid here, exits as soon as its parent goes away
 * (POSIX re-parents an orphan, so its ppid changes), and exits after 30 s whatever it is waiting on (stdin included);
 * `killTracked()`, in each such file's afterEach, kills every recorded child still running and returns them (a child that has
 * ended but is not yet reaped, which `ps` shows, is neither).
 */
let trackFile: string | undefined;
/**
 * Where the children record their pids: a directory of its own, made on first use (inside a test, so under the
 * private temp directory) and removed after the file, so a file that starts children but never calls killTracked
 * leaves nothing in the temp directory.
 */
function track(): string {
  trackFile ??= join(fileTempDir('gmt-test-children-'), 'pids');
  return trackFile;
}

export function guarded(script: string): string {
  const prefix = [
    `require('fs').appendFileSync(${JSON.stringify(track())}, process.pid + '\\n');`,
    '{ const p = process.ppid;',
    'setInterval(() => { if (process.ppid !== p) process.exit(97); }, 200).unref();',
    'setTimeout(() => process.exit(96), 30000).unref(); }',
  ].join(' ');
  return `${prefix} ${script}`;
}

/**
 * Whether a `ps` state (`ps -o stat=`, the same column on Linux and macOS) is a process that has ended: a zombie (`Z`,
 * exited and waiting for its parent to reap it), dead (`X`, Linux), or on macOS still exiting (an `E` flag after the
 * state letter, which no Linux flag uses). A signal to such a process succeeds, so without this it would read as running.
 */
export function exited(stat: string): boolean {
  return /^[ZX]/.test(stat) || stat.slice(1).includes('E');
}

/**
 * The pid's `ps` state, or null when `ps` cannot say: the process is gone (ps exits 1), or there is no `ps` (Windows,
 * where an exited process leaves no zombie and a signal to it fails, so null reads as running, the strict answer).
 */
function psState(pid: number): string | null {
  try {
    const out = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/**
 * The recorded children still running, after killing each with SIGKILL: every one, whoever its parent is now (an orphan
 * still running at teardown is a leftover too). One that has ended but is not yet reaped (on Linux an orphan goes to a
 * subreaper, on macOS to launchd, either of which may take a moment) is not.
 */
export function killTracked(): number[] {
  if (trackFile === undefined || !existsSync(trackFile)) return [];
  const alive: number[] = [];
  for (const line of readFileSync(trackFile, 'utf8').split('\n')) {
    const pid = Number(line);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // why: read before the kill, which itself ends a running child
    const stat = psState(pid);
    if (stat !== null && exited(stat)) continue;
    try {
      process.kill(pid, 'SIGKILL');
      alive.push(pid);
    } catch {
      // why: already gone (ESRCH), the expected case
    }
  }
  rmSync(trackFile, { force: true });
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

export const record = (pid: number): void => appendFileSync(track(), `${pid}\n`);
