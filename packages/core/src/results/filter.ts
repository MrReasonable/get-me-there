import type { ResultFilters, ResultRow } from './types.js';

const DEFAULT_CLASSES: Array<ResultRow['verdictClass']> = ['verified', 'partially-verified', 'unchecked'];

/**
 * Spec §6.5 filters, composed with AND: verdict class, unverified-constraint name, provider,
 * stops, carriers, destination, max price, nights range, departure-date range, stale. Stale rows are kept unless
 * `hideStale` (spec §8.1: returned and labelled, never hidden by default). The stops and
 * carriers filters do not apply to rows without segments (calendar basis, spec §6.9), so such
 * rows are kept rather than silently dropped.
 */
export function filterRows(rows: ResultRow[], f: ResultFilters): ResultRow[] {
  const classes = f.verdictClass ?? DEFAULT_CLASSES;
  return rows.filter((r) => {
    if (!classes.includes(r.verdictClass)) return false;
    if (f.unverified !== undefined && !f.unverified.some((name) => r.unverified.includes(name))) return false;
    if (f.providerId !== undefined && !f.providerId.includes(r.provenance.providerId)) return false;
    if (f.maxStops !== undefined && r.stopsOut !== null && r.stopsIn !== null) {
      if (r.stopsOut > f.maxStops || r.stopsIn > f.maxStops) return false;
    }
    if (f.carriers !== undefined && r.outbound !== null) {
      const wanted = f.carriers;
      if (!r.carriers.some((c) => wanted.includes(c))) return false;
    }
    if (f.destination !== undefined && !f.destination.includes(r.cell.destination)) return false;
    if (f.maxPricePence !== undefined && r.pricePence > f.maxPricePence) return false;
    if (f.nights !== undefined && (r.cell.nights < f.nights.min || r.cell.nights > f.nights.max))
      return false;
    // why: ISO dates compare correctly as strings, so no Date (and no time zone) is involved.
    if (f.departure !== undefined) {
      const d = r.cell.departureDate;
      if (d < f.departure.from || d > f.departure.to) return false;
    }
    if (f.hideStale === true && r.stale) return false;
    return true;
  });
}
