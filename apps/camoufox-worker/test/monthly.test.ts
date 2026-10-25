import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, asIsoDateTime, billingMonthWindow, fixedClock, type IsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppInstances,
  admit,
  MONTHLY_FILE,
  type MonthlyCaps,
  MonthlyCounter,
  readCounts,
  settle,
} from '../src/monthly.js';
import { tmpDir } from './support/tmp.js';

// why: decision 82 (Task 17.3): the worker's own monthly caps across every caller, over the ledger's billing window
const CAPS: MonthlyCaps = { pages: 1500, scrolls: 6000, billingDay: 1 };
const at = (s: string): IsoDateTime => asIsoDateTime(s);
const counts = (windowStart: string, pages: number, scrolls: number) => ({
  windowStart: at(windowStart),
  pages,
  scrolls,
});
const asRoot = (process.getuid?.() ?? 0) === 0;

beforeEach(() => {
  expect.hasAssertions();
});

describe('the window is the ledger’s billing month (00:00 UTC on the billing day)', () => {
  it.each([
    [1, '2027-03-31T23:59:59.999Z', '2027-03-01T00:00:00.000Z'],
    [1, '2027-04-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z'],
    [1, '2027-10-31T23:59:59.999Z', '2027-10-01T00:00:00.000Z'],
    [1, '2027-11-01T00:00:00.000Z', '2027-11-01T00:00:00.000Z'],
    [15, '2027-10-14T23:59:59.999Z', '2027-09-15T00:00:00.000Z'],
    [15, '2027-10-15T00:00:00.000Z', '2027-10-15T00:00:00.000Z'],
  ])('billing day %i: at %s the window starts %s (no London shift in summer time)', (day, now, start) => {
    const caps = { ...CAPS, billingDay: day };
    const r = admit(counts('2027-03-01T00:00:00.000Z', 7, 70), caps, at(now), 0);
    expect(r.kind === 'ok' ? r.reserved.windowStart : null).toBe(start);
    // why: the same rule the db window query agrees with (WP16a's test): one pure function in core
    expect(start).toBe(billingMonthWindow(at(now), day).windowStart);
    const sameWindow = start === '2027-03-01T00:00:00.000Z';
    expect(r.kind === 'ok' ? r.reserved.pages : null).toBe(sameWindow ? 8 : 1);
  });
});

describe('admit and settle (pure)', () => {
  const MARCH = '2027-03-01T00:00:00.000Z';
  const NOW = at('2027-03-10T12:00:00.000Z');
  it('the page cap refuses the page that would pass it; one below admits', () => {
    expect(admit(counts(MARCH, 1500, 0), CAPS, NOW, 0)).toEqual({ kind: 'monthly-cap' });
    expect(admit(counts(MARCH, 1499, 0), CAPS, NOW, 0)).toEqual({
      kind: 'ok',
      scrollAllowance: 0,
      reserved: counts(MARCH, 1500, 0),
    });
    expect(admit(counts(MARCH, 0, 0), { ...CAPS, pages: 0 }, NOW, 0)).toEqual({ kind: 'monthly-cap' });
  });
  it('the scroll allowance is what the scroll cap leaves, at most the request; none left still admits the page', () => {
    expect(admit(counts(MARCH, 3, 5990), CAPS, NOW, 30)).toEqual({
      kind: 'ok',
      scrollAllowance: 10,
      reserved: counts(MARCH, 4, 6000),
    });
    expect(admit(counts(MARCH, 3, 100), CAPS, NOW, 30)).toMatchObject({ scrollAllowance: 30 });
    expect(admit(counts(MARCH, 3, 6000), CAPS, NOW, 30)).toEqual({
      kind: 'ok',
      scrollAllowance: 0,
      reserved: counts(MARCH, 4, 6000),
    });
    expect(admit(counts(MARCH, 3, 6100), CAPS, NOW, 30)).toMatchObject({ scrollAllowance: 0 });
  });
  it('settle gives back the allowance the page did not use; scrolls made are read within 0 and the allowance', () => {
    const r = counts(MARCH, 4, 6000);
    expect(settle(r, 10, 4)).toEqual(counts(MARCH, 4, 5994));
    expect(settle(r, 10, 10)).toEqual(r);
    expect(settle(r, 10, 99)).toEqual(r);
    expect(settle(r, 10, -3)).toEqual(counts(MARCH, 4, 5990));
    expect(settle(r, 0, 0)).toEqual(r);
  });
});

describe('the counts file (fail closed)', () => {
  const clock = fixedClock(at('2027-03-10T12:00:00.000Z'));
  const counter = (dir: string, caps = CAPS) => new MonthlyCounter({ dir, caps, clock });
  it('a new install (neither file) starts the window at zero, and the first page writes it 0600', async () => {
    const d = tmpDir();
    expect(await readCounts(d)).toBe('absent');
    expect(await counter(d).admit(0)).toMatchObject({ kind: 'ok' });
    expect(JSON.parse(readFileSync(join(d, MONTHLY_FILE), 'utf8'))).toEqual({
      windowStart: '2027-03-01T00:00:00.000Z',
      pages: 1,
      scrolls: 0,
    });
    expect((await import('node:fs')).statSync(join(d, MONTHLY_FILE)).mode & 0o777).toBe(0o600);
  });
  it('a restart reads the same counts back', async () => {
    const d = tmpDir();
    await counter(d).admit(20);
    expect(await readCounts(d)).toEqual(counts('2027-03-01T00:00:00.000Z', 1, 20));
    expect(counter(d).status()).toEqual({
      windowStart: '2027-03-01T00:00:00.000Z',
      windowEnd: '2027-04-01T00:00:00.000Z',
      pages: 1,
      scrolls: 20,
      readable: true,
    });
  });
  it.each([
    ['missing beside the pacer’s file', null, 0o600],
    ['truncated', '{"windowStart":"2027-03-01T00:00:00.000Z","pa', 0o600],
    ['not JSON', 'zeros', 0o600],
    ['an array', '[]', 0o600],
    [
      'failing its schema (a negative count)',
      '{"windowStart":"2027-03-01T00:00:00.000Z","pages":-1,"scrolls":0}',
      0o600,
    ],
    [
      'failing its schema (an extra field)',
      '{"windowStart":"2027-03-01T00:00:00.000Z","pages":1,"scrolls":0,"x":1}',
      0o600,
    ],
    ['failing its schema (no window)', '{"windowStart":"soon","pages":1,"scrolls":0}', 0o600],
    ['widened to 0644', '{"windowStart":"2027-03-01T00:00:00.000Z","pages":1,"scrolls":0}', 0o644],
    ['unreadable (mode 000)', '{"windowStart":"2027-03-01T00:00:00.000Z","pages":1,"scrolls":0}', 0o000],
  ])(
    '%s: every page is refused, the status says unreadable, and the file is left byte for byte',
    async (_w, text, mode) => {
      if (asRoot && mode === 0o000) return;
      const d = tmpDir();
      writeFileSync(join(d, 'pacer.json'), '{"lastPageAt":"2027-03-10T11:00:00.000Z"}', { mode: 0o600 });
      const file = join(d, MONTHLY_FILE);
      if (text !== null) {
        writeFileSync(file, text);
        chmodSync(file, mode);
      }
      expect(await readCounts(d)).toBe('refused');
      const c = counter(d);
      expect(await c.admit(0)).toEqual({ kind: 'monthly-cap' });
      expect(c.check(30)).toEqual({ kind: 'monthly-cap' });
      expect(c.status().readable).toBe(false);
      c.settle(counts('2027-03-01T00:00:00.000Z', 1, 0), 0, 0);
      if (text === null) expect(existsSync(file)).toBe(false);
      else {
        chmodSync(file, 0o600);
        expect(readFileSync(file, 'utf8')).toBe(text);
      }
    },
  );
  it('a refused page leaves the counts unchanged', async () => {
    const d = tmpDir();
    const c = counter(d, { ...CAPS, pages: 1 });
    await c.admit(0);
    const before = readFileSync(join(d, MONTHLY_FILE), 'utf8');
    expect(await c.admit(0)).toEqual({ kind: 'monthly-cap' });
    expect(readFileSync(join(d, MONTHLY_FILE), 'utf8')).toBe(before);
  });
  it('two callers at once with one page left: exactly one admitted', async () => {
    const d = tmpDir();
    const c = counter(d, { ...CAPS, pages: 1 });
    const both = await Promise.all([c.admit(0), c.admit(0)]);
    expect(both.map((a) => a.kind).sort()).toEqual(['monthly-cap', 'ok']);
    expect(await readCounts(d)).toEqual(counts('2027-03-01T00:00:00.000Z', 1, 0));
  });
  it('settles to the scrolls made, only over its own window', async () => {
    const d = tmpDir();
    const c = counter(d);
    const a = await c.admit(30);
    if (a.kind !== 'ok') throw new Error('admitted');
    c.settle(a.reserved, a.scrollAllowance, 12);
    expect(await readCounts(d)).toEqual(counts('2027-03-01T00:00:00.000Z', 1, 12));
    c.settle(counts('2027-02-01T00:00:00.000Z', 1, 30), 30, 0);
    expect(await readCounts(d)).toEqual(counts('2027-03-01T00:00:00.000Z', 1, 12));
    const empty = tmpDir();
    counter(empty).settle(a.reserved, 30, 0);
    expect(existsSync(join(empty, MONTHLY_FILE))).toBe(false);
  });
  it('counts of an earlier window report zero for this one, and the next page starts it afresh', async () => {
    const d = tmpDir();
    writeFileSync(join(d, MONTHLY_FILE), JSON.stringify(counts('2027-02-01T00:00:00.000Z', 1500, 6000)), {
      mode: 0o600,
    });
    expect(counter(d).status()).toMatchObject({ pages: 0, scrolls: 0, readable: true });
    expect(await counter(d).admit(5)).toMatchObject({
      kind: 'ok',
      reserved: counts('2027-03-01T00:00:00.000Z', 1, 5),
    });
    expect(counter(d).windowEnd()).toBe('2027-04-01T00:00:00.000Z');
  });
});

describe('app instances (decision 82: a second one is reported, never refused)', () => {
  it('counts each id once a window, kept only as a digest; a malformed id is ignored', () => {
    const d = tmpDir();
    let now = at('2027-03-10T12:00:00.000Z');
    const i = new AppInstances({
      dir: d,
      billingDay: 1,
      clock: { now: () => now, todayLondon: () => asIsoDate('2027-03-10') },
    });
    expect(i.status()).toEqual({ windowStart: '2027-03-01T00:00:00.000Z', count: 0 });
    i.seen('a'.repeat(64));
    i.seen('a'.repeat(64));
    i.seen('bad id with spaces');
    expect(i.status().count).toBe(1);
    i.seen('instance-two');
    expect(i.status().count).toBe(2);
    const text = readFileSync(join(d, 'app-instances.json'), 'utf8');
    expect(text).not.toContain('instance-two');
    now = at('2027-04-01T00:00:00.000Z');
    expect(i.status()).toEqual({ windowStart: '2027-04-01T00:00:00.000Z', count: 0 });
    writeFileSync(join(d, 'app-instances.json'), '{');
    expect(i.status().count).toBe(0);
  });
});
