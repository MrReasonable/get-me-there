/**
 * Design 2026-11-08 §6.1 "Search log for these dates" (plan Task 5): one row per run that searched or read these dates
 * (a run that found them empty included, with no calendar price),
 * plus one per flight list read by hand (no execution), newest first. A row's calendar price is the run's own fetch
 * (never a copy it reused); its flights are what the run's newest list of these dates said, by the list reads the board
 * uses (`listReadOf`, `pairingReadOf`). Why a run read no list is not recorded, so the row says `not-read` and never
 * guesses a reason.
 */
import {
  type apiContract,
  type Execution,
  type FlightLimits,
  type IsoDateTime,
  isTruncated,
  pairingKindOf,
  pairingReadOf,
} from '@gmt/core';
import type { CalendarPriceRow, StoredFlightList } from '@gmt/db';
import type { z } from 'zod';
import { listReadOf, pairingGroupOf } from './pairings.js';
import { type PriceCell, priceCell, type RowContext } from './rows.js';

type TripLog = z.infer<typeof apiContract.tripResponseSchema>['log'];
type LogFlights = TripLog[number]['flights'];

/** What a run's (or a by-hand read's) newest list of these dates said; `not-read` when it read none. */
export function logFlightsOf(
  l: StoredFlightList | undefined,
  limits: FlightLimits,
  now: IsoDateTime,
  refreshHours: number,
): LogFlights {
  if (l === undefined) return { kind: 'not-read' };
  const read = listReadOf(l, limits, now, refreshHours);
  if (read.candidate === null) {
    if (read.read === 'list-failed') return { kind: 'failed', cause: read.reason };
    return read.read === 'outbound-only' ? { kind: 'outbound-only' } : { kind: 'no-return' };
  }
  const c = read.candidate;
  // why: the log compares no grid price, so a fitting pairing under today's limits is a trip at any age
  const pairingRead = pairingReadOf(c, null);
  if (pairingRead === 'over-limit') return { kind: 'none-within' };
  if (pairingRead === 'within-other-limits') return { kind: 'other-limits' };
  const g = pairingGroupOf(c);
  return {
    kind: 'trip',
    price: {
      pricePence: g.pricePence,
      provenance: c.provenance,
      stale: c.stale,
      ageHours: c.ageHours,
      truncated: false,
    },
    pairingKind: pairingKindOf(g),
    seller: g.seller,
  };
}

/** A run's calendar price for these dates: the cheapest it fetched across the airport pairs in scope (ties: first). */
function runCalendar(
  prices: ReadonlyArray<{ price: CalendarPriceRow; sourceLastError: string | null }>,
  rc: RowContext,
): PriceCell | null {
  let best: { price: CalendarPriceRow; sourceLastError: string | null } | null = null;
  for (const p of prices) if (best === null || p.price.pricePence < best.price.pricePence) best = p;
  return best === null
    ? null
    : priceCell(
        best.price.pricePence,
        best.price.provenance,
        'calendar',
        rc,
        isTruncated(best.sourceLastError),
      );
}

/**
 * The log over the runs (`executions`, newest first), the cells each searched itself (`searched`: its discovery
 * outcomes of these dates), their fetched prices and every list of these dates (all already narrowed to the scope's
 * airport pairs; the lists newest first), under today's limits and the search's refresh.
 */
export function tripLog(o: {
  executions: readonly Execution[];
  searched: ReadonlyArray<{ executionId: string }>;
  prices: ReadonlyArray<{ executionId: string; price: CalendarPriceRow; sourceLastError: string | null }>;
  lists: readonly StoredFlightList[];
  rc: RowContext;
  limits: FlightLimits;
  refreshHours: number;
}): TripLog {
  const flights = (l: StoredFlightList | undefined) => logFlightsOf(l, o.limits, o.rc.now, o.refreshHours);
  const rows: TripLog = [];
  for (const e of o.executions) {
    const prices = o.prices.filter((p) => p.executionId === e.id);
    // why: `lists` is newest first, so the first of the run's is its newest for these dates
    const list = o.lists.find((l) => l.executionId === e.id);
    const touched = prices.length > 0 || list !== undefined || o.searched.some((s) => s.executionId === e.id);
    if (!touched) continue;
    rows.push({
      at: e.startedAt ?? e.createdAt,
      byHand: false,
      calendar: runCalendar(prices, o.rc),
      flights: flights(list),
    });
  }
  for (const l of o.lists)
    if (l.executionId === null)
      rows.push({ at: l.fetchedAt, byHand: true, calendar: null, flights: flights(l) });
  // why: a stable sort, so rows at the same instant keep the runs' own newest-first order
  return rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
