import { isValidTimeZone } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  countFirings,
  firingsBetween,
  parseCron,
  previousFiring,
  runsPerMonth,
} from '../src/scheduler/parseCron.js';

const next = (expr: string, tz: string, from: string) => {
  const p = parseCron(expr, tz);
  if (!p.ok) throw new Error(p.reason);
  return p.next(new Date(from))?.toISOString() ?? null;
};
const reason = (expr: string, tz = 'Europe/London') => {
  const p = parseCron(expr, tz);
  return p.ok ? null : p.reason;
};
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

describe('parseCron (spec §8.2: the sole semantic validator; sub-hourly rejected; tz validated)', () => {
  it('evaluates in the schedule tz across both UK DST changes', () => {
    expect(next('0 5 * * 1', 'Europe/London', '2027-03-28T12:00:00.000Z')).toBe('2027-03-29T04:00:00.000Z'); // 05:00 BST
    expect(next('0 5 * * 1', 'Europe/London', '2026-10-24T12:00:00.000Z')).toBe('2026-10-26T05:00:00.000Z'); // 05:00 GMT
    expect(next('0 5 * * 1', 'America/New_York', '2026-10-14T09:00:00.000Z')).toBe(
      '2026-10-19T09:00:00.000Z',
    ); // 05:00 EDT
  });
  it('a wall time inside the spring-forward gap fires once, at the later instant; a fall-back overlap fires once (library note)', () => {
    expect(
      iso(
        firingsBetween(
          '30 1 * * *',
          'Europe/London',
          new Date('2027-03-27T00:00:00.000Z'),
          new Date('2027-03-29T23:59:00.000Z'),
        ),
      ),
    ).toEqual([
      '2027-03-27T01:30:00.000Z', // 01:30 GMT
      '2027-03-28T01:30:00.000Z', // 01:30 does not exist; 02:30 BST
      '2027-03-29T00:30:00.000Z', // 01:30 BST
    ]);
    expect(
      iso(
        firingsBetween(
          '30 1 * * *',
          'Europe/London',
          new Date('2026-10-24T00:00:00.000Z'),
          new Date('2026-10-26T23:59:00.000Z'),
        ),
      ),
    ).toEqual([
      '2026-10-24T00:30:00.000Z', // 01:30 BST
      '2026-10-25T00:30:00.000Z', // 01:30 happens twice; the first (BST) only
      '2026-10-26T01:30:00.000Z', // 01:30 GMT
    ]);
  });
  it('accepts hourly and slower', () => {
    expect(reason('15 * * * *')).toBeNull();
    expect(reason('0 5 1 * *')).toBeNull();
  });
  it.each([
    ['*/15 * * * *', 'at most once an hour'],
    ['0,30 5 * * *', 'at most once an hour'],
    ['* 5 * * *', 'at most once an hour'],
    ['61 5 * * *', 'at most once an hour'],
    ['0 5 * *', 'five fields'],
    ['0 0 5 * * 1', 'five fields'],
    ['0 25 * * *', 'not a valid schedule'],
  ])('rejects %s', (expr, why) => {
    expect(reason(expr)).toContain(why);
  });
  it('rejects an unknown time zone', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(reason('0 5 * * 1', 'Mars/Olympus')).toBe('unknown time zone "Mars/Olympus"');
  });
});

describe('previousFiring and runsPerMonth', () => {
  it('finds the last scheduled firing before an instant (spec §8.2 skipped_missed)', () => {
    expect(
      previousFiring('0 5 * * 1', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))?.toISOString(),
    ).toBe('2026-10-12T04:00:00.000Z');
    expect(previousFiring('*/5 * * * *', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))).toBeNull();
  });
  it('is firings over the next 365 days ÷ 12, unrounded (ruling 12: weekly ≈ 4.33, as the spec §8.2 cadence table)', () => {
    const from = new Date('2026-10-14T09:00:00.000Z');
    expect(runsPerMonth('0 5 * * 1', 'Europe/London', from)).toBe(52 / 12);
    expect(runsPerMonth('0 6 * * *', 'Europe/London', from)).toBe(365 / 12);
    expect(runsPerMonth(null, 'Europe/London', from)).toBe(0);
    expect(runsPerMonth('*/5 * * * *', 'Europe/London', from)).toBe(0);
  });
});

describe('countFirings (review S11): firingsBetween’s count without stepping croner’s zone conversion through every firing', () => {
  const DAY = 86_400_000;
  const YEAR = 365 * DAY;
  // why: stepping an hourly year through croner's zone conversion (the comparison side) takes over a second, so the
  // hourly cases compare 40 days around a clock change; the others compare a whole year
  const CASES: Array<[string, string, string, number?]> = [
    ['0 * * * *', 'Europe/London', '2026-10-10T09:00:00.000Z', 40 * DAY],
    ['0 * * * *', 'America/New_York', '2027-02-20T00:00:00.000Z', 40 * DAY],
    ['30 1 * * *', 'Europe/London', '2027-01-01T00:00:00.000Z'],
    ['0 1 * * *', 'Europe/London', '2026-10-14T09:00:00.000Z'],
    ['15 2 * * 0', 'America/New_York', '2026-10-14T09:00:00.000Z'],
    ['0 9-17 * * 1-5', 'Europe/London', '2026-10-14T09:00:00.000Z'],
    ['0 6 1 * *', 'Europe/London', '2026-10-14T09:00:00.000Z'],
    ['0 6 1,15 * 1', 'Europe/London', '2026-10-14T09:00:00.000Z'],
    ['0 * * 1 *', 'Europe/London', '2026-10-14T09:00:00.000Z'],
    ['45 * * * *', 'Australia/Lord_Howe', '2027-03-20T09:00:00.000Z', 40 * DAY],
    ['0 */3 * * *', 'Asia/Kathmandu', '2026-10-14T09:00:00.000Z'],
    ['0 0 29 2 *', 'UTC', '2026-10-14T09:00:00.000Z'],
    ['0 5 * * 1', 'Europe/London', '2026-10-14T09:00:00.000Z'],
  ];
  it.each(CASES)('%s in %s from %s: the same count as stepping every firing', (expr, tz, from, span) => {
    const f = new Date(Date.parse(from) + 1);
    const t = new Date(Date.parse(from) + (span ?? YEAR));
    expect(countFirings(expr, tz, f, t)).toBe(firingsBetween(expr, tz, f, t).length);
  });

  it('counts both ends inclusively, a part day and an empty or reversed range, as firingsBetween does', () => {
    const at = (s: string) => new Date(s);
    for (const [f, t] of [
      ['2026-10-14T09:00:00.000Z', '2026-10-14T09:00:00.000Z'],
      ['2026-10-14T09:00:00.001Z', '2026-10-14T11:00:00.000Z'],
      ['2026-10-25T00:00:00.000Z', '2026-10-25T03:00:00.000Z'],
      ['2026-10-14T12:00:00.000Z', '2026-10-14T09:00:00.000Z'],
    ] as const)
      expect(countFirings('0 * * * *', 'Europe/London', at(f), at(t))).toBe(
        firingsBetween('0 * * * *', 'Europe/London', at(f), at(t)).length,
      );
    expect(
      countFirings(
        '*/5 * * * *',
        'Europe/London',
        at('2026-10-14T09:00:00.000Z'),
        at('2027-10-14T09:00:00.000Z'),
      ),
    ).toBe(0);
  });

  it('an hourly year is counted in fewer than two croner steps a day, never one a firing (T4: the work is bounded, not timed)', () => {
    const meter = { steps: 0 };
    const from = new Date('2026-10-14T09:00:00.001Z');
    const n = countFirings(
      '0 * * * *',
      'Europe/London',
      from,
      new Date(from.getTime() + 365 * 86_400_000),
      meter,
    );
    expect(n).toBe(8759); // a year of hours, less the fall-back hour croner fires once (pinned above)
    // why: one step a matching day, plus each offset span's first whole day and its part days stepped firing by firing,
    // and the 6 h round each clock change: under two a day, against the 8,759 a firing-by-firing count takes
    expect(meter.steps).toBeLessThan(2 * 365);
    expect(meter.steps).toBeGreaterThanOrEqual(365); // at least one step a matching day: the meter counts every step
    expect(runsPerMonth('0 * * * *', 'Europe/London', new Date('2026-10-14T09:00:00.000Z'))).toBe(8759 / 12);
  });
});

describe('countFirings against the stepped count, seeded (review T2)', () => {
  /** mulberry32: a fixed seed gives the same cases on every run. */
  function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }
  // why: zones with a half-hour change (Lord Howe), a 45-minute offset (Chatham), two changes a year (Casablanca's
  // Ramadan), a two-hour change (Troll), southern-hemisphere summer time (Sydney, Santiago), and northern ones
  const ZONES = [
    'Australia/Lord_Howe',
    'Pacific/Chatham',
    'Africa/Casablanca',
    'Antarctica/Troll',
    'Australia/Sydney',
    'America/Santiago',
    'America/New_York',
    'Europe/London',
    'Asia/Kathmandu',
    'UTC',
  ] as const;
  const DAY = 86_400_000;
  const rnd = seeded(20261024);
  const pick = <T>(xs: readonly [T, ...T[]]): T => xs[Math.floor(rnd() * xs.length)] ?? xs[0];
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const cases: Array<[string, string, string, number]> = [];
  for (let i = 0; i < 40; i++) {
    const zone = ZONES[i % ZONES.length] ?? 'UTC';
    const hourly = i % 8 === 7;
    const hour = hourly
      ? '*'
      : pick([String(int(0, 23)), `${int(0, 11)},${int(12, 23)}`, '1-3', '2', '0,2,4']);
    const dom = pick(['*', '*', String(int(1, 28)), '1,15']);
    const dow = pick(['*', '*', '1-5', String(int(0, 6))]);
    const month = pick(['*', '*', '*', `${int(1, 6)},${int(7, 12)}`]);
    const expr = `${pick([0, 15, 30, 45, int(0, 59)])} ${hour} ${dom} ${month} ${dow}`;
    const start = Date.parse('2026-06-01T00:00:00.000Z') + int(0, 400) * DAY + int(0, 86_399) * 1000;
    // why: an hourly schedule's stepped side takes over a second for a year, so it compares 30 days
    cases.push([expr, zone, new Date(start).toISOString(), hourly ? 30 * DAY : 365 * DAY]);
  }
  // pinned: hourly across New York's November change, a daily 02:30 inside Sydney's changes, Casablanca and Troll's year
  cases.push(
    ['0 * * * *', 'America/New_York', '2026-10-20T04:00:00.000Z', 30 * DAY],
    ['30 2 * * *', 'Australia/Sydney', '2026-06-01T00:00:00.000Z', 365 * DAY],
    ['0 2 * * *', 'Africa/Casablanca', '2026-06-01T00:00:00.000Z', 365 * DAY],
    ['15 1 * * *', 'Antarctica/Troll', '2026-06-01T00:00:00.000Z', 365 * DAY],
    ['45 2 * * 0', 'Pacific/Chatham', '2026-06-01T00:00:00.000Z', 365 * DAY],
  );
  it.each(cases)(
    '%s in %s from %s over %d ms: the same count as stepping every firing',
    (expr, tz, from, span) => {
      const f = new Date(Date.parse(from) + 1);
      const t = new Date(Date.parse(from) + span);
      expect(countFirings(expr, tz, f, t)).toBe(firingsBetween(expr, tz, f, t).length);
    },
  );
});

describe('the cron text a count and a parse accept (review T2 kills)', () => {
  it('minute 59 is the last a schedule takes; spaces around and between the fields are ignored alike', () => {
    expect(parseCron('59 * * * *', 'Europe/London').ok).toBe(true);
    expect(parseCron('60 * * * *', 'Europe/London').ok).toBe(false);
    const from = new Date('2026-10-14T09:00:00.000Z');
    expect(next('  0  6 * * 1 ', 'Europe/London', from.toISOString())).toBe(
      next('0 6 * * 1', 'Europe/London', from.toISOString()),
    );
    const to = new Date(from.getTime() + 60 * 86_400_000);
    expect(countFirings('  0  6 * * 1 ', 'Europe/London', from, to)).toBe(
      countFirings('0 6 * * 1', 'Europe/London', from, to),
    );
    expect(countFirings('  0  6 * * 1 ', 'Europe/London', from, to)).toBe(8); // Mondays 19 Oct to 7 Dec 2026
  });
  it('an invalid schedule has no firings to list or count', () => {
    const from = new Date('2026-10-14T09:00:00.000Z');
    const to = new Date('2026-12-14T09:00:00.000Z');
    expect(firingsBetween('*/5 * * * *', 'Europe/London', from, to)).toEqual([]);
    expect(countFirings('0 6 * * *', 'No/Such_Zone', from, to)).toBe(0);
  });
});
