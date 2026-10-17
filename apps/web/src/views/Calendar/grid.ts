import { addDays, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { monthDays, weekdayIndex } from '../../format.js';

// Pure calendar-grid logic (weeks of a month, keyboard targets), apart from the component so the view-model coverage
// floor covers it (review arch M3).

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Monday-first weeks of one month, null for padding. */
export function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const dates = monthDays(month);
  const first = dates[0];
  const cells: Array<IsoDate | null> =
    first === undefined ? [] : Array.from({ length: weekdayIndex(first) }, () => null);
  cells.push(...dates);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<IsoDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The same day of the month before or after, clamped to that month's length (PageUp / PageDown). */
function sameDayOtherMonth(date: IsoDate, delta: -1 | 1): IsoDate {
  const own = monthDays(monthOf(date));
  const edge = delta === -1 ? own[0] : own[own.length - 1];
  const other = monthDays(monthOf(addDays(edge ?? date, delta)));
  const index = Math.min(own.indexOf(date), other.length - 1);
  return other[index] ?? date;
}

/** The date a navigation key moves focus to, or null for any other key (APG grid pattern). */
export function targetOf(date: IsoDate, key: string): IsoDate | null {
  const step = STEPS[key];
  if (step !== undefined) return addDays(date, step);
  if (key === 'Home') return addDays(date, -weekdayIndex(date));
  if (key === 'End') return addDays(date, 6 - weekdayIndex(date));
  if (key === 'PageUp') return sameDayOtherMonth(date, -1);
  if (key === 'PageDown') return sameDayOtherMonth(date, 1);
  return null;
}
