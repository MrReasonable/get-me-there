import {
  BUDGET_SCOPE_KINDS,
  CONFIRM_TARGET,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  groupThousands,
  mainPathSource,
  microGbpToPence,
  type ProviderId,
} from '@gmt/core';
import type { EstimateResponse } from '../../api/types.js';
import { ESTIMATE_COPY } from '../../copy/estimate.js';
import { COPY } from '../../copy.js';
import { parseSchedule } from '../Definitions/schedule.js';

type Copy = typeof ESTIMATE_COPY;
type Line = EstimateResponse['estimate']['perProvider'][number];

/** The schedule the "the rest …" clause follows (po-011): the search's cron and zone when it repeats, else null. */
export interface SentenceSchedule {
  cron: string | null;
  tz: string;
}

/**
 * The estimate sentence (spec rev 55 §11 "The estimate sentence", design §4.3): `line` is the one sentence beside the
 * button, `notes` the lines under it, `button` the press's label carrying what the run costs, and `covers` the figures
 * the press confirms.
 */
export interface EstimateSentence {
  line: string;
  /** "Search · about £1.20", "Search · 120 SearchApi calls", or the bare verb on a free run. */
  button: string;
  /** The cost tag the button carries ("about £1.20", "120 SearchApi calls"), or null on a free run. */
  tag: string | null;
  notes: string[];
  /**
   * The runnable totals (the unblocked lines' pence and calls, as the api's `runnableTotalsOf` and the engine's
   * `requireCovered` count them): exactly what the press sends as its confirmation and the server recomputes.
   */
  covers: { pence: number; calls: number };
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HALF_HOUR = 1800;

/**
 * Spec rev 55 §11: how long a run takes, in lower case ("under a minute", "about 12 minutes", "about 2½ hours"); the
 * sentence capitalises its first letter. Under a minute is said as such; under an hour, whole minutes (rounded); from
 * an hour, the nearest half hour, so a run of 2 h 59 m reads "about 3 hours".
 */
export function aboutDuration(seconds: number, c: Copy = ESTIMATE_COPY): string {
  const L = c;
  if (seconds < SECONDS_PER_MINUTE) return L.underAMinute;
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (minutes < 60) return L.aboutMinutes(minutes);
  const halves = Math.round(seconds / SECONDS_PER_HALF_HOUR);
  return L.aboutHours(Math.floor(halves / 2), halves % 2 === 1);
}

/**
 * A length without "about" ("41 min", "under a minute", "2½ hours"), by `aboutDuration`'s rounding, for the
 * out-and-back clause that says "usually about" once before its pages and time (spec rev 56 §8.1, R-estimate).
 */
export function plainDuration(seconds: number, c: Copy = ESTIMATE_COPY): string {
  if (seconds < SECONDS_PER_MINUTE) return c.underAMinute;
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  if (minutes < 60) return c.minutes(minutes);
  const halves = Math.round(seconds / SECONDS_PER_HALF_HOUR);
  return c.hours(Math.floor(halves / 2), halves % 2 === 1);
}

/**
 * The flight-list step's sentence (design 2026-11-08 §6, Ruling 13; spec rev 56 §8.1 "Estimate"), or none when it reads
 * no date pair. Out and back the step reads until more reading stops finding cheaper trips, so the sentence says that
 * rule with core's `CONFIRM_TARGET` ("until the 5 cheapest stop changing") and the dates read go in a note ("usually
 * about 15 dates, at most 290", the at-most figure being `pagesMax / 2` reads); outbound only, the first dates and the
 * time. Its time is already in the duration the first sentence gives.
 */
function flightsSentence(f: NonNullable<EstimateResponse['estimate']['flightLists']>, c: Copy): string[] {
  if (f.pairs === 0) return [];
  if (!f.returns) return [c.flights(groupThousands(f.pairs), aboutDuration(f.seconds, c))];
  return [c.flightsUntilSettled(CONFIRM_TARGET)];
}

/** The note under the sentence for an out-and-back flight line: how many dates it usually reads and at most. */
function flightsNote(f: NonNullable<EstimateResponse['estimate']['flightLists']>, c: Copy): string[] {
  if (f.pairs === 0 || !f.returns) return [];
  // why: the response carries the at-most reads as pages (2 a read out and back, the engine's FLIGHT_LIST_PAGES_PER_PAIR_MAX)
  const most =
    f.pagesMax === undefined
      ? f.pairs
      : Math.max(f.pairs, Math.ceil(f.pagesMax / FLIGHT_LIST_PAGES_PER_PAIR_MAX));
  return [c.flightsDates(groupThousands(f.pairs), groupThousands(most))];
}

/** The first letter in capitals: the sentence starts with whichever clause comes first. */
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The words for a blocked line's scope (engine `checkBudget` names it). */
function blockedWhy(scope: string, c: Copy): string {
  const W = c.blockedWhy;
  const kind = BUDGET_SCOPE_KINDS.find((k) => k === scope);
  if (kind === undefined) return W.unknown;
  return W[kind];
}

/** "the rest when you search again" unscheduled; "the rest next Monday" on one weekly day; else the next scheduled run. */
function restClause(schedule: SentenceSchedule | null, c: Copy): string {
  const L = c;
  if (schedule === null || schedule.cron === null) return L.restAgain;
  const s = parseSchedule(schedule.cron);
  const day = s.kind === 'weekly' && s.days.length === 1 ? L.dayName[s.days[0] ?? -1] : undefined;
  return day === undefined ? L.restScheduled : L.restNext(day);
}

/** The sentence of a run that asks nothing new: "Nothing new to ask: 405 dates kept from earlier searches", or none. */
function nothingNewClause(e: EstimateResponse, c: Copy): string {
  return e.datePairsReused > 0 ? c.nothingNew(groupThousands(e.datePairsReused)) : c.nothingToAsk;
}

/**
 * Nothing when every date is asked (mockup 01's sentence names no count then), else "asks about 300 of 405 dates this
 * run (…), the rest …". Only called when some date is asked.
 */
function askedClauses(e: EstimateResponse, schedule: SentenceSchedule | null, c: Copy): string[] {
  const L = c;
  if (e.datePairsCovered === e.datePairs) return [];
  const asked = e.datePairsCovered + e.datePairsPartly;
  const total = groupThousands(e.datePairs);
  // why: the rest are the date pairs neither asked nor kept; "this run" pairs with "the rest", so it goes with it
  const rest = asked + e.datePairsReused < e.datePairs;
  const extras = [
    ...(e.datePairsPartly > 0 ? [L.partly(groupThousands(e.datePairsPartly))] : []),
    ...(e.datePairsReused > 0 ? [L.kept(groupThousands(e.datePairsReused))] : []),
  ];
  const head = [L.asksSome(groupThousands(asked), total), ...(rest ? [L.thisRun] : []), ...extras].join(' ');
  return [rest ? `${head}, ${restClause(schedule, c)}` : head];
}

/** A sentence from its clauses: the first letter in capitals, the clauses joined, a full stop at the end. */
const sentenceFrom = (clauses: readonly string[], c: Copy): string =>
  `${capitalised(clauses.join(c.clause))}${c.stop}`;

/**
 * Spec rev 55 §11 "The estimate sentence" (WP20 Task 20.5), design 2026-11-08 Ruling 13: the line beside the new-search
 * panel's Search (and Search again's and Save and search again's second look, and Repeat weekly's Save), built from the
 * estimate response's figures and codes only, never from engine English (rulings A22, A31). A free run reads "About
 * 25 min, free. Then flights are read for the cheapest dates until the 5 cheapest stop changing." (mockup 01):
 *
 * - the first sentence: the duration ("About 2½ hours"); "free" only when no billable-plan source is used and the run
 *   costs nothing, else "about £1.20" when it costs money; each billable-plan source's calls against what its window
 *   has left ("uses about 120 of the 9,880 SearchApi calls left this month", "…left on your trial" for a lifetime
 *   window); when only some dates are asked, "asks about 300 of 405 dates this run, the rest when you search again"
 *   ("the rest next Monday" on a search repeating on Mondays, po-011), with "(20 on some airports only)" and "(105 kept
 *   from earlier searches)" beside the count (20.4 minor 7); and "cached prices only where travellers searched
 *   recently" when the Aviasales cache is the only source reaching the dates (prov-int-014). With nothing new to ask it
 *   says so first ("Nothing new to ask: 405 dates kept from earlier searches."), then the duration, cost and calls in
 *   their own sentence when the run still spends;
 * - the flight sentence when the browser reads flights: out and back "Then flights are read for the cheapest dates until
 *   the 5 cheapest stop changing." with "usually about 15 dates, at most 290" as a note (design 2026-11-08 §6), outbound
 *   only "Then flights are read for up to 10 dates, about 12 min." (ruling 20.5 concern 2).
 *
 * Coverage is never worded as prices found, and the main path's words stand ("dates", never "date pairs"). The notes:
 * the flight note, each source a budget cap blocks with why and its cost as not included, and the soft confirmation the
 * press gives ("This costs about £1.20, above your £1.00 check; pressing Search confirms it").
 *
 * Money goes only through `money`, the estimate panel's one cost formatter (spec §11; `sourceGuard.test.ts` holds
 * every caller to it); counts through core's `groupThousands`, the grouping money and counts share. `press` is the
 * verb of the button the sentence sits beside ("Search now" by default).
 */
export function estimateSentence(
  e: EstimateResponse,
  schedule: SentenceSchedule | null,
  c: Copy,
  money: (pence: number) => string,
  press: string = COPY.searchAgain.searchNow,
): EstimateSentence {
  const L = c;
  const lines = e.estimate.perProvider;
  const runnable = lines.filter((p) => p.blocked === null);
  const covers = {
    pence: microGbpToPence(runnable.reduce((a, p) => a + p.costMicroGbp, 0)),
    calls: runnable.reduce((a, p) => a + p.calls, 0),
  };
  const nothingAsked = e.datePairsCovered + e.datePairsPartly === 0;
  const billed = e.billedCalls.filter((b) => b.calls > 0);
  const cost = covers.pence > 0 ? L.about(money(covers.pence)) : billed.length === 0 ? L.free : null;
  const sources = new Set(runnable.filter((p) => p.stage === 'discovery').map((p) => p.providerId));
  const cachedOnly = sources.size === 1 && sources.has('travelpayouts');
  const billedClauses = billed.map((b) =>
    b.left === null
      ? L.billedNoCap(groupThousands(b.calls), L.callsOf[b.providerId])
      : L.billed(groupThousands(b.calls), groupThousands(b.left), L.callsOf[b.providerId], b.window),
  );
  const spends = covers.pence > 0 || billed.length > 0;
  const runClauses = [
    aboutDuration(e.estimate.seconds, c),
    ...(cost === null ? [] : [cost]),
    ...billedClauses,
  ];
  // why: ruling 20.5 concern 2 — the flight-list step's own sentence (spec rev 56 §8.1 Estimate.flightLists), said only
  // when it reads at least one date; 20.9 review finding 7: with every date kept the browser still reads their flights
  const fl = e.estimate.flightLists;
  const flights = (fl === undefined ? [] : flightsSentence(fl, c)).map((f) => sentenceFrom([f], c));
  // why: fix round 1, finding 7 — with nothing new to ask a run may still spend (checking fares on kept prices); the line
  // then keeps how long it takes, what it costs and the calls it uses, as the button carries them
  const sentences = nothingAsked
    ? [sentenceFrom([nothingNewClause(e, c)], c), ...(spends ? [sentenceFrom(runClauses, c)] : [])]
    : [
        sentenceFrom(
          [...runClauses, ...askedClauses(e, schedule, c), ...(cachedOnly ? [L.cachedOnly] : [])],
          c,
        ),
      ];
  const tag =
    covers.pence > 0
      ? L.about(money(covers.pence))
      : billed.length > 0
        ? billed.map((b) => L.callsTag(groupThousands(b.calls), L.callsOf[b.providerId])).join(L.separator)
        : null;
  return {
    line: [...sentences, ...flights].join(' '),
    button: tag === null ? press : L.withTag(press, tag),
    tag,
    notes: [
      ...(fl === undefined ? [] : flightsNote(fl, c)),
      ...notUsedNotes(lines, c, money),
      ...(e.softConfirm === null
        ? []
        : [
            e.softConfirm.reason === 'cost'
              ? L.softCost(money(e.softConfirm.estimatePence), money(e.softConfirm.thresholdPence), press)
              : L.softShare(L.callsOf[e.softConfirm.providerId], e.softConfirm.window, press),
          ]),
    ],
    covers,
  };
}

/**
 * One note per source a budget cap blocks: its main-path name, why (the first blocked line's scope) and, when its
 * blocked lines would cost money, that cost as not included (the press stores only what was shown).
 */
function notUsedNotes(lines: readonly Line[], c: Copy, money: (pence: number) => string): string[] {
  const blocked = new Map<ProviderId, { scope: string; micro: number }>();
  for (const p of lines) {
    if (p.blocked === null) continue;
    const seen = blocked.get(p.providerId);
    blocked.set(p.providerId, {
      scope: seen?.scope ?? p.blocked,
      micro: (seen?.micro ?? 0) + p.costMicroGbp,
    });
  }
  return [...blocked].map(([id, b]) => {
    const pence = microGbpToPence(b.micro);
    return c.notUsed(
      capitalised(mainPathSource(id)),
      blockedWhy(b.scope, c),
      pence > 0 ? money(pence) : null,
    );
  });
}
