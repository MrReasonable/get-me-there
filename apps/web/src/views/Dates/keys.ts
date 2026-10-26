import { addDays, type IsoDate, monthOf } from '@gmt/core';
import { monthDays, weekdayIndex } from '../../format.js';
import type { Column } from './overview.js';

// Keyboard targets (moved from the Calendar view's grid, WP19 §4; the Calendar grid reads targetOf until Task 19.8
// removes it), and the Dates overview's moves. Pure, apart from the components (review arch M3); Stryker runs it.

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** The same day of the month before or after, clamped to that month's length (PageUp / PageDown). */
export function sameDayOtherMonth(date: IsoDate, delta: -1 | 1): IsoDate {
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

// --- The Dates overview's keys (spec §11 Overview "Keyboard"; WP19 Task 19.5) ---

/** A cell of the overview: its departure day and its column, named by the first stay length it holds. */
export interface Pos {
  date: IsoDate;
  from: number;
}

/** What the keys read of the overview: each drawn day's columns (bands folded or one open), and which days are drawn. */
export interface Layout {
  columns(date: IsoDate): readonly Column[];
  has(date: IsoDate): boolean;
}

/** The column of `columns` holding `nights` (a band or a single stay), else the nearest end. */
function columnHolding(columns: readonly Column[], nights: number): Column | undefined {
  return (
    columns.find((c) => c.from <= nights && nights <= c.to) ??
    (nights < (columns[0]?.from ?? 0) ? columns[0] : columns[columns.length - 1])
  );
}

/** The same stay on another day, when that day is drawn. */
function onDay(layout: Layout, date: IsoDate, nights: number): Pos | null {
  if (!layout.has(date)) return null;
  const c = columnHolding(layout.columns(date), nights);
  return c === undefined ? null : { date, from: c.from };
}

/**
 * Where a key moves the overview's one tab stop (roving tabindex): Left and Right through reading order (the day's
 * stay lengths, then the next day's), Up and Down the same stay a week earlier or later, PageUp and PageDown the same
 * day of the month before or after (clamped as `sameDayOtherMonth` does), Home and End the day's first and last cell.
 * Null for any other key, and when the target is not drawn (focus then stays put).
 */
export function moveTo(pos: Pos, key: string, layout: Layout): Pos | null {
  const cols = layout.columns(pos.date);
  const i = cols.findIndex((c) => c.from === pos.from);
  if (i < 0) return null;
  switch (key) {
    case 'ArrowRight': {
      const next = cols[i + 1];
      if (next !== undefined) return { date: pos.date, from: next.from };
      const day = addDays(pos.date, 1);
      const first = layout.has(day) ? layout.columns(day)[0] : undefined;
      return first === undefined ? null : { date: day, from: first.from };
    }
    case 'ArrowLeft': {
      const prev = cols[i - 1];
      if (prev !== undefined) return { date: pos.date, from: prev.from };
      const day = addDays(pos.date, -1);
      const theirs = layout.has(day) ? layout.columns(day) : [];
      const last = theirs[theirs.length - 1];
      return last === undefined ? null : { date: day, from: last.from };
    }
    case 'ArrowUp':
      return onDay(layout, addDays(pos.date, -7), pos.from);
    case 'ArrowDown':
      return onDay(layout, addDays(pos.date, 7), pos.from);
    case 'PageUp':
      return onDay(layout, sameDayOtherMonth(pos.date, -1), pos.from);
    case 'PageDown':
      return onDay(layout, sameDayOtherMonth(pos.date, 1), pos.from);
    case 'Home': {
      const first = cols[0];
      return first === undefined ? null : { date: pos.date, from: first.from };
    }
    case 'End': {
      const last = cols[cols.length - 1];
      return last === undefined ? null : { date: pos.date, from: last.from };
    }
    default:
      return null;
  }
}
