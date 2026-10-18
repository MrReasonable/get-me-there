import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSignedIn } from '../src/clearSignedIn.js';
import { acquireLock } from '../src/lock.js';
import { Refusal } from '../src/refusal.js';
import { type EntryContext, EX_CONFIG } from '../src/run.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const ctx = (dataDir: string): EntryContext => ({
  env: {},
  dataDir,
  args: [],
  out: () => undefined,
  err: () => undefined,
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('clear-signed-in (devops-011)', () => {
  it('wipes the profile first, then clears the refusal', () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'profile', 'x'), { recursive: true });
    new Refusal({ dir, clock: fakeTimers().clock }).set('signed-in');
    expect(clearSignedIn(ctx(dir), 4242)).toBe(0);
    expect(existsSync(join(dir, 'profile'))).toBe(false);
    expect(new Refusal({ dir, clock: fakeTimers().clock }).active()).toBeNull();
  });
  it('refuses while the worker holds the lock', () => {
    const dir = tmpDir();
    acquireLock(dir, { pid: process.pid });
    expect(clearSignedIn(ctx(dir), 4242)).toBe(EX_CONFIG);
  });
});
