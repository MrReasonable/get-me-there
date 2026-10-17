import type { ProviderId, SourceKind } from '@gmt/core';
import type { DurationResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { sourceLabelOf } from '../../lib/sources.js';

type Night = DurationResponse['byNights'][number];
/**
 * A per-nights minimum as the duration route sends it: a price cell with the cell it came from (plan decision 38), and
 * its decision-54 mark (`notSeenInLatest` on the verified minimum, `superseded` on a calendar one).
 */
export type DurationPrice = Night['minCalendar'][number]['price'] | NonNullable<Night['minVerified']>;

/** Cells of one nights value a series searched, of the cells in its scope (review prov-r2-007). */
export interface SearchedCount {
  searched: number;
  total: number;
}

/** One series at one nights value: its minimum (or null), n, and how much of this nights value that series searched. */
export interface DurationCell {
  price: DurationPrice | null;
  n: number;
  searched: SearchedCount;
  /** A calendar series' six buckets at this nights value (N1); the verified series has none. */
  buckets?: Night['searched']['discovery'][number]['buckets'];
}
export interface DurationRow {
  nights: number;
  cells: Record<string, DurationCell>;
  /** False when no series searched any cell of this nights value: the x axis marks it with a star. */
  anySearched: boolean;
}
export interface DurationSeries {
  key: string;
  kind: 'verified' | 'calendar';
  providerId: ProviderId | null;
  totalN: number;
  name: string;
  shortName: string;
}
export interface DurationData {
  rows: DurationRow[];
  series: DurationSeries[];
  isEmpty: boolean;
  /** Prices shown and how many are stale: the header's stale line and flag (review arch2-008). */
  shownPrices: number;
  stalePrices: number;
}

const NONE: SearchedCount = { searched: 0, total: 0 };

const VERIFIED = 'verified';
const calendarKey = (p: ProviderId) => `calendar:${p}`;

/**
 * Rows for every nights in [minNights, maxNights] and one series per basis and provider (spec §11 View C). Missing
 * values stay null so the chart leaves a gap (never 0, never interpolated); each cell carries its own series'
 * `searched` flag, so "not searched" and "searched, no price" stay distinct per series (plan decision 38). A nights
 * value the api omits was searched by nothing.
 */
export function buildDurationData(
  resp: DurationResponse,
  minNights: number,
  maxNights: number,
  hasVerification: boolean,
): DurationData {
  const byNights = new Map<number, Night>(resp.byNights.map((r) => [r.nights, r]));
  const providers: ProviderId[] = [];
  const kinds = new Map<ProviderId, SourceKind[]>();
  for (const r of resp.byNights) {
    for (const d of r.searched.discovery) if (!providers.includes(d.providerId)) providers.push(d.providerId);
    for (const m of r.minCalendar) {
      if (!providers.includes(m.providerId)) providers.push(m.providerId);
      kinds.set(m.providerId, [...(kinds.get(m.providerId) ?? []), m.price.provenance.sourceKind]);
    }
  }
  const rows: DurationRow[] = [];
  for (let nights = minNights; nights <= maxNights; nights += 1) {
    const r = byNights.get(nights);
    const v = r?.minVerified ?? null;
    const cells: Record<string, DurationCell> = {
      [VERIFIED]: { price: v, n: v?.n ?? 0, searched: r?.searched.verification ?? NONE },
    };
    for (const p of providers) {
      const m = r?.minCalendar.find((x) => x.providerId === p);
      const d = r?.searched.discovery.find((x) => x.providerId === p);
      const searched = d === undefined ? NONE : { searched: d.searched, total: d.total };
      cells[calendarKey(p)] = {
        price: m?.price ?? null,
        n: m?.n ?? 0,
        searched,
        ...(d === undefined ? {} : { buckets: d.buckets }),
      };
    }
    rows.push({ nights, cells, anySearched: Object.values(cells).some((c) => c.searched.searched > 0) });
  }
  const totalN = (key: string) => rows.reduce((sum, r) => sum + (r.cells[key]?.n ?? 0), 0);
  const anyVerified = rows.some((r) => r.cells[VERIFIED]?.price != null);
  const series: DurationSeries[] = [];
  const D = COPY.durationView;
  // why: a verified series with no provider and no data would be an empty promise in the legend.
  if (hasVerification || anyVerified) {
    const n = totalN(VERIFIED);
    series.push({
      key: VERIFIED,
      kind: 'verified',
      providerId: null,
      totalN: n,
      name: D.verifiedSeries(n),
      shortName: D.verifiedShort,
    });
  }
  for (const p of providers) {
    const key = calendarKey(p);
    // why: label from the prices' own provenance (each carries its sourceKind); a provider with no price yet is named.
    const found = kinds.get(p) ?? [];
    const source = found.length === 0 ? COPY.provider[p] : sourceLabelOf(found);
    const n = totalN(key);
    series.push({
      key,
      kind: 'calendar',
      providerId: p,
      totalN: n,
      name: D.calendarSeries(source, n),
      shortName: D.calendarShort(source),
    });
  }
  const prices = rows.flatMap((r) =>
    series.flatMap((s) => {
      const p = r.cells[s.key]?.price ?? null;
      return p === null ? [] : [p];
    }),
  );
  return {
    rows,
    series,
    isEmpty: prices.length === 0,
    shownPrices: prices.length,
    stalePrices: prices.filter((p) => p.stale).length,
  };
}

/** The row a tooltip label (the nights value on the x axis) names; a lookup, never a cast of the chart payload. */
export function rowAt(rows: readonly DurationRow[], label: unknown): DurationRow | undefined {
  const nights = typeof label === 'number' ? label : typeof label === 'string' ? Number(label) : Number.NaN;
  return rows.find((r) => r.nights === nights);
}

/**
 * The bar height of one series at one nights value: its minimum's pence, or null for a gap. Recharts draws no bar for
 * null; a 0 here would claim a free fare and is never produced (spec §11 View C: gaps, no interpolation).
 */
export function barValue(row: DurationRow, key: string): number | null {
  return row.cells[key]?.price?.pricePence ?? null;
}

/**
 * The gap wording of one series at one nights value (plan decision 38: per series, by stage). Partial coverage says
 * "k of N" (review prov-r2-007); the verified series says "no class-verified price", never "no price", because offers
 * that were found but did not qualify are not absent fares (review prov-r2-006).
 */
export function gapLabel(cell: DurationCell | undefined, kind: DurationSeries['kind']): string {
  const { searched, total } = cell?.searched ?? NONE;
  const D = COPY.durationView;
  if (kind === 'verified') {
    if (searched === 0) return D.notItinerarySearched;
    return searched < total ? D.partlyItinerarySearchedNoPrice(searched, total) : D.itinerarySearchedNoPrice;
  }
  // why: N1 (ruling 4): a calendar gap names its buckets ("12 no cached data"), as the Calendar does; cache misses are
  // never presented as a search that found nothing.
  const b = cell?.buckets;
  if (b === undefined || b.not_run === total) return D.notSearched;
  return COPY.calendarView.bucketBreakdown(b);
}
