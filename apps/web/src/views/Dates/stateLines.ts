import {
  asIsoDate,
  type DatePair,
  datePairSearched,
  type ExecutionStatus,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  reducedMark,
  STOPPED_STATUSES,
  toEpochDay,
} from '@gmt/core';
import type { ExecutionResponse } from '../../api/types.js';
import { isChecking, type RunProgressRun } from '../../components/RunProgress.js';
import type { COPY } from '../../copy.js';
import { formatIsoDateShort, londonParts } from '../../format.js';
import { readingCount } from '../../lib/flightsReading.js';
import { instantMs } from '../../lib/time.js';

// Design 2026-11-08 §5 (mockup 02), Rulings 6, 7 and 11: a search's page's run line and state, and the one form of a
// flight-read instant, as pure functions of the page's reads and its clock. Every word is a COPY template (passed in, so
// the catalogue and the rendered sweep cover them), every count of a date pair is core's (`reducedMark`,
// `datePairSearched`), and every instant is worded in London time, the app's reference zone (spec §6.1), from epoch
// milliseconds (no Date is built here).

/** The catalogue the lines are composed from: the app's one `COPY`. */
export type PageCopy = typeof COPY;

const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const STOPPED: ReadonlySet<string> = new Set(STOPPED_STATUSES);

/**
 * How many date pairs were searched: core's one predicate, `datePairSearched` (spec rev 55 §6.6), the count behind the
 * progress bar, as the cards count it.
 */
export function searchedCount(pairs: readonly DatePair[]): number {
  let n = 0;
  for (const p of pairs) if (datePairSearched(p.buckets)) n += 1;
  return n;
}

/** How many date pairs have a calendar price: core's `reducedMark` reads `priced` (the cards' `marks.priced`). */
export function pricedCount(pairs: readonly DatePair[]): number {
  let n = 0;
  for (const p of pairs) if (reducedMark(p.buckets) === 'priced') n += 1;
  return n;
}

/** A whole search's date pairs and how many of them were searched (the card's counts, or a read's every pair). */
export interface WholeCount {
  searched: number;
  total: number;
}

/** The whole-search count of `pairs`: core's `datePairSearched` over them, of their number. */
export function wholeOf(pairs: readonly DatePair[]): WholeCount {
  return { searched: searchedCount(pairs), total: pairs.length };
}

/**
 * The fares a run checking them has checked (final review M1): over its verification progress, the date pairs to check
 * are those not left out (`skipped`), and those done are the ones no longer waiting (`not_run`). A total of 0 when the
 * run counts none.
 */
export function checksOf(run: ExecutionResponse): { done: number; total: number } {
  let total = 0;
  let waiting = 0;
  for (const p of run.progress) {
    if (p.stage !== 'verification') continue;
    total += p.total - p.buckets.skipped;
    waiting += p.buckets.not_run;
  }
  return total <= 0 ? { done: 0, total: 0 } : { done: Math.max(0, total - waiting), total };
}

/**
 * Ruling 11: the page's latest run as `RunProgress` shows it, the card's adapter's rules over the execution read: the
 * calendar pass counts the whole search (`whole`, never a filter's scope), the flights line only once the run is reading
 * them (`readingCount`, as the card), and an active one-date child run's status.
 */
export function runProgressFor(
  run: ExecutionResponse,
  whole: WholeCount,
  childRun: ExecutionStatus | null,
): RunProgressRun {
  return {
    id: run.id,
    status: run.status,
    done: whole.searched,
    total: whole.total,
    estimatedFinishAt: run.estimatedFinishAt,
    flightsRead: run.status === 'running' ? readingCount(run.flights) : null,
    checking: isChecking(run) ? checksOf(run) : null,
    stop: run.stop,
    resumeAfter: run.resumeAfter,
    childRun,
  };
}

/** The London date and time of an instant, and how many London days it is before `now` (0 today, 1 yesterday). */
function when(at: IsoDateTime, now: IsoDateTime): { date: string; time: string; daysAgo: number } {
  const a = londonParts(instantMs(at));
  const n = londonParts(instantMs(now));
  return { ...a, daysAgo: toEpochDay(asIsoDate(n.date)) - toEpochDay(asIsoDate(a.date)) };
}

/** How many London days `at` is before `now`: 0 today, 1 yesterday (the day word `readAt` picks by). */
export function londonDaysAgo(at: IsoDateTime, now: IsoDateTime): number {
  return when(at, now).daysAgo;
}

/** "today", "yesterday", else the day and month ("12 Mar"). */
function dayWord(daysAgo: number, date: string, c: PageCopy): string {
  if (daysAgo === 0) return c.searchPage.today;
  if (daysAgo === 1) return c.searchPage.yesterday;
  return formatIsoDateShort(date);
}

/**
 * Spec rev 55 §11: the one form of every flight-read instant on a search's page: "11:44" today, "yesterday 11:44", else
 * "12 Mar 11:44" (London).
 */
export function readAt(fetchedAt: IsoDateTime, now: IsoDateTime, c: PageCopy): string {
  const w = when(fetchedAt, now);
  return w.daysAgo === 0 ? w.time : c.searchPage.dayTime(dayWord(w.daysAgo, w.date, c), w.time);
}

/** "today 09:12–11:41", "yesterday 23:10–today 01:40", "today from 09:12". */
function timeSpan(start: IsoDateTime, end: IsoDateTime | null, now: IsoDateTime, c: PageCopy): string {
  const P = c.searchPage;
  const s = when(start, now);
  const day = dayWord(s.daysAgo, s.date, c);
  if (end === null) return P.dayTime(day, P.fromOnly(s.time));
  const e = when(end, now);
  const to = e.date === s.date ? e.time : P.dayTime(dayWord(e.daysAgo, e.date, c), e.time);
  return P.dayTime(day, P.span(s.time, to));
}

/**
 * Mockup 02's run line, before its "what was searched" link: "Searched today 16:40–17:02 · calendar prices for 2,146 of
 * 2,184 dates · 23 dates with flights read". Its day is "today", "yesterday" or the date ("12 Mar"); a run that ended on
 * a later day names that day at its end; a run with no end yet (a stopped one) names its start ("from 09:12"). The
 * calendar counts are the latest run's over the whole search (Ruling 7's `marks`); the flights clause counts the dates
 * in view whose flights were read by any search so far (Ruling 6), so it is a total, never the run's own.
 */
export function runLine(d: {
  run: { startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null };
  calendar: { priced: number; total: number };
  readDates: number;
  now: IsoDateTime;
  c: PageCopy;
}): string {
  const P = d.c.searchPage;
  const head = d.run.startedAt === null ? null : timeSpan(d.run.startedAt, d.run.finishedAt, d.now, d.c);
  return [
    ...(head === null ? [] : [P.searched(head)]),
    P.calendarPrices(d.calendar.priced, d.calendar.total),
    P.datesWithFlightsRead(d.readDates),
  ].join(' · ');
}

/** The state a search's page is in (spec rev 55 §11 "State line"); the running and stopped ones are `RunProgress`'s. */
export type StateLine =
  | { kind: 'never'; text: string; fix?: string }
  | { kind: 'changed'; text: string }
  | { kind: 'searching' | 'reading' | 'checking' | 'stopped' | 'searched' };

/**
 * Spec rev 55 §11 "State line", what the page says about its latest parent run beyond the run line and `RunProgress`:
 *
 * - *never*: no run ("Not searched yet"), or a search naming no source ("No price source is set up, so nothing was
 *   searched" with its fix), from its own data (Review Focus 1).
 * - *searching*, *reading* (its flight step, `readingCount`, the card's rule), *checking* (itinerary search): pending or
 *   running.
 * - *stopped*: a stopped or skipped status.
 * - *changed*: a completed run of an earlier space ("Dates changed since this was last searched", count-free, ruling
 *   20.3 R-changed); `spaceChanged` is the api's own judgement (the card's `spaceChangedSince`).
 * - *searched*: a completed run.
 */
export function stateLine(d: {
  latest: ExecutionResponse | null;
  spaceChanged: boolean;
  /** The search names no price source at all (no discovery and no verification provider). */
  noSource: boolean;
  c: PageCopy;
}): StateLine {
  const P = d.c.searchPage;
  const run = d.latest;
  if (run === null) {
    return d.noSource
      ? { kind: 'never', text: P.noSource, fix: P.noSourceFix }
      : { kind: 'never', text: P.notSearchedYet };
  }
  if (IN_FLIGHT.has(run.status)) {
    if (isChecking(run)) return { kind: 'checking' };
    if (run.status === 'running' && readingCount(run.flights) !== null) return { kind: 'reading' };
    return { kind: 'searching' };
  }
  if (STOPPED.has(run.status)) return { kind: 'stopped' };
  if (run.startedAt === null) return { kind: 'never', text: P.notSearchedYet };
  if (d.spaceChanged) return { kind: 'changed', text: d.c.searchesView.datesChanged };
  return { kind: 'searched' };
}
