import { closeSync, openSync, readdirSync, readFileSync, rmSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One worker per data directory (devops-006; decision 69): `<data>/worker.lock` holds the holder's pid. A lock whose
 * pid is not alive is taken over; a live one refuses, naming the pid. The recorder takes the same lock.
 */
const FILE = 'worker.lock';

export class LockHeld extends Error {
  constructor(readonly pid: number) {
    super(`the camoufox worker's data directory is locked by pid ${pid}`);
    this.name = 'LockHeld';
  }
}

function alive(pid: number, isAlive: (pid: number) => boolean): boolean {
  return Number.isInteger(pid) && pid > 0 && isAlive(pid);
}

/** process.kill(pid, 0): true while the process exists (EPERM means it exists under another user). */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e instanceof Error && 'code' in e && e.code === 'EPERM';
  }
}

export interface Lock {
  release(): void;
}

/** Takes the lock for `pid`, or throws LockHeld. */
export function acquireLock(dir: string, o: { pid?: number; isAlive?: (pid: number) => boolean } = {}): Lock {
  const path = join(dir, FILE);
  const pid = o.pid ?? process.pid;
  const isAlive = o.isAlive ?? pidAlive;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx', 0o600);
      writeSync(fd, String(pid));
      closeSync(fd);
      return {
        release: () => {
          try {
            if (readFileSync(path, 'utf8') === String(pid)) unlinkSync(path);
          } catch {
            // why: already gone; releasing twice is harmless.
          }
        },
      };
    } catch (e) {
      if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
      const holder = Number(readFileSync(path, 'utf8').trim());
      if (alive(holder, isAlive)) throw new LockHeld(holder);
      // why: a killed worker left its lock; the pid is dead, so the directory is free.
      unlinkSync(path);
    }
  }
  throw new Error('could not take the camoufox worker lock');
}

/** True while another live process holds the lock (the recorder refuses then). */
export function lockHeld(dir: string, isAlive: (pid: number) => boolean = pidAlive): boolean {
  try {
    return alive(Number(readFileSync(join(dir, FILE), 'utf8').trim()), isAlive);
  } catch {
    return false;
  }
}

/** The start-up sweep (SEC-R2-003): removes `<data>/probe-*` profiles a killed consent probe left behind. */
export function sweepProbeProfiles(dir: string): string[] {
  const gone: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('probe-')) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    gone.push(name);
  }
  return gone;
}
