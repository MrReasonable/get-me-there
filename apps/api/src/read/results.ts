/** Spec §6.5, §6.9, §10 `/results`: the date pair detail's source, and the basis rule every view shares. */
import {
  type apiContract,
  cellKeyString,
  datePairIndex,
  dedupByItinerary,
  rankRows,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { datePairFigures } from './datePairs.js';
import { executionSummary } from './executions.js';
import { type Loaded, loadRows } from './load.js';
import { type Basis, confirmedIn } from './rows.js';
import { classifyCells, parentFacts, parseScope, summariseCells } from './scope.js';
import { currentSpace } from './space.js';

export type ResultsResponse = z.infer<typeof apiContract.resultsResponseSchema>;
export type ResultsQuery = z.infer<typeof apiContract.resultsQuerySchema>;
/** Spec §6.5: at most 1000 rows per response. */
export const RESULTS_CAP = 1000;

// why: re-exported for the views that already import them from here; they live in load.ts and rows.ts so datePairs.ts
// reads them without importing this module (no import cycle)
export { type Loaded, type LoadOptions, loadRows } from './load.js';
export { confirmedIn } from './rows.js';

/** Decision 67: whether verification is available, from the live definition (the one source every view reads). */
export function verificationConfigured(def: SearchDefinition): boolean {
  return def.providers.verification.length > 0;
}

/**
 * Spec §6.9 default basis and its reason (decision 67). One source answers "is verification available": the live
 * definition's `providers.verification`, the same source as `verificationProviderConfigured`, never the latest parent
 * run's frozen snapshot (a parent that ran before verification was added must not hide an on-demand child's price).
 * The verified basis is the default when that source names a provider and any observation, children included, lies
 * inside the current space; otherwise the reason names the condition that failed.
 */
export function chooseBasis(loaded: Loaded, requested: Basis | undefined): { basis: Basis; reason: string } {
  if (requested === 'calendar') return { basis: 'calendar', reason: API_TEXT.basisRequestedCalendar };
  if (requested === 'verified') return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
  if (!verificationConfigured(loaded.def))
    return { basis: 'calendar', reason: API_TEXT.basisNoVerificationProvider };
  if (loaded.verified.length === 0)
    return {
      basis: 'calendar',
      // why: observations that only fall outside the current space are counted, so the reason says where they went.
      reason:
        loaded.excluded.verified > 0 ? API_TEXT.basisNoObservationsInSpace : API_TEXT.basisNoObservations,
    };
  return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
}

/** The scope parameters `/results` takes (spec §10); with none of them the read is the whole space, as before WP19. */
function scopeRequested(q: ResultsQuery): boolean {
  return (
    q.departureDate !== undefined ||
    q.returnDate !== undefined ||
    q.origins !== undefined ||
    q.destinations !== undefined ||
    q.maxJourneyMinutes !== undefined
  );
}

/** The cells in scope with a confirmed partially-verified price (spec §10 `partiallyVerified`; never a figure). */
export function partiallyVerifiedCells(loaded: Loaded): Set<string> {
  const confirmed = confirmedIn(loaded);
  return new Set(
    loaded.verified
      .filter((r) => r.verdictClass === 'partially-verified' && confirmed(r))
      .map((r) => cellKeyString(r.cell)),
  );
}

/**
 * Spec §10 `GET /api/definitions/:id/results`, the date pair detail's source. No sort or filter parameters: the client
 * sorts and filters (spec §6.5). The scope parameters (WP19) are parsed by `parseScope`, the date-pairs route's own
 * parser, and narrow the rows and `coverage` to the scope's cells before the basis is chosen and the rows ranked, so
 * `basis`, `total`, `truncated`, `cheapest` and `excludedByCurrentSpace` describe the scoped cells; a row whose known
 * journey time is above the limit is left out. On a date-pair read `datePairFigure` is the board's figure for that date
 * pair, from `datePairFigures`, the one path from rows to a figure (review prov-014).
 *
 * why: the api process is the only writer and better-sqlite3 is synchronous, so no engine write lands between these
 * reads; an await here would break that snapshot.
 */
export function assembleResults(def: SearchDefinition, q: ResultsQuery, ports: Ports): ResultsResponse {
  const scope = parseScope(def, q, currentSpace(def, ports.clock.todayLondon()));
  const loaded = loadRows(def, ports, {
    executionIds: q.executionId === undefined ? undefined : [q.executionId],
    scope: scopeRequested(q) ? scope : undefined,
  });
  const shown = loaded.scoped[0];
  if (q.executionId !== undefined && shown === undefined)
    throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound);
  const limit = scope.maxJourneyMinutes;
  // why: spec §10: a row whose journey time is known and above the limit is left out; an unknown one stays.
  const view: Loaded = {
    ...loaded,
    verified: loaded.verified.filter(
      (r) => limit === null || r.totalMinutes === null || r.totalMinutes <= limit,
    ),
  };
  const { basis, reason } = chooseBasis(view, q.basis);
  const ranked =
    basis === 'verified'
      ? rankRows(dedupByItinerary(view.verified, loaded.rc.now), loaded.rc.now)
      : // why: decision 54: a superseded calendar price ranks after every current one (a stable partition).
        rankRows(view.calendar, loaded.rc.now).sort((a, b) => Number(a.superseded) - Number(b.superseded));
  const excluded = basis === 'verified' ? loaded.excluded.verified : loaded.excluded.calendar;
  const total = ranked.length;
  const cap = Math.min(q.limit ?? RESULTS_CAP, RESULTS_CAP);
  // why: revision 50: one per-cell classification behind every summary; with ?executionId= the header describes the
  // run shown, alone, as the parent over the current space (review prov-003, decision 42's principle).
  const byRun = q.executionId !== undefined && shown !== undefined;
  const coverage = summariseCells(
    classifyCells(
      scope.space,
      parentFacts(ports, byRun ? shown : loaded.latestParent),
      byRun ? [] : ports.repos.cells.childVerificationRollUps(def.id),
      { partiallyVerified: partiallyVerifiedCells(loaded) },
    ),
  );
  let datePairFigure: ResultsResponse['datePairFigure'] = null;
  if (scope.datePair !== null) {
    const index = datePairIndex(scope.space, scope.datePair.departureDate, scope.datePair.returnDate);
    const figure = index === null ? undefined : datePairFigures(loaded, scope, loaded.rc).figures.get(index);
    if (figure !== undefined) {
      const { airportPair: _airportPair, ...rest } = figure;
      datePairFigure = rest;
    }
  }
  return {
    rows: ranked.slice(0, cap),
    total,
    truncated: total > cap,
    basis,
    basisReason: excluded > 0 ? `${reason} · ${API_TEXT.insideSpace(total, total + excluded)}` : reason,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    coverage,
    excludedByCurrentSpace: excluded,
    verificationProviderConfigured: verificationConfigured(def),
    // why: decision 45 (review prov I2): the headline is the first ranked row: the best class available and, within it,
    // a confirmed price before an unconfirmed one (`compareRows`); an unconfirmed headline keeps its verdict badge.
    cheapest: ranked[0] ?? null,
    datePairFigure,
  };
}
