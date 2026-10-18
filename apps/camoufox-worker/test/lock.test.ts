import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, LockHeld, lockHeld, pidAlive, sweepProbeProfiles } from '../src/lock.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('the data-directory lock (devops-006: one worker per profile)', () => {
  it('a second acquire throws naming the holder’s pid', () => {
    const dir = tmpDir();
    acquireLock(dir, { pid: 4242, isAlive: () => true });
    expect(() => acquireLock(dir, { pid: 5151, isAlive: () => true })).toThrow(LockHeld);
    expect(() => acquireLock(dir, { pid: 5151, isAlive: () => true })).toThrow(/pid 4242/);
    expect(lockHeld(dir, () => true)).toBe(true);
  });
  it('a lock whose pid is not alive is taken over', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'worker.lock'), '999999');
    const l = acquireLock(dir, { pid: 4242, isAlive: () => false });
    expect(lockHeld(dir, (p) => p === 4242)).toBe(true);
    l.release();
  });
  it('a garbled lock file is taken over', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'worker.lock'), 'garbage');
    expect(() => acquireLock(dir, { isAlive: () => true }).release()).not.toThrow();
  });
  it('release removes it, and releasing twice is harmless', () => {
    const dir = tmpDir();
    const l = acquireLock(dir);
    expect(lockHeld(dir)).toBe(true);
    l.release();
    l.release();
    expect(existsSync(join(dir, 'worker.lock'))).toBe(false);
    expect(lockHeld(dir)).toBe(false);
  });
  it('release leaves another holder’s lock alone', () => {
    const dir = tmpDir();
    const l = acquireLock(dir, { pid: 1111 });
    writeFileSync(join(dir, 'worker.lock'), '2222');
    l.release();
    expect(existsSync(join(dir, 'worker.lock'))).toBe(true);
  });
  it('an unwritable directory is reported as itself', () => {
    expect(() => acquireLock(join(tmpDir(), 'missing'))).toThrow(/ENOENT/);
  });
  it('pidAlive: this process is alive, a huge pid is not', () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 22 + 12345)).toBe(false);
  });
  it('the start-up sweep removes probe-* profiles left by a killed run (SEC-R2-003)', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'probe-abc', 'nested'), { recursive: true });
    mkdirSync(join(dir, 'profile'));
    expect(sweepProbeProfiles(dir)).toEqual(['probe-abc']);
    expect(existsSync(join(dir, 'probe-abc'))).toBe(false);
    expect(existsSync(join(dir, 'profile'))).toBe(true);
  });
});

// why: fix round 1 (arch M13): process.kill(0, 0) signals the process group, so 0 is never a live holder
describe('lock edges', () => {
  it('a lock file holding 0 or a negative pid is taken over without asking whether it is alive', () => {
    for (const held of ['0', '-1']) {
      const dir = tmpDir();
      writeFileSync(join(dir, 'worker.lock'), held);
      const asked: number[] = [];
      const l = acquireLock(dir, {
        pid: 7,
        isAlive: (p) => {
          asked.push(p);
          return true;
        },
      });
      expect(asked).toEqual([]);
      expect(lockHeld(dir, () => true)).toBe(true);
      l.release();
    }
  });
  it('the sweep leaves near-miss names alone', () => {
    const dir = tmpDir();
    for (const name of ['probe', 'probes', 'xprobe-1', 'probe-1']) mkdirSync(join(dir, name));
    expect(sweepProbeProfiles(dir)).toEqual(['probe-1']);
    for (const name of ['probe', 'probes', 'xprobe-1']) expect(existsSync(join(dir, name)), name).toBe(true);
  });
});
