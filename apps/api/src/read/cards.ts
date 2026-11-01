/**
 * Spec revision 55 §10 `GET /definitions/cards`: the first screen's cards, in the order the api owns. Each card reads its
 * definition, its latest parent run (one statement for every definition, `latestParentPerDefinition`), that run's date
 * pairs by core's one "searched" predicate (`datePairSearched`, §6.6; one bounded statement for every card,
 * `CellsRepo.searchedDatePairs`), the cheapest through the board's own ranking (`rankedFigures`) and the stop's words
 * from the stored cause (`stopOf`). No field carries `error_text`, a key, a password or a path (the contract is
 * strict).
 */
import {
  apiContract,
  datePairAt,
  datePairCount,
  type Execution,
  type IsoDateTime,
  isScheduled,
  type ResolvedSpace,
  type SearchCard,
  type SearchCardsResponse,
  type SearchDefinition,
} from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { Ports } from '../wiring.js';
import { estimatedFinishOf, flightsOf, stopOf } from './executions.js';
import { rankedFigures } from './ranked.js';
import { currentSpace } from './space.js';

/** A card's searched date pairs (`CellsRepo.searchedDatePairs`), as `dep|ret` keys of its latest run's space. */
type Searched = { ever: ReadonlySet<string>; mine: ReadonlySet<string> };
const NONE: Searched = { ever: new Set(), mine: new Set() };

/**
 * The card's latest run (spec revision 55 §10): its counts over its own snapshot space (searched by this run; never
 * searched by any parent run of the search), its flight counts, its estimated finish while it runs, and its stop's words.
 * `searched` comes from one bounded statement for every card (R2): each run judged by `datePairSearched` over this
 * run's space, so its airport pairs missing from an older run count not run there.
 */
function latestRunOf(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
  def: SearchDefinition,
  run: Execution,
  searched: Searched,
): NonNullable<SearchCard['latestRun']> {
  const space = run.snapshot.resolved;
  const pairs = datePairCount(space);
  let never = 0;
  for (let i = 0; i < pairs; i++) {
    const at = datePairAt(space, i);
    if (!searched.ever.has(`${at.departureDate}|${at.returnDate}`)) never += 1;
  }
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    datePairs: pairs,
    datePairsSearched: searched.mine.size,
    datePairsNeverSearched: never,
    // why: ruling R-reading — the same counts as the run's own read (`flightsOf`), so the card and the page agree
    flights: flightsOf(ports, run),
    estimatedFinishAt: estimatedFinishOf(ports, engine, run),
    stop: stopOf(ports, run, def),
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
  searched: Searched,
  now: IsoDateTime,
): SearchCard {
  const space = currentSpace(def, ports.clock.todayLondon());
  const [best] = rankedFigures(ports, def, {
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
    latestRun: run === null ? null : latestRunOf(ports, engine, def, run, searched),
    spaceChangedSince: spaceChanged(def, run),
    cheapest:
      best === undefined
        ? null
        : {
            pricePence: best.figure.price.pricePence,
            provenance: best.figure.price.provenance,
            stale: best.figure.price.stale,
            ageHours: best.figure.price.ageHours,
            // why: decision 36 — a partial minimum from a truncated tile is marked on the card as on the board
            truncated: best.figure.price.truncated,
            basis: best.figure.basis,
            departureDate: best.departureDate,
            returnDate: best.returnDate,
            origin: best.figure.origin,
            destination: best.figure.destination,
            fromLatestRun: !best.figure.fromEarlierSearch,
          },
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
  // searched date pairs, at most one row per date pair of each space, never every run's cells
  const searched = ports.repos.cells.searchedDatePairs(
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
    cards: rows.map((r) => cardOf(ports, engine, r.def, r.run, searched.get(r.def.id) ?? NONE, now)),
  });
}
