import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { carryLastPageAt, Pacer } from '../src/pacer.js';
import { DeadlineExceeded } from '../src/timers.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const T0 = asIsoDateTime('2026-10-18T05:00:00.000Z');
beforeEach(() => {
  expect.hasAssertions();
});
describe('Pacer (spec §2: start to start, 2 s tolerance, persisted, never randomised)', () => {
  it('arrivals every 30 s ± 50 ms produce no refusal', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    let refused = 0;
    for (let i = 0; i < 20; i++) {
      if (!p.claim().ok) refused++;
      p.release();
      clock.advance(i % 2 === 0 ? 29_950 : 30_050);
    }
    expect(refused).toBe(0);
  });
  it('an arrival more than 2 s early is refused', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(27_900);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
  it('an arrival exactly 2 s early passes (the tolerance boundary)', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(28_000);
    expect(p.claim()).toEqual({ ok: true });
  });
  it('spacing 120: 120 s arrivals pass, 60 s arrivals are refused every other time', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 120, clock });
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      const c = p.claim();
      results.push(c.ok);
      if (c.ok) p.release();
      clock.advance(60_000);
    }
    expect(results).toEqual([true, false, true, false, true, false]);
  });
  it('a restart inside the spacing keeps it', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock });
    p.claim();
    p.release();
    clock.advance(10_000);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 18,
    });
  });
  it('a second claim while busy is refused for the whole spacing', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock });
    p.claim();
    expect(p.isBusy()).toBe(true);
    clock.advance(60_000);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
    p.release();
    expect(p.claim()).toEqual({ ok: true });
  });
  it.each([
    ['not JSON', '{not json'],
    ['no lastPageAt', '{}'],
    ['a malformed instant', JSON.stringify({ lastPageAt: '2026-10-18 05:00' })],
    ['not an object', 'null'],
    ['a number', '7'],
    ['a string', '"2026-10-18T04:00:00.000Z"'],
  ])('a corrupt record (%s) treats the last page as now', (_n, content) => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), content);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 28,
    });
  });
  it('reports the persisted last start, null before any page', () => {
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) });
    expect(p.lastPageAt()).toBeNull();
    p.claim();
    expect(p.lastPageAt()).toBe(T0);
  });
  it('a read error other than a missing file is thrown', () => {
    const dir = tmpDir();
    const { mkdirSync } = process.getBuiltinModule('node:fs');
    mkdirSync(join(dir, 'pacer.json'));
    expect(() => new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).lastPageAt()).toThrow(
      /EISDIR/,
    );
  });
  it.each([-1, 601, 30.5])('refuses a spacing of %s', (s) => {
    expect(() => new Pacer({ dir: tmpDir(), minSpacingSeconds: s, clock: fixedClock(T0) })).toThrow(
      /CAMOUFOX_MIN_SPACING_SECONDS/,
    );
  });
});

// why: fix round 1 (TS M5): both bounds are inclusive
describe('Pacer bounds', () => {
  it('accepts 0 and 600 seconds and refuses -1 and 601', () => {
    for (const ok of [0, 600])
      expect(
        () => new Pacer({ dir: tmpDir(), minSpacingSeconds: ok, clock: fixedClock(T0) }),
        String(ok),
      ).not.toThrow();
    for (const bad of [-1, 601])
      expect(
        () => new Pacer({ dir: tmpDir(), minSpacingSeconds: bad, clock: fixedClock(T0) }),
        String(bad),
      ).toThrow(/from 0 to 600/);
  });
});

// why: fix round 1 (CodeRabbit): a failed write must not leave the pacer busy for the life of the process
describe('Pacer write failure', () => {
  it('a claim whose record cannot be written throws and leaves the pacer free', () => {
    const dir = join(tmpDir(), 'gone');
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) });
    expect(() => p.claim()).toThrow();
    expect(p.isBusy()).toBe(false);
    mkdirSync(dir);
    expect(p.claim()).toEqual({ ok: true });
  });
});

// why: operator ruling 2026-10-25: spacing 0 is no pause at all, with the one-page-at-a-time rule kept
describe('Pacer with spacing 0', () => {
  it('passes consecutive claims at the same instant without waiting and records each start', () => {
    const clock = fixedClock(T0);
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 0, clock });
    for (let i = 0; i < 3; i++) {
      expect(p.claim()).toEqual({ ok: true });
      expect(p.lastPageAt()).toBe(clock.now());
      p.release();
    }
    clock.advance(1_000);
    expect(p.claim()).toEqual({ ok: true });
    expect(p.lastPageAt()).toBe(clock.now());
  });
  it('still serves one page at a time, and the refusal asks for at least a second', () => {
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 0, clock: fixedClock(T0) });
    expect(p.claim()).toEqual({ ok: true });
    expect(p.isBusy()).toBe(true);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
    p.release();
    expect(p.claim()).toEqual({ ok: true });
  });
  it('passes even when the last start is recorded ahead of the clock (no wait is computed at all)', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), JSON.stringify({ lastPageAt: '2026-10-18T05:00:10.000Z' }));
    expect(new Pacer({ dir, minSpacingSeconds: 0, clock: fixedClock(T0) }).claim()).toEqual({ ok: true });
    // the same record under a real spacing still waits
    writeFileSync(join(dir, 'pacer.json'), JSON.stringify({ lastPageAt: '2026-10-18T05:00:10.000Z' }));
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock: fixedClock(T0) }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 38,
    });
  });
  it('passes after a restart and when the record is unreadable', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), '{not json');
    const clock = fixedClock(T0);
    expect(new Pacer({ dir, minSpacingSeconds: 0, clock }).claim()).toEqual({ ok: true });
  });
});

// why: WP17 Task 17.8: a recording session's last page is carried between data directories (run.ts session seed and
// merge), and a carried time never moves the last page earlier
describe('carryLastPageAt (Task 17.8)', () => {
  it('writes the time when none is recorded, 0600, and the pacer then waits from it', async () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    expect(carryLastPageAt(dir, asIsoDateTime('2026-10-18T04:59:50.000Z'), clock)).toBe(
      '2026-10-18T04:59:50.000Z',
    );
    const { statSync } = await import('node:fs');
    expect(statSync(join(dir, 'pacer.json')).mode & 0o777).toBe(0o600);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).claim()).toEqual({
      ok: false,
      retryAfterSeconds: 18,
    });
  });
  it('keeps the later of the recorded time and the carried one', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    carryLastPageAt(dir, asIsoDateTime('2026-10-18T04:00:00.000Z'), clock);
    expect(carryLastPageAt(dir, asIsoDateTime('2026-10-18T03:00:00.000Z'), clock)).toBe(
      '2026-10-18T04:00:00.000Z',
    );
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).lastPageAt()).toBe('2026-10-18T04:00:00.000Z');
    expect(carryLastPageAt(dir, asIsoDateTime('2026-10-18T04:30:00.000Z'), clock)).toBe(
      '2026-10-18T04:30:00.000Z',
    );
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).lastPageAt()).toBe('2026-10-18T04:30:00.000Z');
  });
  it('an equal time is kept as it is: the record is left untouched', () => {
    const dir = tmpDir();
    const clock = fixedClock(T0);
    // why: a record in another layout than the pacer writes, so a rewrite of it would show
    const recorded = '{ "lastPageAt": "2026-10-18T04:00:00.000Z" }\n';
    writeFileSync(join(dir, 'pacer.json'), recorded, { mode: 0o600 });
    expect(carryLastPageAt(dir, asIsoDateTime('2026-10-18T04:00:00.000Z'), clock)).toBe(
      '2026-10-18T04:00:00.000Z',
    );
    expect(readFileSync(join(dir, 'pacer.json'), 'utf8')).toBe(recorded);
  });
  it('an unreadable record reads as now (fail closed), so a carried earlier time leaves now', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), '{not json');
    const clock = fixedClock(T0);
    expect(carryLastPageAt(dir, asIsoDateTime('2026-10-18T04:00:00.000Z'), clock)).toBe(T0);
    expect(new Pacer({ dir, minSpacingSeconds: 30, clock }).lastPageAt()).toBe(T0);
  });
});

// why: WP21 Task 21.0 (spec §2 "at least CAMOUFOX_MIN_SPACING_SECONDS from the start of one page load to the start of
// the next"): a page that loads a further document (the list page loaded again, or a selection that loads one) waits
// out the spacing for it as the holder, under its own deadline, and records that load's start
describe('Pacer.reclaim (the holder’s further document load)', () => {
  const lastOf = (dir: string): unknown =>
    JSON.parse(readFileSync(join(dir, 'pacer.json'), 'utf8')).lastPageAt;
  it('waits spacing − 2 s from the last start under fake timers, then records the new start', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    expect(p.claim()).toEqual({ ok: true });
    timers.clock.advance(5000);
    const d = timers.deadline(60_000);
    await p.reclaim(d, timers);
    expect(timers.sleeps).toEqual([23_000]);
    expect(lastOf(dir)).toBe('2026-10-18T05:00:28.000Z');
    expect(p.isBusy()).toBe(true);
    d.clear();
  });
  // why: CodeRabbit on PR #49: pages at once: a page that starts while this one waits moves the last start
  it('reads the last start again after its wait, and waits again for a page that started meanwhile', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock, capacity: 2 });
    expect(p.claim()).toEqual({ ok: true });
    timers.clock.advance(5000);
    let other = false;
    const waits = {
      ...timers,
      sleep: async (ms: number, signal?: AbortSignal): Promise<void> => {
        await timers.sleep(ms, signal);
        // why: the other page session's page starts as this wait ends (28 s after T0: its own claim passes)
        if (!other) {
          other = true;
          expect(p.claim()).toEqual({ ok: true });
        }
      },
    };
    const d = timers.deadline(120_000);
    await p.reclaim(d, waits);
    expect(timers.sleeps).toEqual([23_000, 28_000]);
    expect(lastOf(dir)).toBe('2026-10-18T05:00:56.000Z');
    d.clear();
  });
  it('does not wait once the spacing has passed, and records the start', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    p.claim();
    timers.clock.advance(40_000);
    await p.reclaim(timers.deadline(1000), timers);
    expect(timers.sleeps).toEqual([]);
    expect(lastOf(dir)).toBe('2026-10-18T05:00:40.000Z');
  });
  it('returns at once with spacing 0, still recording the start', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 0, clock: timers.clock });
    p.claim();
    timers.clock.advance(1);
    await p.reclaim(timers.deadline(1000), timers);
    expect(timers.sleeps).toEqual([]);
    expect(lastOf(dir)).toBe('2026-10-18T05:00:00.001Z');
  });
  it('throws DeadlineExceeded when the wait outlasts its deadline, recording no start', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    p.claim();
    await expect(p.reclaim(timers.deadline(10_000), timers)).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(lastOf(dir)).toBe(T0);
  });
  it('the boundaries: a wait of exactly the time left is refused, one ms less is waited out; a wait of 0 sleeps not at all', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    const p = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    p.claim();
    await expect(p.reclaim(timers.deadline(28_000), timers)).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(timers.sleeps).toEqual([]);
    await p.reclaim(timers.deadline(28_001), timers);
    expect(timers.sleeps).toEqual([28_000]);
    timers.clock.advance(28_000);
    await p.reclaim(timers.deadline(1000), timers);
    expect(timers.sleeps).toEqual([28_000]);
    expect(lastOf(dir)).toBe('2026-10-18T05:00:56.000Z');
  });
  it('with spacing 0 a start recorded ahead of now is no wait either', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const dir = tmpDir();
    writeFileSync(join(dir, 'pacer.json'), JSON.stringify({ lastPageAt: '2026-10-18T05:10:00.000Z' }), {
      mode: 0o600,
    });
    const p = new Pacer({ dir, minSpacingSeconds: 0, clock: timers.clock });
    await p.reclaim(timers.deadline(1000), timers);
    expect(timers.sleeps).toEqual([]);
    expect(lastOf(dir)).toBe(T0);
  });
  it('the refusal names the spacing', async () => {
    const timers = fakeTimers(fixedClock(T0));
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock: timers.clock });
    p.claim();
    await expect(p.reclaim(timers.deadline(10_000), timers)).rejects.toThrow(
      'the spacing outlasts the step budget',
    );
  });
  it('exposes its spacing, read-only, for the page’s budget (preflight P6)', () => {
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 45, clock: fixedClock(T0) });
    expect(p.spacingMs).toBe(45_000);
  });
});

// why: CAMOUFOX_PAGES_AT_ONCE: the worker's one pacer serves that many pages at once, its spacing still start to start
// across all of them
describe('Pacer with a capacity', () => {
  it('with spacing 0, passes up to its capacity at once and refuses the next until one is released', () => {
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 0, clock: fixedClock(T0), capacity: 3 });
    for (let i = 0; i < 3; i++) {
      expect(p.isBusy()).toBe(false);
      expect(p.claim()).toEqual({ ok: true });
    }
    expect(p.isBusy()).toBe(true);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
    p.release();
    expect(p.isBusy()).toBe(false);
    expect(p.claim()).toEqual({ ok: true });
  });
  it('with a spacing, a second page may start only once the spacing has passed since the first one’s start', () => {
    const clock = fixedClock(T0);
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 30, clock, capacity: 2 });
    expect(p.claim()).toEqual({ ok: true });
    clock.advance(10_000);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 18 });
    clock.advance(18_000);
    expect(p.claim()).toEqual({ ok: true });
    // why: both pages are in flight: the capacity refuses, with the spacing as its wait
    clock.advance(60_000);
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 30 });
  });
  it('a release with nothing claimed never frees more than the capacity', () => {
    const p = new Pacer({ dir: tmpDir(), minSpacingSeconds: 0, clock: fixedClock(T0), capacity: 1 });
    p.release();
    expect(p.claim()).toEqual({ ok: true });
    expect(p.claim()).toEqual({ ok: false, retryAfterSeconds: 1 });
  });
  it.each([0, -1, 1.5])('refuses a capacity of %s', (capacity) => {
    expect(() => new Pacer({ dir: tmpDir(), minSpacingSeconds: 0, clock: fixedClock(T0), capacity })).toThrow(
      /capacity/,
    );
  });
});
