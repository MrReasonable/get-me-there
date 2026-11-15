/**
 * Spec revision 55 §10 `GET /definitions/cards`: the first screen's cards, in the order the api owns. Each card reads its
 * definition, its latest parent run (one statement for every definition, `latestParentPerDefinition`), that run's date
 * pairs by core's one "searched" predicate (`datePairSearched`, §6.6) and its marks over its whole space (Ruling 7,
 * core's `reducedMark`), both from one bounded statement for every card (`CellsRepo.searchedDatePairs`); its trips,
 * read dates and lower-on-calendar line through the board's own ranking (`rankedFigures`) and core's shared rules
 * (Ruling 3); and the stop's words from the stored cause (`stopOf`). No field carries `error_text`, a key, a password or
 * a path (the contract is strict).
 */

import {
  apiContract,
  type Buckets,
  cheapestTrips,
  datePairAt,
  datePairCount,
  type Execution,
  flightsRead,
  type IsoDateTime,
  isScheduled,
  lowerOnCalendar,
  markCounts,
  type PriceLabelKind,
  priceLabelKind,
  type ResolvedSpace,
  reducedMark,
  type SearchCard,
  type SearchCardsResponse,
  type SearchDefinition,
} from '@gmt/core';
import type { CardDatePairs } from '@gmt/db';
import type { Engine } from '@gmt/engine';
import type { Ports } from '../wiring.js';
import { verifiedDetailOf } from './datePairs.js';
import { estimatedFinishOf, flightsOf, stopOf } from './executions.js';
import { type RankedFigure, rankedFigures } from './ranked.js';
import { currentSpace } from './space.js';

const NONE: CardDatePairs = { ever: new Set(), latest: new Map() };

/** Ruling 7: how many trips a card carries (Ruling 4: cards show three). */
const CARD_TRIPS = 3;

/**
 * The card's latest run (spec revision 55 §10, Ruling 7): its counts over its own snapshot space (searched by this run;
 * never searched by any parent run of the search), its five marks over that whole space, the date pairs the browser was
 * unavailable for, its flight counts, its estimated finish while it runs, and its stop's words. `pairs` comes from one
 * bounded statement for every card (R2): each run judged by `datePairSearched` over this run's space, so its airport
 * pairs missing from an older run count not run there; a date pair this run never seeded reads every airport pair not
 * run (`datePairBuckets`' rule), so the marks sum to the date pairs.
 */
function latestRunOf(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
  def: SearchDefinition,
  run: Execution,
  pairs: CardDatePairs,
): NonNullable<SearchCard['latestRun']> {
  const space = run.snapshot.resolved;
  const n = datePairCount(space);
  const airportPairs = space.origins.length * space.destinations.length;
  const notRun: Buckets = {
    priced: 0,
    empty: 0,
    no_data: 0,
    error: 0,
    skipped: 0,
    not_run: airportPairs,
    reused: 0,
  };
  let never = 0;
  let browserUnavailable = 0;
  const buckets: Buckets[] = [];
  for (let i = 0; i < n; i++) {
    const at = datePairAt(space, i);
    const key = `${at.departureDate}|${at.returnDate}`;
    if (!pairs.ever.has(key)) never += 1;
    const mine = pairs.latest.get(key);
    buckets.push(mine?.buckets ?? notRun);
    // why: Ruling 8's "the browser was unavailable" is a date pair the run did not reach, as the Trip page's card reads
    // its skips: a budget skip on any airport pair means the run stopped at its limit, so it is not the browser's
    if (
      mine !== undefined &&
      reducedMark(mine.buckets) === 'not-reached' &&
      mine.budgetSkips === 0 &&
      mine.browserSkips > 0
    )
      browserUnavailable += 1;
  }
  const marks = markCounts(buckets);
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    datePairs: n,
    // why: §6.6: searched is exactly priced or no price shown, the same count as the marks give
    datePairsSearched: marks.priced + marks['no-price-shown'],
    datePairsNeverSearched: never,
    // why: ruling R-reading — the same counts as the run's own read (`flightsOf`), so the card and the page agree
    flights: flightsOf(ports, run),
    estimatedFinishAt: estimatedFinishOf(ports, engine, run),
    stop: stopOf(ports, run, def),
    marks,
    browserUnavailable,
  };
}

/** A ranked figure as the wire carries it (`datePairFigureSchema`): the board's figure less its airport-pair index. */
function wireFigure(p: RankedFigure): SearchCard['trips'][number]['figure'] {
  const { airportPair: _airportPair, ...figure } = p.figure;
  return figure;
}

/** The label kind of a current calendar price (`priceLabelKind`): only `calendar` or `cached`. */
function calendarKind(p: RankedFigure): 'calendar' | 'cached' {
  const kind: PriceLabelKind = priceLabelKind(
    { kind: 'calendar', providerId: p.figure.price.provenance.providerId },
    false,
  );
  if (kind === 'calendar' || kind === 'cached') return kind;
  // why: priceLabelKind gives a current calendar price its source's kind; nothing else reaches here
  throw new RangeError(`a calendar price labelled ${kind}`);
}

/**
 * Ruling 7, through Ruling 3's rules over the board's whole ranked list: the first three trips (`cheapestTrips`) with
 * each verified one's details (Ruling 2, from its own row), how many date pairs have flights read (`flightsRead`), and
 * the dates that look lower on the calendar (`lowerOnCalendar`): how many, and the lowest with its full price cell.
 */
function tripsOf(
  ranked: readonly RankedFigure[],
): Pick<SearchCard, 'trips' | 'verifiedDetails' | 'readDates' | 'lowerOnCalendar'> {
  const trips = cheapestTrips(ranked).slice(0, CARD_TRIPS);
  const [lowest, ...rest] = lowerOnCalendar(ranked);
  return {
    trips: trips.map((p) => ({
      figure: wireFigure(p),
      departureDate: p.departureDate,
      returnDate: p.returnDate,
      nights: p.nights,
    })),
    verifiedDetails: trips.flatMap((p) => {
      const d = verifiedDetailOf(p, p.figure, p.chosen);
      return d === null ? [] : [d];
    }),
    readDates: ranked.filter((p) => flightsRead(p.figure)).length,
    lowerOnCalendar:
      lowest === undefined
        ? null
        : {
            count: rest.length + 1,
            cheapest: {
              price: lowest.figure.price,
              departureDate: lowest.departureDate,
              returnDate: lowest.returnDate,
              origin: lowest.figure.origin,
              destination: lowest.figure.destination,
              kind: calendarKind(lowest),
            },
          },
  };
}

/** Whether the search's space changed after its latest run started: its stored space fields differ from the snapshot's. */
function spaceChanged(def: SearchDefinition, run: Execution | null): boolean {
  if (run === null) return false;
  const s = run.snapshot;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return !(
    same(def.origins, s.origins) &&
    same(def.destinations, s.destinations) &&
    same(def.window, s.window) &&
    def.minNights === s.minNights &&
    def.maxNights === s.maxNights &&
    def.cabin === s.cabin
  );
}

function windowOf(def: SearchDefinition, space: ResolvedSpace): SearchCard['window'] {
  const w = def.window;
  return w.kind === 'absolute'
    ? // why: the window as the operator set it, so an expired one still states its dates in order
      { kind: 'absolute', departureFrom: w.from, departureTo: w.to, startOffsetDays: null, lengthDays: null }
    : {
        kind: 'relative',
        departureFrom: space.departureFrom,
        departureTo: space.departureTo,
        startOffsetDays: w.startOffsetDays,
        lengthDays: w.lengthDays,
      };
}

function cardOf(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
  def: SearchDefinition,
  run: Execution | null,
  pairs: CardDatePairs,
  now: IsoDateTime,
): SearchCard {
  const space = currentSpace(def, ports.clock.todayLondon());
  const ranked = rankedFigures(ports, def, {
    space,
    maxJourneyMinutes: def.constraints.maxJourneyMinutes ?? null,
    now,
  });
  return {
    id: def.id,
    name: def.name,
    origins: def.origins,
    destinations: def.destinations,
    window: windowOf(def, space),
    minNights: def.minNights,
    maxNights: def.maxNights,
    cabin: def.cabin,
    schedule:
      isScheduled(def) && def.scheduleCron !== null ? { cron: def.scheduleCron, tz: def.scheduleTz } : null,
    discovery: def.providers.discovery,
    latestRun: run === null ? null : latestRunOf(ports, engine, def, run, pairs),
    spaceChangedSince: spaceChanged(def, run),
    ...tripsOf(ranked),
  };
}

/**
 * The cards in the api's order (spec revision 55 §10): pending or running first, oldest start first; then by the latest
 * run's start, newest first; then searches never run, in creation order. Deleted definitions (a tool's hidden ones
 * included) are absent.
 */
export function assembleCards(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
  now: IsoDateTime,
): SearchCardsResponse {
  const latest = ports.repos.executions.latestParentPerDefinition();
  const rows = ports.repos.definitions.list().map((def) => ({ def, run: latest.get(def.id) ?? null }));
  // why: CodeRabbit finding (the cards read had no upper bound) — one statement for every card answers each latest run's
  // searched date pairs and its counts per date pair, at most one row per date pair of each space, never every run's cells
  const pairs = ports.repos.cells.searchedDatePairs(
    rows.flatMap((r) =>
      r.run === null
        ? []
        : [{ definitionId: r.def.id, latestRunId: r.run.id, space: r.run.snapshot.resolved }],
    ),
  );
  const startOf = (e: Execution) => e.startedAt ?? e.createdAt;
  const live = (e: Execution | null) => e !== null && (e.status === 'pending' || e.status === 'running');
  const rank = (r: (typeof rows)[number]) => (live(r.run) ? 0 : r.run === null ? 2 : 1);
  // why: Array.prototype.sort is stable and `list()` is in creation order, so equal keys keep creation order
  rows.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb || a.run === null || b.run === null) return ra - rb;
    const sa = startOf(a.run);
    const sb = startOf(b.run);
    if (sa === sb) return 0;
    const older = sa < sb ? -1 : 1;
    // why: runs in flight oldest start first; finished ones by their start, newest first
    return ra === 0 ? older : -older;
  });
  return apiContract.searchCardsResponseSchema.parse({
    cards: rows.map((r) => cardOf(ports, engine, r.def, r.run, pairs.get(r.def.id) ?? NONE, now)),
    // why: Task 6's card links fall back to the Google Flights search in the install's market, as /date-pairs does
    pointOfSale: ports.config.pointOfSale,
  });
}
