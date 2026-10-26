/** Spec §10 `/calendar` (View B; retired by WP19 Task 19.8). The calendar gap moved to `calendarGap.ts`. */
import {
  addDays,
  type apiContract,
  type CellOutcome,
  cellKeyString,
  dedupByItinerary,
  type Iata,
  type ProviderId,
  type RollUp,
  type SearchDefinition,
  sixBuckets,
} from '@gmt/core';
import type { z } from 'zod';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { onDemandSearched, SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { pickCalendar, pickVerified } from './pick.js';
import { confirmedIn, loadRows } from './results.js';
import { calendarStaleAfterHours, priceOf, type ResultRow } from './rows.js';

export type CalendarResponse = z.infer<typeof apiContract.calendarResponseSchema>;

/** A verified-basis figure with its "not seen in latest search" mark (decision 54). */
function verifiedFigure(r: ResultRow) {
  return { ...priceOf(r), notSeenInLatest: r.notSeenInLatest };
}

/** True when the cell's verification roll-up is priced with no confirmed price (decisions 45, 48, 51). */
function unconfirmed(r: RollUp | undefined): boolean {
  return r?.status === 'priced' && r.minPence === null;
}

/**
 * Spec §10 `GET /calendar`: one entry per departure date of the current window, for every destination or, with
 * `destination` (plan decision 53), for that destination's cells only — buckets, selection, minima and
 * `unconfirmedCells` alike, so a filtered day never counts another airport. Six-bucket counts and selection come from
 * the latest parent execution's outcomes (spec §8.1); completed children count per day as "on demand". The verified
 * figures (class verified; partially verified with its count) count only confirmed prices and are picked over every
 * confirmed offer before the per-itinerary dedup, so neither an unconfirmed offer (review prov-009) nor a cheaper stale
 * offer of the same itinerary (decision 58) hides the price shown; each prefers a row the newest search returned, then a
 * fresh one, then the cheaper (decision 54, spec §11 View B), with its marks. `unconfirmedCells` is the latest parent's
 * selected cells whose verification roll-up is priced with no confirmed price. No per-destination figures (decision 58).
 */
export function assembleCalendar(
  def: SearchDefinition,
  destination: Iata | undefined,
  ports: Ports,
): CalendarResponse {
  if (destination !== undefined && !def.destinations.includes(destination))
    throw new ApiError(422, 'unknown_destination', API_TEXT.unknownDestination);
  const loaded = loadRows(def, ports);
  const parent = loaded.latestParent;
  const mine = (c: { destination: Iata }) => destination === undefined || c.destination === destination;
  const outcomes: CellOutcome[] =
    parent === null ? [] : ports.repos.cells.outcomes(parent.id, { stage: 'discovery' }).filter(mine);
  const rollUps =
    parent === null
      ? new Map<string, { discovery: RollUp; verification: RollUp }>()
      : ports.repos.cells.rollUps(parent.id);
  const selected =
    parent === null ? [] : ports.repos.cells.selected(parent.id).filter(({ cell }) => mine(cell));
  // why: ssr-002: the header's "+C on demand" predicate, so a day never counts a child that searched nothing.
  const children = onDemandSearched(loaded.all, ports, loaded.space).filter(
    (e) => e.cell !== null && mine(e.cell),
  );
  // why: plan decision 58: the minima are picked (seen, then fresh, then cheaper) over every confirmed offer, before the
  // per-itinerary dedup, whose primary offer is chosen on price before age and would hide a fresh offer from another
  // seller behind a cheaper stale one. The dedup only sizes the partially-verified `count`.
  const confirmed = loaded.verified.filter(confirmedIn(loaded)).filter((r) => mine(r.cell));
  const verified = dedupByItinerary(confirmed, loaded.rc.now);
  const calendar = loaded.calendar.filter((r) => mine(r.cell));
  const providers = def.providers.discovery;
  const days: CalendarResponse['days'] = [];
  for (let d = loaded.space.departureFrom; d <= loaded.space.departureTo; d = addDays(d, 1)) {
    const onDay = (r: ResultRow) => r.cell.departureDate === d;
    const offers = confirmed.filter(onDay);
    const cal = calendar.filter(onDay);
    const partial = verified.filter((r) => onDay(r) && r.verdictClass === 'partially-verified');
    const best = pickVerified(offers.filter((r) => r.verdictClass === 'verified'));
    const bestPartial = pickVerified(offers.filter((r) => r.verdictClass === 'partially-verified'));
    const bestCal = pickCalendar(cal);
    const sel = selected.filter(({ cell }) => cell.departureDate === d);
    days.push({
      date: d,
      discovery: providers.flatMap((providerId: ProviderId) => {
        const list = outcomes.filter((o) => o.departureDate === d && o.providerId === providerId);
        return list.length === 0 ? [] : [{ providerId, buckets: sixBuckets(list), total: list.length }];
      }),
      verification: {
        selected: sel.length,
        itinerarySearched: sel.filter(({ cell }) => {
          const s = rollUps.get(cellKeyString(cell))?.verification.status ?? null;
          return s !== null && SEARCHED.has(s);
        }).length,
        onDemand: children.filter((e) => e.cell?.departureDate === d).length,
        unconfirmedCells: sel.filter(({ cell }) =>
          unconfirmed(rollUps.get(cellKeyString(cell))?.verification),
        ).length,
      },
      cheapestVerified:
        best === null || best.itineraryHash === null
          ? null
          : { ...verifiedFigure(best), cell: best.cell, itineraryHash: best.itineraryHash },
      cheapestPartiallyVerified:
        bestPartial === null || bestPartial.itineraryHash === null
          ? null
          : {
              ...verifiedFigure(bestPartial),
              cell: bestPartial.cell,
              itineraryHash: bestPartial.itineraryHash,
              count: partial.length,
            },
      cheapestCalendar:
        bestCal === null ? null : { ...priceOf(bestCal), cell: bestCal.cell, superseded: bestCal.superseded },
    });
  }
  const calendarStale: Partial<Record<ProviderId, number>> = {};
  for (const id of providers) calendarStale[id] = calendarStaleAfterHours(loaded.rc, id);
  return {
    days,
    executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)),
    staleAfterHours: ports.config.staleAfterHours,
    calendarStaleAfterHours: calendarStale,
  };
}
