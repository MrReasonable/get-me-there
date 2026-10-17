/** Spec §6.5, §6.9, §10 `/results` and the row set every view reads. */
import {
  type apiContract,
  type CellOutcome,
  cellKeyString,
  dedupByItinerary,
  type Execution,
  isTruncated,
  type ResolvedSpace,
  rankRows,
  type SearchDefinition,
} from '@gmt/core';
import type { CalendarPriceRow } from '@gmt/db';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { coverageSummaryFor, SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import {
  type Basis,
  calendarRow,
  latestPerOffer,
  notSeenResolver,
  type ResultRow,
  type RowContext,
  verifiedRow,
} from './rows.js';
import { cellInSpace, currentSpace } from './space.js';

export type ResultsResponse = z.infer<typeof apiContract.resultsResponseSchema>;
export type ResultsQuery = z.infer<typeof apiContract.resultsQuerySchema>;
/** Spec §6.5: at most 1000 rows per response. */
export const RESULTS_CAP = 1000;
/** Executions read per definition (newest first); far above a year of weekly runs plus children. */
export const EXECUTIONS_LIMIT = 500;

export interface Loaded {
  def: SearchDefinition;
  space: ResolvedSpace;
  rc: RowContext;
  /** All executions of the definition (children included), newest first. */
  all: Execution[];
  /** The executions the rows come from (all, or the one `executionId`). */
  scoped: Execution[];
  latestParent: Execution | null;
  /** One row per offer inside the current space, verdicts evaluated now; not deduped. */
  verified: ResultRow[];
  /**
   * Observation ids whose price the final step did not confirm (no `price` supplied field, decisions 27, 37). The
   * verified-basis minima of the views skip them, so an unconfirmed fare is never shown as an itinerary-search price
   * (decisions 45, 48); `/results` returns them, and the web badges them from `verdicts`.
   */
  unconfirmed: ReadonlySet<number>;
  /** One row per (provider, cell) inside the current space; reused copies ignored. */
  calendar: ResultRow[];
  /** Itineraries / calendar rows dropped because they fall outside the current space. */
  excluded: { verified: number; calendar: number };
}

/**
 * Decisions 36, 47: a calendar price is truncated when its discovery outcome's `last_error` starts with core's
 * `TRUNCATED_NOTE`, tested with core's `isTruncated`. One outcome read per execution.
 */
export function truncationOf(
  ports: Ports,
): (r: Pick<CalendarPriceRow, 'executionId' | 'reusedFromExecutionId' | 'providerId' | 'cell'>) => boolean {
  const byExecution = new Map<string, Map<string, CellOutcome>>();
  return (r) => {
    // why: a reused copy's truncation is its source's: the copying run read no pages (decision 58).
    const source = r.reusedFromExecutionId ?? r.executionId;
    let outcomes = byExecution.get(source);
    if (outcomes === undefined) {
      outcomes = new Map(
        ports.repos.cells
          .outcomes(source, { stage: 'discovery' })
          .map((o) => [`${o.providerId}|${cellKeyString(o)}`, o]),
      );
      byExecution.set(source, outcomes);
    }
    return isTruncated(outcomes.get(`${r.providerId}|${cellKeyString(r.cell)}`)?.lastError ?? null);
  };
}

/** The latest calendar price per (provider, cell) among `rows` (max fetchedAt, tie on id), reused copies included. */
function latestPerProviderCell(rows: readonly CalendarPriceRow[]): CalendarPriceRow[] {
  const best = new Map<string, CalendarPriceRow>();
  for (const r of rows) {
    const key = `${r.providerId}|${cellKeyString(r.cell)}`;
    const cur = best.get(key);
    if (cur === undefined || r.fetchedAt > cur.fetchedAt || (r.fetchedAt === cur.fetchedAt && r.id > cur.id))
      best.set(key, r);
  }
  return [...best.values()];
}

/**
 * Plans decisions 54 and 58: a calendar price is "superseded by a later search" when the latest parent execution that
 * searched its cell for that provider (outcome priced, empty or no_data) is newer than the price's execution and found
 * the cell empty or no_data. A newer run that skipped the cell, failed on it or reused it does not count as a search,
 * so an older "no fares" still marks the price. `superseded` is the field on rows and on the views' calendar figures.
 */
function supersessionOf(
  ports: Ports,
  all: readonly Execution[],
): (r: Pick<CalendarPriceRow, 'executionId' | 'providerId' | 'cell'>) => boolean {
  // why: `all` is newest first (created_at, then rowid), so a later position is an earlier search, even when two
  // executions share a created_at second.
  const position = new Map(all.map((e, i) => [e.id, i]));
  const lastSearch = new Map<string, { at: number; found: boolean }>();
  all.forEach((e, at) => {
    if (e.isChild) return;
    for (const o of ports.repos.cells.outcomes(e.id, { stage: 'discovery' })) {
      const key = `${o.providerId}|${cellKeyString(o)}`;
      if (!SEARCHED.has(o.status) || lastSearch.has(key)) continue;
      lastSearch.set(key, { at, found: o.status === 'priced' });
    }
  });
  return (r) => {
    const fetchedBy = position.get(r.executionId);
    const last = lastSearch.get(`${r.providerId}|${cellKeyString(r.cell)}`);
    return fetchedBy !== undefined && last !== undefined && last.at < fetchedBy && !last.found;
  };
}

/**
 * Everything the read routes share: rows of both bases for the definition's current space and cabin. `executionIds`
 * scopes the rows to those executions (a run picked with `?executionId=`, or the duration analysis's set): calendar
 * rows are then the latest each of them holds — fetched, or reused within its refresh window (decision 58, so a run's
 * prices agree with its coverage, which counts a reused cell as priced) — read per execution rather than filtered out
 * of the global latest, so a cell a newer run priced again still shows the scoped run's price (review prov-003). "Not
 * seen in latest search" and "superseded by a later search" always compare with the newest search of the cell.
 */
export function loadRows(def: SearchDefinition, ports: Ports, executionIds?: readonly string[]): Loaded {
  const now = ports.clock.now();
  const space = currentSpace(def, ports.clock.todayLondon());
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const wanted = executionIds === undefined ? null : new Set(executionIds);
  const scoped = wanted === null ? all : all.filter((e) => wanted.has(e.id));
  const ids = scoped.map((e) => e.id);
  const rc: RowContext = { def, now, config: ports.config, providers: ports.providers };
  const latestParent = all.find((e) => !e.isChild) ?? null;

  // why: space null reads every cell, so rows outside the current space can be counted (review focus 4).
  const raw = ports.repos.itineraries.observationsForDefinition(def.id, {
    executionIds: ids,
    space: null,
    cabin: def.cabin,
    includeChildren: true,
  });
  // why: "seen in execution X" must consider every observation of the definition, not only each offer's latest one and
  // not only the scoped executions: the newest search of a cell may be outside the scope (review prov I1).
  const everyObservation =
    wanted === null
      ? raw
      : ports.repos.itineraries.observationsForDefinition(def.id, {
          executionIds: 'all',
          space: null,
          cabin: def.cabin,
          includeChildren: true,
        });
  const notSeen = notSeenResolver(
    everyObservation,
    (c) => ports.repos.itineraries.latestVerificationOutcomeForCell(def.id, c, def.cabin),
    now,
  );
  const latest = latestPerOffer(raw);
  const inSpace = latest.filter((o) => cellInSpace(space, o.cell));
  const hashes = (xs: readonly { itinerary: { hash: string } }[]) =>
    new Set(xs.map((o) => o.itinerary.hash)).size;

  const calendarAll =
    wanted === null
      ? ports.repos.calendarPrices
          .latestPerCell(def.id, def.cabin, null)
          .filter((r) => r.reusedFromExecutionId === null)
      : latestPerProviderCell(
          ids.flatMap((id) => ports.repos.calendarPrices.heldBy(id)).filter((r) => r.cabin === def.cabin),
        );
  const calendarIn = calendarAll.filter((r) => cellInSpace(space, r.cell));
  const truncated = truncationOf(ports);
  const superseded = supersessionOf(ports, all);

  return {
    def,
    space,
    rc,
    all,
    scoped,
    latestParent,
    verified: inSpace.map((o) => verifiedRow(o, rc, notSeen(o))),
    unconfirmed: new Set(inSpace.filter((o) => !o.suppliedFields.includes('price')).map((o) => o.id)),
    calendar: calendarIn.map((r) => calendarRow(r, rc, truncated(r), superseded(r))),
    excluded: {
      verified: hashes(latest) - hashes(inSpace),
      calendar: calendarAll.length - calendarIn.length,
    },
  };
}

/** A verified-basis row whose price the final step confirmed (decisions 45, 48). */
export function confirmedIn(loaded: Loaded): (r: ResultRow) => boolean {
  return (r) => r.observationId === null || !loaded.unconfirmed.has(r.observationId);
}

/** Spec §6.9 default basis and its reason. */
export function chooseBasis(loaded: Loaded, requested: Basis | undefined): { basis: Basis; reason: string } {
  const hasVerification = (loaded.latestParent?.snapshot ?? loaded.def).providers.verification.length > 0;
  if (requested === 'calendar') return { basis: 'calendar', reason: API_TEXT.basisRequestedCalendar };
  if (requested === 'verified') return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
  if (!hasVerification) return { basis: 'calendar', reason: API_TEXT.basisNoVerificationProvider };
  if (loaded.verified.length === 0 && loaded.excluded.verified === 0)
    return { basis: 'calendar', reason: API_TEXT.basisNoObservations };
  return { basis: 'verified', reason: API_TEXT.basisItinerarySearch };
}

/** Spec §10 `GET /api/definitions/:id/results`. No sort or filter parameters: the client sorts and filters (spec §6.5). */
export function assembleResults(def: SearchDefinition, q: ResultsQuery, ports: Ports): ResultsResponse {
  const loaded = loadRows(def, ports, q.executionId === undefined ? undefined : [q.executionId]);
  const shown = loaded.scoped[0];
  if (q.executionId !== undefined && shown === undefined)
    throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound);
  const { basis, reason } = chooseBasis(loaded, q.basis);
  const ranked =
    basis === 'verified'
      ? rankRows(dedupByItinerary(loaded.verified, loaded.rc.now), loaded.rc.now)
      : // why: decision 54: a superseded calendar price ranks after every current one (a stable partition).
        rankRows(loaded.calendar, loaded.rc.now).sort((a, b) => Number(a.superseded) - Number(b.superseded));
  const excluded = basis === 'verified' ? loaded.excluded.verified : loaded.excluded.calendar;
  const total = ranked.length;
  const limit = Math.min(q.limit ?? RESULTS_CAP, RESULTS_CAP);
  return {
    rows: ranked.slice(0, limit),
    total,
    truncated: total > limit,
    basis,
    basisReason: excluded > 0 ? `${reason} · ${API_TEXT.insideSpace(total, total + excluded)}` : reason,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    // why: with ?executionId= the header describes the run shown, alone (review prov-003, decision 42's principle).
    coverage:
      shown === undefined || q.executionId === undefined
        ? coverageSummaryFor(loaded.latestParent, loaded.all, ports)
        : coverageSummaryFor(shown, [], ports),
    excludedByCurrentSpace: excluded,
    verificationProviderConfigured: def.providers.verification.length > 0,
    // why: decision 45 (review prov I2): the headline is never an unconfirmed fare while a confirmed row exists; when
    // none does, the unconfirmed row is shown with its `priceConfirmed: 'unverified'` verdict, which the web badges.
    cheapest: (basis === 'verified' ? ranked.find(confirmedIn(loaded)) : undefined) ?? ranked[0] ?? null,
  };
}
