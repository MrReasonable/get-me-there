import type { WindowSpec } from '../types/definition.js';

/**
 * A search's dates in words, one set for every reader (the Trips card, the search page's header and the Status data
 * check). Every date is formatted from its `YYYY-MM-DD` string by slicing, never through a `Date`, so no time zone can
 * shift a day.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "2027-03-14" → "14 Mar 2027"; anything malformed is returned as given. */
export function dateWords(d: string): string {
  const [y, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (y === undefined || day === undefined || month === undefined) return d;
  return `${Number(day)} ${month} ${y}`;
}

/** "2027-03-14" → "14 Mar", without the year; anything malformed is returned as given. */
export function dateWordsShort(d: string): string {
  const [, m, day] = d.split('-');
  const month = MONTHS[Number(m) - 1];
  if (day === undefined || month === undefined) return d;
  return `${Number(day)} ${month}`;
}

/** "10 Jan – 31 Mar", or "10 Dec 2026 – 31 Mar 2027" when the two dates fall in different years. */
export function windowSpanWords(from: string, to: string): string {
  const format = from.slice(0, 4) === to.slice(0, 4) ? dateWordsShort : dateWords;
  return `${format(from)} – ${format(to)}`;
}

/** A fixed window: "leave 10 Jan – 31 Mar". */
export const leaveWords = (span: string): string => `leave ${span}`;

/** A relative window: "rolling: 182 days from 7 days ahead". */
export const rollingDaysWords = (lengthDays: number, startOffsetDays: number): string =>
  `rolling: ${plural(lengthDays, 'day', 'days')} from ${plural(startOffsetDays, 'day', 'days')} ahead`;

/** A months window: "rolling: 3 months from 14 days ahead". */
export const rollingMonthsWords = (lengthMonths: number, startOffsetDays: number): string =>
  `rolling: ${plural(lengthMonths, 'month', 'months')} from ${plural(startOffsetDays, 'day', 'days')} ahead`;

/** A search's window as the Trips card words it: a fixed window's own dates, a rolling one's offset and length. */
export function windowWords(w: WindowSpec): string {
  switch (w.kind) {
    case 'absolute':
      return leaveWords(windowSpanWords(w.from, w.to));
    case 'relative':
      return rollingDaysWords(w.lengthDays, w.startOffsetDays);
    case 'months':
      return rollingMonthsWords(w.lengthMonths, w.startOffsetDays);
  }
}
