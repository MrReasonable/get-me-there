// The recorder's page claim (pageClaim.ts): the shared pacer before a recording's page, its spacing waited out once.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { Pacer } from '../src/pacer.js';
import { claim } from '../src/pageClaim.js';
import type { EntryContext } from '../src/run.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2027-03-10T12:00:00.000Z');
const ctx = (dataDir: string, out: string[] = []): EntryContext => ({
  env: {},
  dataDir,
  args: [],
  out: (l) => {
    out.push(l);
  },
  err: () => undefined,
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('claim (the recorder’s pacer)', () => {
  it('claims the pacer at once when the spacing allows', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    await claim(pacer, { timers }, ctx(dir));
    expect(pacer.isBusy()).toBe(true);
    expect(timers.sleeps).toEqual([]);
  });
  it('waits out the spacing from the persisted last page time once, then claims', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    writeFileSync(join(dir, 'pacer.json'), JSON.stringify({ lastPageAt: '2027-03-10T11:59:50.000Z' }), {
      mode: 0o600,
    });
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    const out: string[] = [];
    await claim(pacer, { timers }, ctx(dir, out));
    expect(out).toEqual(['waiting 18 s for the spacing']);
    expect(timers.sleeps).toEqual([18_000]);
    expect(pacer.isBusy()).toBe(true);
  });
  it('refuses when the spacing still refuses after the wait (a page already in flight)', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    await claim(pacer, { timers }, ctx(dir));
    await expect(claim(pacer, { timers }, ctx(dir))).rejects.toThrow(/the spacing still refuses/);
  });
});
