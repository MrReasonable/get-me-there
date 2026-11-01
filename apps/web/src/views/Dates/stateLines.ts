import {
  asIsoDate,
  type DatePair,
  datePairSearched,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  mainPathSource,
  NO_STOP_CAUSE_TEXT,
  type ProviderId,
  reducedMark,
  STOPPED_STATUSES,
  toEpochDay,
} from '@gmt/core';
import type { ExecutionResponse } from '../../api/types.js';
import type { StopWords } from '../../components/StopWords.js';
import { listText } from '../../copy/setup.js';
import type { COPY } from '../../copy.js';
import { formatIsoDateShort, londonParts } from '../../format.js';
import { leftWords } from '../../lib/leftWords.js';
import { instantMs } from '../../lib/time.js';

// Spec rev 55 §3, §6.6 and §11 "A search's page" (WP20 Task 20.6): the page's header line and state lines, and the one
// form of a flight-read instant, as pure functions of the page's reads and its clock. Every word is a COPY template
// (passed in, so the catalogue and the rendered sweep cover them), every count of a date pair is core's `reducedMark`
// (so the header, the state lines, the cards and the month key count alike), and every instant is worded in London time,
// the app's reference zone (spec §6.1), from epoch milliseconds (no Date is built here).

/** The catalogue the lines are composed from: the app's one `COPY`. */
export type PageCopy = typeof COPY;

const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const STOPPED: ReadonlySet<string> = new Set(STOPPED_STATUSES);

/** A date pair's count by its five marks (spec rev 55 §6.6), over the pairs given. */
interface MarkTally {
  total: number;
  priced: number;
  noPriceShown: number;
  notSearched: number;
  notReached: number;
  couldntRead: number;
}

function tally(pairs: readonly DatePair[]): MarkTally {
  const t: MarkTally = {
    total: 0,
    priced: 0,
    noPriceShown: 0,
    notSearched: 0,
    notReached: 0,
    couldntRead: 0,
  };
  for (const p of pairs) {
    t.total += 1;
    switch (reducedMark(p.buckets)) {
      case 'priced':
        t.priced += 1;
        break;
      case 'no-price-shown':
        t.noPriceShown += 1;
        break;
      case 'not-searched':
        t.notSearched += 1;
        break;
      case 'not-reached':
        t.notReached += 1;
        break;
      case 'couldnt-read':
        t.couldntRead += 1;
        break;
    }
  }
  return t;
}

/**
 * Spec rev 55 §11 header line, its counts: "300 of 405 date pairs priced, 20 showed no price, 60 not searched, 20 not
 * reached, 5 couldn't be read". The priced head always stays (it carries the total); every other clause at zero is left
 * out. Each date pair is counted once, by core's `reducedMark` over its airport pairs in scope.
 */
export function countsClauses(pairs: readonly DatePair[], c: PageCopy): string {
  const P = c.searchPage;
  const t = tally(pairs);
  return [
    P.pricedOf(t.priced, t.total),
    ...(t.noPriceShown > 0 ? [P.noPriceShown(t.noPriceShown)] : []),
    ...(t.notSearched > 0 ? [P.notSearched(t.notSearched)] : []),
    ...(t.notReached > 0 ? [P.notReached(t.notReached)] : []),
    ...(t.couldntRead > 0 ? [P.couldntRead(t.couldntRead)] : []),
  ].join(', ');
}

/**
 * How many date pairs were searched: core's one predicate, `datePairSearched` (spec rev 55 §6.6), the count behind the
 * progress line, the stopped line's "0 of 405 searched", the cards and the month key alike.
 */
export function searchedCount(pairs: readonly DatePair[]): number {
  let n = 0;
  for (const p of pairs) if (datePairSearched(p.buckets)) n += 1;
  return n;
}

/**
 * Spec rev 55 §3: "the six buckets under the count": the airport pairs' own buckets beneath a line that counts date
 * pairs by their marks ("by airport pair: 11 priced, 4 no fares, 1 error"), so an error that a date pair's mark hides
 * (one airport pair in error, another not searched, reads not searched) stays in view. Zero buckets are left out.
 */
export function bucketsUnder(pairs: readonly DatePair[], c: PageCopy): string {
  const b = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0 };
  for (const p of pairs) {
    b.priced += p.buckets.priced;
    b.empty += p.buckets.empty;
    b.no_data += p.buckets.no_data;
    b.error += p.buckets.error;
    b.skipped += p.buckets.skipped;
    b.not_run += p.buckets.not_run;
  }
  return c.datesView.overview.buckets(c.bucketBreakdown(b));
}

/**
 * The date pairs whose result came, in part, from an earlier run: any of their airport pairs reused an earlier run's
 * outcome (`buckets.reused`, which counts inside its bucket and decides no mark). The header's "(R reused from earlier
 * runs)", spec rev 55 §3.
 */
export function reusedDatePairs(pairs: readonly DatePair[]): number {
  let n = 0;
  for (const p of pairs) if (p.buckets.reused > 0) n += 1;
  return n;
}

/**
 * The sources a run used, from its own outcomes: each provider with an answered or failed outcome in any stage (a cell
 * priced, empty, without data or in error; skipped and not-run cells were never asked), in progress order, once each.
 * The header names them by core's main-path table ("the browser worker"). None while the run read is not in.
 */
export function runSources(run: ExecutionResponse | undefined): ProviderId[] {
  const out: ProviderId[] = [];
  for (const p of run?.progress ?? []) {
    const b = p.buckets;
    if (b.priced + b.empty + b.no_data + b.error > 0 && !out.includes(p.providerId)) out.push(p.providerId);
  }
  return out;
}

/** The London date and time of an instant, and how many London days it is before `now` (0 today, 1 yesterday). */
function when(at: IsoDateTime, now: IsoDateTime): { date: string; time: string; daysAgo: number } {
  const a = londonParts(instantMs(at));
  const n = londonParts(instantMs(now));
  return { ...a, daysAgo: toEpochDay(asIsoDate(n.date)) - toEpochDay(asIsoDate(a.date)) };
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

/**
 * Spec rev 55 §11 "Header": one plain line from the latest parent run's buckets, by core's reading of a date pair:
 * "Searched today 09:12–11:41 · 300 of 405 date pairs priced, 20 showed no price, 60 not searched, 20 not reached, 5
 * couldn't be read (120 reused from earlier runs) · the browser worker". Its day is "today", "yesterday" or the date
 * ("12 Mar"); a run that ended on a later day names that day at its end ("yesterday 23:10–today 01:40"); a run with no
 * end yet (a stopped one) names its start ("from 09:12"). Sources are joined in words; with none named the clause is
 * left out. It never says "all" or "every": the counts say how far it got.
 */
export function searchedLine(d: {
  run: { startedAt: IsoDateTime | null; finishedAt: IsoDateTime | null };
  pairs: readonly DatePair[];
  providers: readonly ProviderId[];
  reused: number;
  now: IsoDateTime;
  c: PageCopy;
}): string {
  const P = d.c.searchPage;
  const head = d.run.startedAt === null ? null : timeSpan(d.run.startedAt, d.run.finishedAt, d.now, d.c);
  const counts = countsClauses(d.pairs, d.c);
  return [
    ...(head === null ? [] : [P.searched(head)]),
    d.reused > 0 ? `${counts} ${P.reused(d.reused)}` : counts,
    ...(d.providers.length > 0 ? [listText(d.providers.map(mainPathSource))] : []),
  ].join(' · ');
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

/** The flight step's counts as the execution read gives them (spec rev 55 §10 `flights`), or null without a plan. */
type Flights = ExecutionResponse['flights'];

/**
 * What the searched line adds about flights (spec rev 55 §11): nothing without a stored plan (ruling A14) or when every
 * planned list is in hand (read now or reused from an earlier run); otherwise how far it got and why the rest were not
 * read, from the stored `ended` ("…; the rest were left: outside this run's browser window"), so a short step never
 * reads as a bare "Searched". A step the run's browser worker was paused for, with nothing planned, says so alone.
 */
function flightsClause(f: Flights, c: PageCopy): string | null {
  if (f === null) return null;
  const P = c.searchPage;
  if (f.planned === 0) return f.ended === 'disabled' ? P.flightsNotRead : null;
  const done = f.read + f.reused;
  if (done >= f.planned) return null;
  const rest = P.flightsRest[f.ended ?? 'failed'];
  return `${P.flightsReadFor(done, f.planned)}; ${rest}`;
}

/** The state a search's page is in (spec rev 55 §11 "State line"), with its words. */
export type StateLine =
  | { kind: 'searching' | 'reading' | 'checking' | 'searched' | 'changed'; text: string }
  | { kind: 'never'; text: string; fix?: string }
  | {
      kind: 'stopped';
      /** The stop's sentence as-is (never a stored status word, never a prefix). */
      text: string;
      stop: StopWords;
      /** "0 of 405 searched" when no date pair was searched, else null. */
      noneSearched: string | null;
    };

/**
 * Spec rev 55 §11 "State line": the one line a search's page says about its latest parent run.
 *
 * - *never*: no run ("Not searched yet"), or a search naming no source ("No price source is set up, so nothing was
 *   searched" with its fix), from its own data (Review Focus 1).
 * - *searching*: pending or running, "Searching · 120 of 405 date pairs · about 1h 40m left" (the count is core's
 *   `datePairSearched` over the page's date pairs; no "left" clause without `estimatedFinishAt`).
 * - *reading*: running in its flight step (a stored plan with lists still to get, before itinerary search), "Reading
 *   flights · 3 of 10 date pairs · about 8m left"; lists reused from earlier runs count as in hand.
 * - *checking*: running in itinerary search, "Checking fares for the cheapest date pairs".
 * - *stopped*: a stopped or skipped status, the stop's sentence as-is (`NO_STOP_CAUSE_TEXT` when the read carries none,
 *   Review Focus 4) and "0 of 405 searched" when nothing was searched (never "0 error").
 * - *changed*: a completed run of an earlier space ("Dates changed since this was last searched", count-free, ruling
 *   20.3 R-changed); `spaceChanged` is the api's own judgement (the card's `spaceChangedSince`).
 * - *searched*: a completed run, only once its flight step is done: the header line, with the flights clause when fewer
 *   lists than planned are in hand.
 */
export function stateLine(d: {
  latest: ExecutionResponse | null;
  pairs: readonly DatePair[];
  providers: readonly ProviderId[];
  reused: number;
  spaceChanged: boolean;
  /** The search names no price source at all (no discovery and no verification provider). */
  noSource: boolean;
  now: IsoDateTime;
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
    const left = leftWords(run.estimatedFinishAt, d.now);
    if (run.status === 'running' && run.stage === 'verification')
      return { kind: 'checking', text: P.checkingFares };
    const f = run.flights;
    if (run.status === 'running' && f !== null && f.read + f.reused + f.failed < f.planned)
      return { kind: 'reading', text: P.readingFlights(f.read + f.reused, f.planned, left) };
    return {
      kind: 'searching',
      text: d.c.searchesView.searching(searchedCount(d.pairs), d.pairs.length, left),
    };
  }
  if (STOPPED.has(run.status)) {
    const stop = run.stop ?? NO_STOP_CAUSE_TEXT;
    return {
      kind: 'stopped',
      text: stop.sentence,
      stop,
      noneSearched: searchedCount(d.pairs) === 0 ? P.noneSearched(d.pairs.length) : null,
    };
  }
  if (run.startedAt === null) return { kind: 'never', text: P.notSearchedYet };
  if (d.spaceChanged) return { kind: 'changed', text: d.c.searchesView.datesChanged };
  const line = searchedLine({
    run,
    pairs: d.pairs,
    providers: d.providers,
    reused: d.reused,
    now: d.now,
    c: d.c,
  });
  const flights = flightsClause(run.flights, d.c);
  return { kind: 'searched', text: flights === null ? line : `${line} · ${flights}` };
}
