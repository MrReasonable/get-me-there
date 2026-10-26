// The schedule picker's model: cron ↔ a human schedule, and its plain reading (set-up polish, critique heuristic 2).
import { describe, expect, it } from 'vitest';
import { joinHoursMinutes, splitMinutes } from '../../../src/views/Definitions/hoursMinutes.js';
import {
  describeSchedule,
  parseSchedule,
  type Schedule,
  scheduleToCron,
  switchSchedule,
} from '../../../src/views/Definitions/schedule.js';

describe('schedule ↔ cron', () => {
  it.each<[string | null, Schedule]>([
    [null, { kind: 'none' }],
    ['', { kind: 'none' }],
    ['0 5 * * 1', { kind: 'weekly', days: [1], time: '05:00' }],
    ['30 7 * * *', { kind: 'daily', time: '07:30' }],
    // Monday first, Sunday (0 or 7) last
    ['0 5 * * 0,1,4', { kind: 'weekly', days: [1, 4, 0], time: '05:00' }],
    ['0 5 * * 7', { kind: 'weekly', days: [0], time: '05:00' }],
    ['0 22 * * 1-5', { kind: 'weekly', days: [1, 2, 3, 4, 5], time: '22:00' }],
  ])('reads %j', (cron, schedule) => {
    expect(parseSchedule(cron)).toEqual(schedule);
  });

  it.each([
    '*/15 * * * *',
    '0 5 1 * *',
    '0 5 * 6 *',
    '0 5 * * 1/2',
    '0 24 * * 1',
    '60 5 * * 1',
    '0 5 * * 5-1',
    '0 5 * * 8',
    '0 0 5 * * 1',
  ])('keeps %j as a custom cron', (cron) => {
    expect(parseSchedule(cron)).toEqual({ kind: 'custom', cron });
  });

  it('every picked schedule round-trips through its cron', () => {
    const picked: Schedule[] = [
      { kind: 'none' },
      { kind: 'daily', time: '05:00' },
      { kind: 'daily', time: '23:59' },
      { kind: 'weekly', days: [1], time: '05:00' },
      { kind: 'weekly', days: [1, 4, 0], time: '00:05' },
      { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 0], time: '12:00' },
    ];
    for (const s of picked) expect(parseSchedule(scheduleToCron(s) ?? null)).toEqual(s);
    // why: cron lists days in number order; the picker's Monday-first order is only how they read.
    expect(scheduleToCron({ kind: 'weekly', days: [1, 4, 0], time: '05:00' })).toBe('0 5 * * 0,1,4');
    expect(scheduleToCron({ kind: 'custom', cron: '*/15 * * * *' })).toBe('*/15 * * * *');
    expect(scheduleToCron({ kind: 'custom', cron: '  ' })).toBeNull();
  });

  it('a weekly schedule with no day, or a time that is not HH:MM, has no cron to save', () => {
    expect(scheduleToCron({ kind: 'weekly', days: [], time: '05:00' })).toBeUndefined();
    expect(scheduleToCron({ kind: 'daily', time: '' })).toBeUndefined();
    expect(scheduleToCron({ kind: 'daily', time: '25:00' })).toBeUndefined();
  });

  it('switching mode keeps the time and days it can', () => {
    const weekly: Schedule = { kind: 'weekly', days: [2], time: '06:15' };
    expect(switchSchedule(weekly, 'daily', '15 6 * * 2')).toEqual({ kind: 'daily', time: '06:15' });
    expect(switchSchedule({ kind: 'daily', time: '06:15' }, 'weekly', '15 6 * * *')).toEqual({
      kind: 'weekly',
      days: [1],
      time: '06:15',
    });
    expect(switchSchedule({ kind: 'none' }, 'daily', null)).toEqual({ kind: 'daily', time: '05:00' });
    expect(switchSchedule(weekly, 'custom', '15 6 * * 2')).toEqual({ kind: 'custom', cron: '15 6 * * 2' });
    expect(switchSchedule(weekly, 'none', '15 6 * * 2')).toEqual({ kind: 'none' });
  });
});

describe('the plain reading of a schedule', () => {
  it.each<[string | null, string]>([
    ['0 5 * * 1', 'Mondays at 05:00 (Europe/London)'],
    ['0 5 * * 1,4', 'Mondays and Thursdays at 05:00 (Europe/London)'],
    ['0 5 * * 0,1,3', 'Mondays, Wednesdays and Sundays at 05:00 (Europe/London)'],
    ['0 5 * * 0-6', 'Every day at 05:00 (Europe/London)'],
    ['30 7 * * *', 'Every day at 07:30 (Europe/London)'],
    [null, 'No scheduled runs; start one with Run now.'],
    ['*/15 * * * *', 'On the cron schedule "*/15 * * * *" (Europe/London)'],
  ])('%j reads %j', (cron, text) => {
    expect(describeSchedule(cron, 'Europe/London')).toBe(text);
  });
});

describe('journey time in hours and minutes ↔ minutes', () => {
  it('splits stored minutes into the two boxes', () => {
    expect(splitMinutes(1500)).toEqual({ hours: '25', minutes: '0' });
    expect(splitMinutes(95)).toEqual({ hours: '1', minutes: '35' });
    expect(splitMinutes(undefined)).toEqual({ hours: '', minutes: '' });
  });
  it('joins the boxes back into minutes; blank both is "not set"', () => {
    expect(joinHoursMinutes('25', '0')).toEqual({ kind: 'value', minutes: 1500 });
    expect(joinHoursMinutes('20', '')).toEqual({ kind: 'value', minutes: 1200 });
    expect(joinHoursMinutes('', '45')).toEqual({ kind: 'value', minutes: 45 });
    expect(joinHoursMinutes(' 1 ', '35')).toEqual({ kind: 'value', minutes: 95 });
    expect(joinHoursMinutes('20', '75')).toEqual({ kind: 'value', minutes: 1275 });
    expect(joinHoursMinutes('', ' ')).toEqual({ kind: 'empty' });
    expect(joinHoursMinutes('2h', '')).toEqual({ kind: 'invalid' });
    expect(joinHoursMinutes('1', '-5')).toEqual({ kind: 'invalid' });
  });
  it('every whole number of minutes round-trips', () => {
    for (const m of [0, 1, 59, 60, 61, 1500, 2879]) {
      const { hours, minutes } = splitMinutes(m);
      expect(joinHoursMinutes(hours, minutes)).toEqual({ kind: 'value', minutes: m });
    }
  });
});
