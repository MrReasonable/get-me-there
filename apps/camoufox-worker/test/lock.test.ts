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
