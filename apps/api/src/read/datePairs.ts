/** Spec §10 `GET /definitions/:id/date-pairs`: the Dates view's source (WP19 Task 19.2). */
import {
  type apiContract,
  countCells,
  type DatePair,
  type DatePairFigure,
  DEFAULT_MAX_CELLS,
  type DecodedDatePairs,
  datePairAt,
  datePairCount,
  datePairIndexer,
  encodeDatePairs,
  type Figure,
  figuresByDatePair,
  type ProviderId,
  type SearchDefinition,
  sortedAirportPairs,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError, fieldsDetail } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { zeroBuckets } from './coverage.js';
import { executionSummary } from './executions.js';
import { type Loaded, loadRows } from './load.js';
import { calendarStaleAfterHours, confirmedIn, priceOf, type ResultRow, type RowContext } from './rows.js';
import {
  classifyCells,
  type ParsedScope,
  parentFacts,
  parseScope,
  type ScopeQuery,
  summariseCells,
} from './scope.js';
import { currentSpace } from './space.js';

export type DatePairsResponse = z.output<typeof apiContract.datePairsResponseSchema>;

/**
 * The one path from rows to a date pair's figure (spec §11 "The figure"; review prov-014): the confirmed offers
 * (`confirmedIn`, decisions 45, 48) and the calendar rows go through core's `figuresByDatePair` over the scope, the
 * journey limit included, and each chosen row becomes the wire's figure: its price cell with the provenance the row
 * carries, its airport pair, decision 54's marks, the first departure and last arrival of each direction as the source
 * states them, and `fromEarlierSearch` (revision 50: fetched by an execution created before the latest parent run, by
 * the executions' newest-first order, so two runs created in the same second still compare). "Cached from £X" keeps the
 * calendar row's own staleness, which `thresholdFor('calendar', …)` gave it, the figure's own rule (decision 38).
 * `assembleDatePairs` uses every figure; `assembleResults` takes the one of its date pair.
 */
export function datePairFigures(
  loaded: Loaded,
  scope: ParsedScope,
  rc: RowContext,
): { figures: Map<number, DatePairFigure>; journeyLeftOut: Map<number, number> } {
  const confirmed = confirmedIn(loaded);
  const candidates = [...loaded.verified.filter(confirmed), ...loaded.calendar];
  const picked = figuresByDatePair(
    candidates,
    { space: scope.space, maxJourneyMinutes: scope.maxJourneyMinutes },
    rc.now,
  );
  const pairAt = new Map(
    sortedAirportPairs(scope.space.origins, scope.space.destinations).map((p, i) => [
      `${p.origin}|${p.destination}`,
      i,
    ]),
  );
  // why: `all` is newest first (created_at, then rowid), so a later position is an earlier execution.
  const position = new Map(loaded.all.map((e, i) => [e.id, i]));
  const latest = loaded.latestParent === null ? undefined : position.get(loaded.latestParent.id);
  const earlier = (executionId: string) => latest !== undefined && (position.get(executionId) ?? -1) > latest;
  const toFigure = (f: Figure<ResultRow>): DatePairFigure => {
    const x = f.chosen;
    const out = x.outbound ?? [];
    const back = x.inbound ?? [];
    const airportPair = pairAt.get(`${x.cell.origin}|${x.cell.destination}`);
    // why: figuresByDatePair drops every candidate outside the scope's airports, so this cannot happen
    if (airportPair === undefined)
      throw new RangeError(`figure on ${x.cell.origin}→${x.cell.destination} outside the scope`);
    const c = f.cheaperCached;
    return {
      price: priceOf(x),
      basis: f.basis,
      origin: x.cell.origin,
      destination: x.cell.destination,
      airportPair,
      superseded: x.superseded,
      notSeenInLatest: x.notSeenInLatest,
      journeyMinutes: x.totalMinutes,
      departOut: out[0]?.departLocal ?? null,
      arriveOut: out[out.length - 1]?.arriveLocal ?? null,
      departBack: back[0]?.departLocal ?? null,
      arriveBack: back[back.length - 1]?.arriveLocal ?? null,
      fromEarlierSearch: earlier(x.executionId),
      cheaperCached:
        c === null
          ? null
          : {
              pricePence: c.pricePence,
              provenance: c.provenance,
              stale: c.stale,
              truncated: c.truncated,
              origin: c.cell.origin,
              destination: c.cell.destination,
            },
    };
  };
  const figures = new Map<number, DatePairFigure>();
  for (const [index, f] of picked.figures) figures.set(index, toFigure(f));
  return { figures, journeyLeftOut: picked.journeyLeftOut };
}

/**
 * Spec §10 `GET /definitions/:id/date-pairs`: every date pair of the current resolved space with its six buckets and
 * verification counts over the airport pairs in scope (one per-cell classification, `classifyCells`, so the summary
 * is the columns' sum) and its figure, for the latest parent run; above 50,000 cells in scope (fixed, whatever
 * `MAX_CELLS_PER_DEFINITION` says) 422 `too_many_cells`. Read through `loadRows`' grouped statements with the scope in
 * the SQL, built as one `DecodedDatePairs` in one pass over the cells and written by core's `encodeDatePairs`.
 *
 * why: the api process is the only writer and better-sqlite3 is synchronous, so no engine write lands between these
 * reads; an await here would break that snapshot.
 */
export function assembleDatePairs(def: SearchDefinition, query: ScopeQuery, ports: Ports): DatePairsResponse {
  // why: the route takes no date pair; only the airports and the journey limit reach the parser
  const scope = parseScope(
    def,
    { origins: query.origins, destinations: query.destinations, maxJourneyMinutes: query.maxJourneyMinutes },
    currentSpace(def, ports.clock.todayLondon()),
  );
  const cells = countCells(scope.space);
  if (cells > DEFAULT_MAX_CELLS) {
    const message = API_TEXT.tooManyCells(cells, DEFAULT_MAX_CELLS);
    throw new ApiError(422, 'too_many_cells', message, {
      ...fieldsDetail([{ field: 'origins', message }]),
      cells,
      bound: DEFAULT_MAX_CELLS,
    });
  }
  const loaded = loadRows(def, ports, { scope });
  const confirmed = confirmedIn(loaded);
  const classes = classifyCells(
    scope.space,
    parentFacts(ports, loaded.latestParent),
    ports.repos.cells.childVerificationRollUps(def.id),
    {
      partiallyVerified: new Set(
        loaded.verified
          .filter((r) => r.verdictClass === 'partially-verified' && confirmed(r))
          .map((r) => `${r.cell.origin}|${r.cell.destination}|${r.cell.departureDate}|${r.cell.returnDate}`),
      ),
    },
  );
  const { figures, journeyLeftOut } = datePairFigures(loaded, scope, loaded.rc);
  const pairs: DatePair[] = [];
  const count = datePairCount(scope.space);
  for (let i = 0; i < count; i++) {
    const at = datePairAt(scope.space, i);
    pairs.push({
      index: i,
      departureDate: at.departureDate,
      returnDate: at.returnDate,
      nights: at.nights,
      buckets: zeroBuckets(),
      selected: 0,
      itinerarySearched: 0,
      notReached: 0,
      onDemand: 0,
      unconfirmed: 0,
      partiallyVerified: 0,
      journeyLeftOut: journeyLeftOut.get(i) ?? 0,
      figure: figures.get(i) ?? null,
    });
  }
  const indexOf = datePairIndexer(scope.space);
  for (const c of classes) {
    const p = pairs[indexOf(c.cell.departureDate, c.cell.returnDate) ?? -1];
    // why: generateCells(space) only yields cells of that space, so every cell has a date pair
    if (p === undefined) throw new RangeError('a classified cell outside its space');
    p.buckets[c.bucket] += 1;
    if (c.reused) p.buckets.reused += 1;
    if (c.selected) p.selected += 1;
    if (c.itinerarySearched) p.itinerarySearched += 1;
    if (c.notReached) p.notReached += 1;
    if (c.onDemand) p.onDemand += 1;
    if (c.unconfirmed) p.unconfirmed += 1;
    if (c.partiallyVerified) p.partiallyVerified += 1;
  }
  const calendarStale: Partial<Record<ProviderId, number>> = {};
  for (const id of def.providers.discovery) calendarStale[id] = calendarStaleAfterHours(loaded.rc, id);
  const decoded: DecodedDatePairs = {
    executionId: loaded.latestParent?.id ?? null,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    discoveryProviders: def.providers.discovery,
    verificationProviderConfigured: def.providers.verification.length > 0,
    staleAfterHours: ports.config.staleAfterHours,
    calendarStaleAfterHours: calendarStale,
    space: scope.space,
    scope: {
      origins: scope.space.origins,
      destinations: scope.space.destinations,
      airportPairs: scope.space.origins.length * scope.space.destinations.length,
      cells,
      maxJourneyMinutes: scope.maxJourneyMinutes,
    },
    summary: summariseCells(classes),
    pairs,
  };
  return encodeDatePairs(decoded);
}
