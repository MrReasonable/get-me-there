// The recorder's page claim (pageClaim.ts) with a page count (WP21 Task 21.0): the caps, the shared pacer, then the
// reservation of every page the recording may load, returned so the recorder can settle to what it loaded.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { MONTHLY_FILE, MonthlyCounter } from '../src/monthly.js';
import { Pacer } from '../src/pacer.js';
import { claim } from '../src/pageClaim.js';
import type { EntryContext } from '../src/run.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2027-03-10T12:00:00.000Z');
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

describe('claim(…, pages) (WP21 Task 21.0)', () => {
  it('reserves the pages asked for and returns the admission', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    const monthly = new MonthlyCounter({
      dir,
      caps: { pages: 1500, scrolls: 6000, billingDay: 1 },
      clock: timers.clock,
    });
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    const a = await claim(pacer, monthly, 0, { timers }, ctx(dir), 4);
    expect(a).toMatchObject({ kind: 'ok', pagesReserved: 4, scrollAllowance: 0, reserved: { pages: 4 } });
    expect(JSON.parse(readFileSync(join(dir, MONTHLY_FILE), 'utf8'))).toMatchObject({ pages: 4 });
    expect(pacer.isBusy()).toBe(true);
  });
  it('one page by default, as every other kind claims', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    const monthly = new MonthlyCounter({
      dir,
      caps: { pages: 1500, scrolls: 6000, billingDay: 1 },
      clock: timers.clock,
    });
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    expect(await claim(pacer, monthly, 0, { timers }, ctx(dir))).toMatchObject({ pagesReserved: 1 });
  });
});

describe('claim(…, pages, whole) (WP21 Task 21.0 review)', () => {
  it('refuses before the pacer or the counts are touched when the whole worst case does not fit', async () => {
    const dir = tmpDir();
    const timers = fakeTimers(fixedClock(T0));
    // why: a cap of 3 on a new install leaves 3 pages: no counts file is read, so no mode is involved
    const monthly = new MonthlyCounter({
      dir,
      caps: { pages: 3, scrolls: 6000, billingDay: 1 },
      clock: timers.clock,
    });
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    await expect(claim(pacer, monthly, 0, { timers }, ctx(dir), 4, true)).rejects.toThrow(
      "the worker's monthly page cap leaves fewer than the 4 pages this recording may load",
    );
    expect(pacer.isBusy()).toBe(false);
    expect(existsSync(join(dir, MONTHLY_FILE))).toBe(false);
    expect(existsSync(join(dir, 'pacer.json'))).toBe(false);
    // why: without `whole` the same admission reserves the one page, as the session's headroom rule does
    expect(await claim(pacer, monthly, 0, { timers }, ctx(dir), 4)).toMatchObject({ pagesReserved: 1 });
  });
});
