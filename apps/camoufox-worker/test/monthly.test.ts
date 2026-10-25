import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, asIsoDateTime, billingMonthWindow, fixedClock, type IsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppInstances,
  admit,
  countsFact,
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
/** Counts of the billing-day-1 window starting at `windowStart` (its end a month later), or of the window given. */
const counts = (windowStart: string, pages: number, scrolls: number, windowEnd?: string) => ({
  windowStart: at(windowStart),
  windowEnd: at(windowEnd ?? billingMonthWindow(at(windowStart), 1).windowEnd),
  pages,
  scrolls,
});
const asRoot = (process.getuid?.() ?? 0) === 0;
const capReached = (used: number, windowEnd = '2027-04-01T00:00:00.000Z', cap = 1500) => ({
  kind: 'monthly-cap',
  cap,
  used,
  windowEnd,
});

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
    // why: March's counts (day 1, ending 1 April) carry into a window they overlap; one that started after they ended
    // starts at zero
    const overlaps = Date.parse(start) < Date.parse('2027-04-01T00:00:00.000Z');
    expect(r.kind === 'ok' ? r.reserved.pages : null).toBe(overlaps ? 8 : 1);
  });
});

describe('admit and settle (pure)', () => {
  const MARCH = '2027-03-01T00:00:00.000Z';
  const NOW = at('2027-03-10T12:00:00.000Z');
  it('the page cap refuses the page that would pass it; one below admits', () => {
    expect(admit(counts(MARCH, 1500, 0), CAPS, NOW, 0)).toEqual(capReached(1500));
    expect(admit(counts(MARCH, 1499, 0), CAPS, NOW, 0)).toEqual({
      kind: 'ok',
      scrollAllowance: 0,
      reserved: counts(MARCH, 1500, 0),
    });
    expect(admit(counts(MARCH, 0, 0), { ...CAPS, pages: 0 }, NOW, 0)).toEqual(capReached(0, undefined, 0));
    expect(admit(counts(MARCH, 1700, 0), CAPS, NOW, 0)).toEqual(capReached(1700));
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
  // why: W3 (cb-b1-002): counts start at zero only once their own window has ended, so no change of the billing day
  // and no clock step back hands the month a fresh cap
  it('a billing day changed part way carries the counts until their window ends, never resets them', () => {
    const october = counts('2027-10-01T00:00:00.000Z', 1400, 5800);
    const caps15 = { ...CAPS, billingDay: 15 };
    const r = admit(october, caps15, at('2027-10-20T12:00:00.000Z'), 0);
    expect(r).toMatchObject({
      kind: 'ok',
      reserved: {
        windowStart: '2027-10-15T00:00:00.000Z',
        windowEnd: '2027-11-15T00:00:00.000Z',
        pages: 1401,
      },
    });
    expect(admit({ ...october, pages: 1500 }, caps15, at('2027-10-20T12:00:00.000Z'), 0)).toEqual(
      capReached(1500, '2027-11-15T00:00:00.000Z'),
    );
    // why: a window that ended no later than now's start is over: zero
    expect(admit(october, caps15, at('2027-11-15T00:00:00.000Z'), 0)).toMatchObject({
      reserved: { windowStart: '2027-11-15T00:00:00.000Z', pages: 1 },
    });
  });
  it('a clock stepped back across a boundary keeps the later window’s counts and its end', () => {
    const november = counts('2027-11-01T00:00:00.000Z', 900, 10);
    const back = admit(november, CAPS, at('2027-10-31T23:00:00.000Z'), 0);
    expect(back).toMatchObject({
      kind: 'ok',
      reserved: {
        windowStart: '2027-10-01T00:00:00.000Z',
        windowEnd: '2027-12-01T00:00:00.000Z',
        pages: 901,
      },
    });
    if (back.kind !== 'ok') throw new Error('ok');
    // why: the carried window, read in November again, is still November's
    expect(admit(back.reserved, CAPS, at('2027-11-02T00:00:00.000Z'), 0)).toMatchObject({
      reserved: {
        windowStart: '2027-11-01T00:00:00.000Z',
        windowEnd: '2027-12-01T00:00:00.000Z',
        pages: 902,
      },
    });
    expect(admit(back.reserved, CAPS, at('2027-12-01T00:00:00.000Z'), 0)).toMatchObject({
      reserved: { windowStart: '2027-12-01T00:00:00.000Z', pages: 1 },
    });
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
      windowEnd: '2027-04-01T00:00:00.000Z',
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
  const W = '"windowStart":"2027-03-01T00:00:00.000Z","windowEnd":"2027-04-01T00:00:00.000Z"';
  it.each(
    (
      [
        ['missing beside the pacer’s file', null, 0o600, 'missing'],
        ['truncated', `{${W},"pa`, 0o600, 'unreadable'],
        ['not JSON', 'zeros', 0o600, 'unreadable'],
        ['an array', '[]', 0o600, 'unreadable'],
        ['failing its schema (a negative count)', `{${W},"pages":-1,"scrolls":0}`, 0o600, 'unreadable'],
        ['failing its schema (an extra field)', `{${W},"pages":1,"scrolls":0,"x":1}`, 0o600, 'unreadable'],
        [
          'failing its schema (no window)',
          '{"windowStart":"soon","pages":1,"scrolls":0}',
          0o600,
          'unreadable',
        ],
        [
          'failing its schema (an earlier shape, no window end)',
          '{"windowStart":"2027-03-01T00:00:00.000Z","pages":1,"scrolls":0}',
          0o600,
          'unreadable',
        ],
        ['widened to 0644', `{${W},"pages":1,"scrolls":0}`, 0o644, 'unreadable'],
        ['unreadable (mode 000)', `{${W},"pages":1,"scrolls":0}`, 0o000, 'unreadable'],
      ] as const
    )
      // why: CodeRabbit (PR #15): root reads a mode-000 file, so that case is left out there rather than passing empty
      .filter(([, , mode]) => !(asRoot && mode === 0o000)),
  )(
    '%s: every page is refused as counts-unreadable, never a cap reached; the status says unreadable; the file is left byte for byte',
    async (_w, text, mode, problem) => {
      const d = tmpDir();
      writeFileSync(join(d, 'pacer.json'), '{"lastPageAt":"2027-03-10T11:00:00.000Z"}', { mode: 0o600 });
      const file = join(d, MONTHLY_FILE);
      if (text !== null) {
        writeFileSync(file, text);
        chmodSync(file, mode);
      }
      expect(await readCounts(d)).toEqual({ refused: problem });
      expect(countsFact(d)).toBe(problem);
      const c = counter(d);
      expect(await c.admit(0)).toEqual({ kind: 'counts-unreadable', problem });
      expect(c.check(30)).toEqual({ kind: 'counts-unreadable', problem });
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
    expect(await c.admit(0)).toEqual(capReached(1, undefined, 1));
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
  });
  it('the status reports carried counts with their window, and a new install’s zero counts as readable', () => {
    const d = tmpDir();
    writeFileSync(
      join(d, MONTHLY_FILE),
      JSON.stringify(counts('2027-03-01T00:00:00.000Z', 40, 9, '2027-04-15T00:00:00.000Z')),
      { mode: 0o600 },
    );
    expect(counter(d).status()).toEqual({
      windowStart: '2027-03-01T00:00:00.000Z',
      windowEnd: '2027-04-15T00:00:00.000Z',
      pages: 40,
      scrolls: 9,
      readable: true,
    });
    expect(counter(tmpDir()).status()).toEqual({
      windowStart: '2027-03-01T00:00:00.000Z',
      windowEnd: '2027-04-01T00:00:00.000Z',
      pages: 0,
      scrolls: 0,
      readable: true,
    });
  });
  it('a rewrite replaces the file with this window’s figures, 0600, whatever it held', () => {
    const d = tmpDir();
    writeFileSync(join(d, 'pacer.json'), '{}', { mode: 0o600 });
    expect(countsFact(d)).toBe('missing');
    expect(counter(d).rewrite(40, 200)).toEqual(counts('2027-03-01T00:00:00.000Z', 40, 200));
    expect(countsFact(d)).toBe('ok');
    expect(statSync(join(d, MONTHLY_FILE)).mode & 0o777).toBe(0o600);
  });
  // why: ts-b1-007: a temporary file left by a crash, wider than 0600, is never the one renamed in
  it('a stale temporary file at 0644 beside the counts never widens them', async () => {
    const d = tmpDir();
    writeFileSync(join(d, `${MONTHLY_FILE}.tmp`), 'stale', { mode: 0o644 });
    writeFileSync(join(d, `.${MONTHLY_FILE}.tmp-1-abcd`), 'stale', { mode: 0o644 });
    await counter(d).admit(0);
    expect(statSync(join(d, MONTHLY_FILE)).mode & 0o777).toBe(0o600);
    expect(countsFact(d)).toBe('ok');
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

describe('the counts and instances files’ shapes (fail closed)', () => {
  const clock = fixedClock(at('2027-03-10T12:00:00.000Z'));
  const W = '"windowStart":"2027-03-01T00:00:00.000Z","windowEnd":"2027-04-01T00:00:00.000Z"';
  it.each([
    ['a fractional count', `{${W},"pages":1.5,"scrolls":0}`],
    ['a count as text', `{${W},"pages":"1","scrolls":0}`],
    ['scrolls missing', `{${W},"pages":1,"x":0}`],
    ['null', 'null'],
    ['a number', '7'],
  ])('%s is refused', async (_w, text) => {
    const d = tmpDir();
    writeFileSync(join(d, MONTHLY_FILE), text, { mode: 0o600 });
    expect(await readCounts(d)).toEqual({ refused: 'unreadable' });
    expect(new MonthlyCounter({ dir: d, caps: CAPS, clock }).status().readable).toBe(false);
  });
  it('a 0400 file is read (no wider than 0600), and a new install’s first window is this one', async () => {
    const d = tmpDir();
    writeFileSync(join(d, MONTHLY_FILE), `{${W},"pages":2,"scrolls":3}`, {
      mode: 0o400,
    });
    expect(await readCounts(d)).toEqual(counts('2027-03-01T00:00:00.000Z', 2, 3));
    const fresh = new MonthlyCounter({ dir: tmpDir(), caps: CAPS, clock });
    expect(fresh.check(4)).toEqual({
      kind: 'ok',
      scrollAllowance: 4,
      reserved: counts('2027-03-01T00:00:00.000Z', 1, 4),
    });
  });
  it('an instances file of another shape starts the window’s list afresh; the file is 0600', () => {
    const d = tmpDir();
    const i = new AppInstances({ dir: d, billingDay: 1, clock });
    for (const text of [
      'null',
      '{"windowStart":"2027-03-01T00:00:00.000Z"}',
      '{"windowStart":"2027-03-01T00:00:00.000Z","ids":"x"}',
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'a'.repeat(63)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["x${'a'.repeat(64)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":[7]}`,
      // why: ts-b1-001: one malformed entry beside a valid digest, and a 65-character digest, start afresh too
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(64)}",7]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(64)}","x${'c'.repeat(64)}"]}`,
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'c'.repeat(65)}"]}`,
    ]) {
      writeFileSync(join(d, 'app-instances.json'), text);
      expect(i.status().count, text).toBe(0);
    }
    writeFileSync(
      join(d, 'app-instances.json'),
      `{"windowStart":"2027-03-01T00:00:00.000Z","ids":["${'b'.repeat(64)}"]}`,
    );
    expect(i.status().count).toBe(1);
    i.seen('next-app');
    expect(statSync(join(d, 'app-instances.json')).mode & 0o777).toBe(0o600);
    expect(i.status().count).toBe(2);
  });
});

// why: a new install's first page claims the pacer (writing its file) before it reserves; that is not an upgrade
describe('a new install’s first page', () => {
  it('the pacer’s file written after a check that found neither file does not make the counts missing', async () => {
    const d = tmpDir();
    const c = new MonthlyCounter({ dir: d, caps: CAPS, clock: fixedClock(at('2027-03-10T12:00:00.000Z')) });
    expect(c.check(0)).toMatchObject({ kind: 'ok' });
    writeFileSync(join(d, 'pacer.json'), '{}', { mode: 0o600 });
    expect(c.check(0)).toMatchObject({ kind: 'ok' });
    expect(c.status().readable).toBe(true);
    // why: another counter (another process) that never saw the new install reads an upgrade's missing file
    expect(
      new MonthlyCounter({ dir: d, caps: CAPS, clock: fixedClock(at('2027-03-10T12:00:00.000Z')) }).check(0),
    ).toEqual({ kind: 'counts-unreadable', problem: 'missing' });
  });
});
