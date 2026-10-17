import { isValidTimeZone } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { firingsBetween, parseCron, previousFiring, runsPerMonth } from '../src/scheduler/parseCron.js';

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
