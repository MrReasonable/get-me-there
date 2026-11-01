/**
 * Spec revision 55 §10 `GET /definitions/cards`: the first screen's cards, in the order the api owns. Each card reads its
 * definition, its latest parent run (one statement for every definition, `latestParentPerDefinition`), that run's date
 * pairs by core's one "searched" predicate (`datePairSearched`, §6.6), the cheapest through the board's own ranking
 * (`rankedFigures`) and the stop's words from the stored cause (`stopOf`). No field carries `error_text`, a key, a
 * password or a path (the contract is strict).
 */
import {
  apiContract,
  type CellOutcomeStatus,
  cellKeyString,
  datePairAt,
  datePairBuckets,
  datePairCount,
  datePairSearched,
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

/** One run's discovery roll-up status per cell key (`CellsRepo.parentDiscoveryRollUps`). */
type RunRollUps = ReadonlyMap<string, CellOutcomeStatus | null>;

/** The date pairs of `space` a run searched (by `datePairSearched` over its roll-ups), as `dep|ret` keys. */
function searchedKeys(rollUps: RunRollUps, space: ResolvedSpace): Set<string> {
  const buckets = datePairBuckets(space, (c) => rollUps.get(cellKeyString(c)) ?? null);
  const out = new Set<string>();
  buckets.forEach((b, i) => {
    if (!datePairSearched(b)) return;
    const at = datePairAt(space, i);
    out.add(`${at.departureDate}|${at.returnDate}`);
  });
  return out;
}

/**
 * The card's latest run (spec revision 55 §10): its counts over its own snapshot space (searched by this run; never
 * searched by any parent run of the search), its flight counts, its estimated finish while it runs, and its stop's words.
 * `runs` holds every parent run's roll-ups, read for every card in one grouped statement (R2).
 */
function latestRunOf(
  ports: Ports,
  engine: Pick<Engine, 'estimateRemaining'>,
  def: SearchDefinition,
  run: Execution,
  runs: ReadonlyMap<string, RunRollUps>,
): NonNullable<SearchCard['latestRun']> {
  const space = run.snapshot.resolved;
  const mine = searchedKeys(runs.get(run.id) ?? new Map(), space);
  // why: "never searched" is over every parent run of the search; each is judged over this run's space (its airport
  // pairs missing from an older run's roll-ups count not run there), so one grouped read serves every card
  const ever = new Set(mine);
  for (const [id, rollUps] of runs)
    if (id !== run.id) for (const k of searchedKeys(rollUps, space)) ever.add(k);
  const pairs = datePairCount(space);
  let never = 0;
  for (let i = 0; i < pairs; i++) {
    const at = datePairAt(space, i);
    if (!ever.has(`${at.departureDate}|${at.returnDate}`)) never += 1;
  }
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    datePairs: pairs,
    datePairsSearched: mine.size,
    datePairsNeverSearched: never,
    // why: ruling R-reading — the same counts as the run's own read (`flightsOf`), so the card and the page agree
    flights: flightsOf(run),
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
  runs: ReadonlyMap<string, RunRollUps>,
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
    latestRun: run === null ? null : latestRunOf(ports, engine, def, run, runs),
    spaceChangedSince: spaceChanged(def, run),
    cheapest:
      best === undefined
        ? null
        : {
            pricePence: best.figure.price.pricePence,
            provenance: best.figure.price.provenance,
            stale: best.figure.price.stale,
            ageHours: best.figure.price.ageHours,
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
  const rollUps = ports.repos.cells.parentDiscoveryRollUps();
  const rows = ports.repos.definitions.list().map((def) => ({ def, run: latest.get(def.id) ?? null }));
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
    cards: rows.map((r) => cardOf(ports, engine, r.def, r.run, rollUps.get(r.def.id) ?? new Map(), now)),
  });
}
