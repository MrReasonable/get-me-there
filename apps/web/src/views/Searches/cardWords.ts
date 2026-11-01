import {
  formatAgo,
  hoursSince,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  NO_STOP_CAUSE_TEXT,
  STOPPED_STATUSES,
} from '@gmt/core';
import type { SearchCard } from '../../api/types.js';
import type { StopWords } from '../../components/StopWords.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatIsoDateShort } from '../../format.js';
import { readingCount } from '../../lib/flightsReading.js';
import { leftWords } from '../../lib/leftWords.js';
import { parseSchedule } from '../Definitions/schedule.js';

// Spec rev 55 §11 "Searches", the words of a card (WP20 Task 20.3): pure functions from the served card and the page's
// clock, composed from COPY's templates, so the catalogue and rendered-sweep tests cover every sentence and a card
// never prints a status word of its own. Dates are formatted from their strings, never through a Date.

const S = COPY.searchesView;

/**
 * The window in words: "10 Jan – 31 Mar", "10 Dec 2026 – 31 Mar 2027" when it crosses a year, and "rolling: 182 days from
 * 7 days ahead" for a relative window. An absolute window states the operator's own dates, as the card serves them.
 */
export function windowText(w: SearchCard['window']): string {
  if (w.kind === 'relative' && w.lengthDays !== null && w.startOffsetDays !== null)
    return S.windowRolling(w.lengthDays, w.startOffsetDays);
  const crossesYear = w.departureFrom.slice(0, 4) !== w.departureTo.slice(0, 4);
  const format = crossesYear ? formatIsoDate : formatIsoDateShort;
  return S.windowSpan(format(w.departureFrom), format(w.departureTo));
}

/** A trip's dates as "12 → 23 Jan" in one month, "28 Nov → 3 Dec" across two (the year is left to the search's window). */
export function tripText(departure: string, back: string): string {
  const from = formatIsoDateShort(departure);
  const to = formatIsoDateShort(back);
  const [fromDay = '', fromMonth = ''] = from.split(' ');
  return S.trip(to.endsWith(` ${fromMonth}`) ? fromDay : from, to);
}

/** "repeats Mondays 05:00": only a scheduled search has one (the card's `schedule` is null otherwise). */
export function scheduleText(schedule: NonNullable<SearchCard['schedule']>): string {
  const s = parseSchedule(schedule.cron);
  switch (s.kind) {
    case 'weekly':
      return S.repeats(s.days, s.time);
    case 'daily':
      return S.repeatsDaily(s.time);
    default:
      return S.repeatsOther;
  }
}

const ACTIVE: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const STOPPED: ReadonlySet<string> = new Set(STOPPED_STATUSES);

/** A card is pending or running: its state line reads "Searching", it polls and Remove asks "Cancel and remove". */
export function isActive(card: SearchCard): boolean {
  return card.latestRun !== null && ACTIVE.has(card.latestRun.status);
}

/**
 * What a card's state line says: plain words or a stop (the sentence as-is, with its fix), and the `kind` of state, which
 * the card's screen-reader line announces (the counts change every poll and are not announced).
 */
export type StateLine =
  | { kind: 'searching' | 'flights' | 'changed' | 'searched' | 'never'; words: string }
  | { kind: 'stopped'; stop: StopWords };

/**
 * The card's state line (spec rev 55 §11): "Searching · 120 of 405 date pairs · about 1h 40m left" while pending or
 * running (no "left" clause without `estimatedFinishAt`), "Reading flights · 3 of 10" once flights are planned and read
 * below planned, the stop's sentence as-is with its fix when the latest run stopped (`NO_STOP_CAUSE_TEXT` when the read
 * carried none), "Dates changed since this was last searched" for a completed run of an earlier space (ruling R-changed:
 * the card has no count over the current space, so none is stated), "Searched 2h ago", and "Not searched yet" for a
 * search with no run (or a finished one with no recorded time).
 */
export function stateLine(card: SearchCard, now: IsoDateTime): StateLine {
  const run = card.latestRun;
  if (run === null) return { kind: 'never', words: S.notSearchedYet };
  if (ACTIVE.has(run.status)) {
    // why: ruling R-reading — the page's rule (`readingCount`): lists in hand, read now or reused
    const reading = readingCount(run.flights);
    if (run.status === 'running' && run.flights !== null && reading !== null)
      return { kind: 'flights', words: S.readingFlights(reading, run.flights.planned) };
    return {
      kind: 'searching',
      words: S.searching(run.datePairsSearched, run.datePairs, leftWords(run.estimatedFinishAt, now)),
    };
  }
  if (STOPPED.has(run.status)) return { kind: 'stopped', stop: run.stop ?? NO_STOP_CAUSE_TEXT };
  if (card.spaceChangedSince) return { kind: 'changed', words: S.datesChanged };
  const at = run.finishedAt ?? run.startedAt;
  if (at === null) return { kind: 'never', words: S.notSearchedYet };
  return { kind: 'searched', words: S.searchedAgo(formatAgo(hoursSince(at, now))) };
}

/** "85 of 405 date pairs never searched" whenever that count is not zero, else null. */
export function neverSearchedText(card: SearchCard): string | null {
  const run = card.latestRun;
  return run === null || run.datePairsNeverSearched === 0
    ? null
    : S.neverSearched(run.datePairsNeverSearched, run.datePairs);
}

/** What the card's hidden live line says: the kind of state, or a stop's sentence (counts are never announced). */
export function announcement(line: StateLine): string {
  return line.kind === 'stopped' ? line.stop.sentence : S.stateKind[line.kind];
}
