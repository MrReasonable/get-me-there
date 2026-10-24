import {
  type Cabin,
  type Cell,
  cellKeyString,
  type Iata,
  type IsoDateTime,
  type Provenance,
  type ProviderId,
  type SourceKind,
} from '@gmt/core';
import type { ExecutionSummary, ItineraryHistoryResponse, RouteHistoryResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateLong, formatTripShort } from '../../format.js';
import { SERIES_COLOURS } from '../../lib/palette.js';
import { sourceLabelOf } from '../../lib/sources.js';
import { DAY_MS, dateMs, instantMs } from '../../lib/time.js';

type CalendarFetchPoint = RouteHistoryResponse['calendarSeries'][number]['points'][number];
type OfferPoint = ItineraryHistoryResponse['series'][number]['points'][number];
/** A point of a route-level series: no cabin, so no full provenance (spec §11); plotted by date. */
export type RoutePoint = RouteHistoryResponse['routeSeries'][number]['points'][number];

/** A fetch-time point: a price with its provenance, or a gap that breaks the line. Priced points always carry provenance. */
export type PlotPoint =
  | {
      kind: 'price';
      t: number;
      at: IsoDateTime;
      /** The run that fetched it: lines join only consecutive runs (plan decision 52). */
      executionId: string;
      pricePence: number;
      provenance: Provenance;
      stale: boolean;
      truncated: boolean;
      /** The pair's cheapest cell at that run (calendar series); null for offers. */
      cell: Cell | null;
      /** True when the cell differs from the previous point's: the line then joins different date pairs. */
      cellChanged: boolean;
      /** False for an offer whose price the final step did not confirm (plan decisions 27, 37). */
      priceConfirmed: boolean;
      /** When the fetching run was a catch-up: when it ran and the firing it ran for (spec §8.2 rev 36), from the api. */
      catchUp: CalendarFetchPoint['catchUp'];
    }
  | { kind: 'gap'; t: number; pricePence: null };

/** One fetch-time series (spec §11 History: one series per provider and kind). */
export interface PlotLine {
  key: string;
  kind: 'calendar' | 'offer' | 'offer-unconfirmed';
  providerId: ProviderId;
  name: string;
  /** Palette index: the pair's in the overlay, else stable per series key (review ui-r2-009). */
  colour: number;
  points: PlotPoint[];
}

/** A route-level point: a vendor price for one travel date, or a gap for a missing date. */
export type RoutePlotPoint =
  | { kind: 'price'; t: number; pricePence: number; route: RoutePoint }
  | { kind: 'gap'; t: number; pricePence: null };

/** One route-level series, plotted by travel date in its own chart (plan decision 38). */
export interface RouteLine {
  key: string;
  providerId: ProviderId;
  cabin: Cabin | 'unknown';
  /** The searched trip in words ("5–15 Nov"), or null for a migrated series that never recorded one (ruling 6). */
  trip: string | null;
  name: string;
  colour: number;
  points: RoutePlotPoint[];
}

const tripOf = (t: RouteHistoryResponse['routeSeries'][number]['trip']): string | null =>
  t === null ? null : formatTripShort(t.departureDate, t.returnDate);

/** Each parent run's place in the definition's run order, oldest 0 (executions arrive newest first). */
export type RunOrder = ReadonlyMap<string, number>;

/**
 * The definition's run order from the executions list (the status bar's query; plan decision 52). One-cell child runs
 * are not in it: they search one cell, not the route, so a point they fetched is joined to no neighbour.
 */
export function runOrder(executions: ReadonlyArray<Pick<ExecutionSummary, 'id' | 'isChild'>>): RunOrder {
  const parents = executions.filter((e) => !e.isChild).reverse();
  return new Map(parents.map((e, i) => [e.id, i]));
}

/**
 * Sorts by t and inserts a gap between neighbours that `joined` refuses, so the chart (connectNulls off) breaks the
 * line there. A line between two points never implies a price between them; the chart caption says so.
 */
export function withBreaks<P extends { t: number }, G>(
  points: readonly P[],
  joined: (a: P, b: P) => boolean,
  gap: (t: number) => G,
): Array<P | G> {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const out: Array<P | G> = [];
  let prev: P | null = null;
  for (const p of sorted) {
    if (prev !== null && !joined(prev, p)) out.push(gap(prev.t + (p.t - prev.t) / 2));
    out.push(p);
    prev = p;
  }
  return out;
}

/** Plan decision 52: two points join only when their runs are consecutive runs of the definition, never by time gap. */
export function consecutiveRuns(order: RunOrder) {
  return (a: { executionId: string }, b: { executionId: string }): boolean => {
    const i = order.get(a.executionId);
    const j = order.get(b.executionId);
    return i !== undefined && j !== undefined && j === i + 1;
  };
}

const fetchGap = (t: number): PlotPoint => ({ kind: 'gap', t, pricePence: null });
const routeGap = (t: number): RoutePlotPoint => ({ kind: 'gap', t, pricePence: null });
// why: a route-level series is daily (spec §7 route_price_history); a missing travel date breaks the line.
const nextDay = (a: { t: number }, b: { t: number }) => b.t - a.t <= DAY_MS;

/** Marks each calendar point whose cheapest cell differs from the previous point's (prov-006). */
function markCellChanges(points: PlotPoint[]): PlotPoint[] {
  let prev: string | null = null;
  return points.map((p) => {
    if (p.kind !== 'price' || p.cell === null) return p;
    const key = cellKeyString(p.cell);
    const changed = prev !== null && prev !== key;
    prev = key;
    return { ...p, cellChanged: changed };
  });
}

function sourceOf(points: ReadonlyArray<{ provenance: Provenance }>): string {
  const kinds: SourceKind[] = points.map((p) => p.provenance.sourceKind);
  return sourceLabelOf(kinds);
}

const cabinName = (c: Cabin | 'unknown') =>
  c === 'unknown' ? COPY.historyView.cabinNotStated : COPY.cabinName[c];
const prefixed = (pair: string | null, name: string) =>
  pair === null ? name : COPY.historyView.pairPrefix(pair, name);

/**
 * Route history (spec §11 History): the calendar series per provider and cabin at fetchedAt, one point per run (the
 * pair's minimum across its cells, carrying that cell), and the route-level series per provider and cabin by travel
 * date, named by its provider (plan decision 52). Colours are set by `assignColours`.
 */
export function linesFromRoute(
  resp: RouteHistoryResponse,
  order: RunOrder,
  pair: string | null = null,
): { fetch: PlotLine[]; route: RouteLine[] } {
  const H = COPY.historyView;
  const fetch: PlotLine[] = resp.calendarSeries
    .filter((s) => s.points.length > 0)
    .map((s) => {
      const priced = s.points.map(
        (p: CalendarFetchPoint): Extract<PlotPoint, { kind: 'price' }> => ({
          kind: 'price',
          t: instantMs(p.at),
          at: p.at,
          executionId: p.executionId,
          pricePence: p.pricePence,
          provenance: p.provenance,
          stale: p.stale,
          truncated: p.truncated,
          cell: p.cell,
          cellChanged: false,
          priceConfirmed: true,
          catchUp: p.catchUp,
        }),
      );
      return {
        key: `${pair ?? ''}calendar:${s.providerId}:${s.cabin}`,
        kind: 'calendar',
        providerId: s.providerId,
        name: prefixed(pair, H.calendarSeries(sourceOf(s.points), cabinName(s.cabin))),
        colour: 0,
        points: markCellChanges(withBreaks(priced, consecutiveRuns(order), fetchGap)),
      };
    });
  const route: RouteLine[] = resp.routeSeries
    .filter((s) => s.points.length > 0)
    .map((s) => ({
      key: `${pair ?? ''}route:${s.providerId}:${s.cabin}:${s.trip?.departureDate ?? ''}:${s.trip?.returnDate ?? ''}`,
      providerId: s.providerId,
      cabin: s.cabin,
      trip: tripOf(s.trip),
      name: prefixed(pair, H.routeSeries(H.historyVendor[s.providerId], tripOf(s.trip), cabinName(s.cabin))),
      colour: 0,
      points: withBreaks(
        s.points.map(
          (p): RoutePlotPoint => ({ kind: 'price', t: dateMs(p.date), pricePence: p.pricePence, route: p }),
        ),
        nextDay,
        routeGap,
      ),
    }));
  return { fetch, route };
}

/**
 * Itinerary history: per provider and seller, one solid series of confirmed prices and one dotted series of prices
 * the final step did not confirm (plan decision 38), both at fetchedAt and joined only across consecutive runs.
 */
export function linesFromItinerary(resp: ItineraryHistoryResponse, order: RunOrder): PlotLine[] {
  const H = COPY.historyView;
  const joined = consecutiveRuns(order);
  const lines = resp.series.flatMap((s) => {
    const toPlot = (p: OfferPoint): Extract<PlotPoint, { kind: 'price' }> => ({
      kind: 'price',
      t: instantMs(p.at),
      at: p.at,
      executionId: p.executionId,
      pricePence: p.pricePence,
      provenance: p.provenance,
      stale: p.stale,
      truncated: p.truncated,
      cell: null,
      cellChanged: false,
      priceConfirmed: p.priceConfirmed,
      catchUp: p.catchUp,
    });
    const confirmed = s.points.filter((p) => p.priceConfirmed);
    const unconfirmed = s.points.filter((p) => !p.priceConfirmed);
    const out: PlotLine[] = [];
    if (confirmed.length > 0) {
      out.push({
        key: `offer:${s.providerId}:${s.seller}:${s.cabin}`,
        kind: 'offer',
        providerId: s.providerId,
        name: H.offerSeries(sourceOf(confirmed), s.seller, cabinName(s.cabin)),
        colour: 0,
        points: withBreaks(confirmed.map(toPlot), joined, fetchGap),
      });
    }
    if (unconfirmed.length > 0) {
      out.push({
        key: `offer-unconfirmed:${s.providerId}:${s.seller}:${s.cabin}`,
        kind: 'offer-unconfirmed',
        providerId: s.providerId,
        name: H.offerUnconfirmedSeries(sourceOf(unconfirmed), s.seller, cabinName(s.cabin)),
        colour: 0,
        points: withBreaks(unconfirmed.map(toPlot), joined, fetchGap),
      });
    }
    return out;
  });
  return assignColours(lines);
}

/** Colour by the series key's place among the keys shown (sorted), so a series keeps its colour as data refreshes. */
export function assignColours<L extends { key: string; colour: number }>(lines: readonly L[]): L[] {
  const keys = [...new Set(lines.map((l) => l.key))].sort();
  return lines.map((l) => ({ ...l, colour: keys.indexOf(l.key) }));
}

export type Pair = { origin: Iata; destination: Iata };
export const pairKey = (p: Pair) => `${p.origin}-${p.destination}`;

/**
 * Every line of the pairs shown. In the overlay every line of a pair takes the pair's colour (its place in the
 * definition's pairs; at most SERIES_COLOURS.length pairs are drawn) and the kind keeps its dash, so two pairs never
 * share a colour (review ui-r2-009); one pair colours its series by key.
 */
export function linesForPairs(
  responses: ReadonlyArray<RouteHistoryResponse | undefined>,
  pairs: readonly Pair[],
  order: RunOrder,
  overlay: boolean,
): { fetch: PlotLine[]; route: RouteLine[] } {
  const fetch: PlotLine[] = [];
  const route: RouteLine[] = [];
  responses.forEach((r, i) => {
    const pair = pairs[i];
    if (r === undefined || pair === undefined) return;
    const lines = linesFromRoute(r, order, overlay ? pairKey(pair) : null);
    fetch.push(...lines.fetch.map((l) => ({ ...l, colour: i })));
    route.push(...lines.route.map((l) => ({ ...l, colour: i })));
  });
  return overlay ? { fetch, route } : { fetch: assignColours(fetch), route: assignColours(route) };
}

/** True when more series are drawn than the palette has colours, so the chart says colours repeat. */
export function coloursRepeat(lines: ReadonlyArray<{ colour: number }>): boolean {
  return lines.some((l) => l.colour >= SERIES_COLOURS.length);
}

/** The itinerary's heading from the api's own cell and carriers (plan decision 52, review prov-005). */
export function itineraryHeading(resp: Pick<ItineraryHistoryResponse, 'cell' | 'carriers'>): string {
  const c = resp.cell;
  return COPY.historyView.itineraryHeading(
    `${c.origin}→${c.destination}`,
    formatIsoDateLong(c.departureDate),
    formatIsoDateLong(c.returnDate),
    resp.carriers.join(', '),
  );
}

/** What the cross-execution header shows (plan decision 38): how many runs the lines span, first and last fetch. */
export function historySpan(
  lines: readonly PlotLine[],
  /** UI-010: executions that are on-demand children, counted as searches, never as runs. */
  childIds: ReadonlySet<string>,
): { runs: number; onDemand: number; firstAt: IsoDateTime; lastAt: IsoDateTime } | null {
  const priced = lines.flatMap((l) => l.points.flatMap((p) => (p.kind === 'price' ? [p] : [])));
  const first = priced.reduce<(typeof priced)[number] | null>(
    (a, p) => (a === null || p.t < a.t ? p : a),
    null,
  );
  const last = priced.reduce<(typeof priced)[number] | null>(
    (a, p) => (a === null || p.t > a.t ? p : a),
    null,
  );
  if (first === null || last === null) return null;
  const ids = new Set(priced.map((p) => p.executionId));
  const onDemand = [...ids].filter((id) => childIds.has(id)).length;
  return { runs: ids.size - onDemand, onDemand, firstAt: first.at, lastAt: last.at };
}

/** The header's stale flag: true when every series' newest point is stale. */
export function newestAllStale(lines: readonly PlotLine[]): boolean {
  const newest = lines.flatMap((l) => {
    const priced = l.points.flatMap((p) => (p.kind === 'price' ? [p] : []));
    const n = priced[priced.length - 1];
    return n === undefined ? [] : [n];
  });
  return newest.length > 0 && newest.every((p) => p.stale);
}
