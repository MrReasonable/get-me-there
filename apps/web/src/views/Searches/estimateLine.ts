import {
  BUDGET_SCOPE_KINDS,
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
  /** "Search now · about £1.20", "Search now · 120 SearchApi searches", or the bare verb on a free run. */
  button: string;
  /** The cost tag the button carries ("about £1.20", "120 SearchApi searches"), or null on a free run. */
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
 * A length without "about" ("41 minutes", "under a minute", "2½ hours"), by `aboutDuration`'s rounding, for the
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
 * The flight-list step's clause (spec rev 56 §8.1 "Estimate", R-estimate; ruling 20.5 concern 2), or none when it reads
 * no date pair: the date pairs from `pairs` (never the pages); out and back, the typical pages and time and the bound
 * ("at most", the typical figures when an older line states no bound); outbound only, the time alone.
 */
function flightsClause(f: NonNullable<EstimateResponse['estimate']['flightLists']>, c: Copy): string[] {
  if (f.pairs === 0) return [];
  const pairs = groupThousands(f.pairs);
  if (!f.returns) return [c.flights(pairs, aboutDuration(f.seconds, c))];
  return [
    c.flightsOutAndBack(
      pairs,
      groupThousands(f.pages),
      plainDuration(f.seconds, c),
      groupThousands(f.pagesMax ?? f.pages),
      plainDuration(f.secondsMax ?? f.seconds, c),
    ),
  ];
}

/** The first letter in capitals: the sentence starts with whichever clause comes first. */
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The words for a blocked line's scope (engine `checkBudget` names it); a browser page cap is counted in pages. */
function blockedWhy(scope: string, providerId: ProviderId, c: Copy): string {
  const W = c.blockedWhy;
  const kind = BUDGET_SCOPE_KINDS.find((k) => k === scope);
  if (kind === undefined) return W.unknown;
  if (kind === 'provider-month' && providerId === 'camoufox') return W['provider-month-pages'];
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

/** "asks about all 405 date pairs", "asks about 300 of 405 date pairs this run (…), the rest …", or the nothing-asked line. */
function askedClause(e: EstimateResponse, schedule: SentenceSchedule | null, c: Copy): string {
  const L = c;
  const asked = e.datePairsCovered + e.datePairsPartly;
  if (asked === 0)
    return e.datePairsReused > 0 ? L.nothingNew(groupThousands(e.datePairsReused)) : L.nothingToAsk;
  const total = groupThousands(e.datePairs);
  if (e.datePairsCovered === e.datePairs) return L.asksAll(total);
  // why: the rest are the date pairs neither asked nor reused; "this run" pairs with "the rest", so it goes with it
  const rest = asked + e.datePairsReused < e.datePairs;
  const extras = [
    ...(e.datePairsPartly > 0 ? [L.partly(groupThousands(e.datePairsPartly))] : []),
    ...(e.datePairsReused > 0 ? [L.reused(groupThousands(e.datePairsReused))] : []),
  ];
  const head = [L.asksSome(groupThousands(asked), total), ...(rest ? [L.thisRun] : []), ...extras].join(' ');
  return rest ? `${head}, ${restClause(schedule, c)}` : head;
}

/**
 * Spec rev 55 §11 "The estimate sentence" (WP20 Task 20.5): the one sentence beside Search now (and Search again's and
 * Save and search again's second look), built from the estimate response's figures and codes only, never from engine
 * English (rulings A22, A31):
 *
 * - the duration, capitalised ("About 2½ hours"); then "free" only when no billable-plan source is used and the run
 *   costs nothing, else "about £1.20" when it costs money;
 * - what is asked of the date pairs, never as prices found: "asks about all 405 date pairs", or "asks about 300 of 405
 *   date pairs this run, the rest when you search again" ("the rest next Monday" on a search repeating on Mondays,
 *   po-011), with "(20 on some airports only)" and "(105 reused from earlier runs)" beside the count (20.4 minor 7);
 *   "Nothing new to ask: 405 date pairs reused from earlier runs" when nothing is asked (followed by the duration, the
 *   cost and the calls when the run still spends);
 * - "cached prices only where travellers searched recently" when the Aviasales cache is the only source reaching the
 *   date pairs (prov-int-014);
 * - each billable-plan source's calls against what its window has left ("uses about 120 of the 9,880 SearchApi
 *   searches left this month", "…left on your trial" for a lifetime window);
 * - "+ flights for up to 10 date pairs, about 12 minutes" when the browser worker reads flights (ruling 20.5 concern 2),
 *   or with the return leg "+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at
 *   most 20 pages and 50 minutes" (spec rev 56 §8.1, R-estimate).
 *
 * The notes: the browser worker's month ("uses about 110 of your 1,400 browser pages left this month"), each source a
 * budget cap blocks with why and its cost as not included, and the soft confirmation the press gives ("This costs about
 * £1.20, above your £1.00 check; pressing Search now confirms it").
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
  const asked = askedClause(e, schedule, c);
  const nothingAsked = e.datePairsCovered + e.datePairsPartly === 0;
  const billed = e.billedCalls.filter((b) => b.calls > 0);
  const cost = covers.pence > 0 ? L.about(money(covers.pence)) : billed.length === 0 ? L.free : null;
  const sources = new Set(runnable.filter((p) => p.stage === 'discovery').map((p) => p.providerId));
  const cachedOnly = sources.size === 1 && sources.has('travelpayouts');
  const billedClauses = billed.map((b) =>
    b.left === null
      ? L.billedNoCap(groupThousands(b.calls), L.searchesOf[b.providerId])
      : L.billed(groupThousands(b.calls), groupThousands(b.left), L.searchesOf[b.providerId], b.window),
  );
  const spends = covers.pence > 0 || billed.length > 0;
  // why: ruling 20.5 concern 2 — the flight-list step's own pairs, pages and time (spec rev 56 §8.1 Estimate.flightLists),
  // said only when it reads at least one date pair; its time is already in the duration above
  const fl = e.estimate.flightLists;
  const flights = fl === undefined ? [] : flightsClause(fl, c);
  // why: fix round 1, finding 7 — with nothing new to ask a run may still spend (checking fares on reused prices); the
  // sentence then keeps how long it takes, what it costs and the calls it uses, as the button carries them
  const clauses = nothingAsked
    ? [
        asked,
        ...(spends
          ? [aboutDuration(e.estimate.seconds, c), ...(cost === null ? [] : [cost]), ...billedClauses]
          : []),
        // why: 20.9 review finding 7 — with every date pair reused the browser worker still reads their flights
        ...flights,
      ]
    : [
        aboutDuration(e.estimate.seconds, c),
        ...(cost === null ? [] : [cost]),
        asked,
        ...(cachedOnly ? [L.cachedOnly] : []),
        ...billedClauses,
        ...flights,
      ];
  const tag =
    covers.pence > 0
      ? L.about(money(covers.pence))
      : billed.length > 0
        ? billed
            .map((b) => L.searchesTag(groupThousands(b.calls), L.searchesOf[b.providerId]))
            .join(L.separator)
        : null;
  return {
    line: capitalised(clauses.join(L.separator)),
    button: tag === null ? press : L.withTag(press, tag),
    tag,
    notes: [
      ...(e.monthlyPages === null
        ? []
        : [L.monthlyPages(groupThousands(e.monthlyPages.planned), groupThousands(e.monthlyPages.left))]),
      ...notUsedNotes(lines, c, money),
      ...(e.softConfirm === null
        ? []
        : [
            e.softConfirm.reason === 'cost'
              ? L.softCost(money(e.softConfirm.estimatePence), money(e.softConfirm.thresholdPence), press)
              : L.softShare(L.searchesOf[e.softConfirm.providerId], e.softConfirm.window, press),
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
      blockedWhy(b.scope, id, c),
      pence > 0 ? money(pence) : null,
    );
  });
}
