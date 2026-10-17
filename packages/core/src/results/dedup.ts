import type { IsoDateTime } from '../types/ids.js';
import type { VerdictClass } from '../types/itinerary.js';
import { compareRows, priceUnconfirmed } from './rank.js';
import type { ResultRow } from './types.js';

/** A row with a constraint verdict class, i.e. an itinerary-search row (never a calendar row). */
type ClassedRow = ResultRow & { verdictClass: VerdictClass };

/** Type guard: only classed rows group by itinerary; `unchecked` rows never share a hash (ruling). */
function isClassed(r: ResultRow): r is ClassedRow {
  return r.verdictClass !== 'unchecked';
}

type Entry = { kind: 'row'; row: ResultRow } | { kind: 'group'; rows: [ClassedRow, ...ClassedRow[]] };

/**
 * Spec §6.5 dedup: one row per itinerary hash. The primary offer is the first confirmed offer by `compareRows`
 * (an unconfirmed one only when the itinerary has no confirmed offer, decision 45)
 * (class, seen-in-latest, price, age, seller), so a verified offer heads its itinerary even when a
 * partially-verified or failed one is cheaper, and a seen offer beats a cheaper one the latest
 * search no longer returned. Every other offer goes to `otherOffers`, cheapest first, each with its
 * own class, unverified names and `notSeenInLatest`, so the expanded row never shows a cheaper
 * price without saying it failed or has gone (review prov-002, prov-r2-002). Rows are already in
 * the definition's cabin (WP8 filters on read). Calendar rows (no hash) and `unchecked` rows pass
 * through unchanged; first-appearance order is kept.
 */
export function dedupByItinerary(rows: ResultRow[], now: IsoDateTime): ResultRow[] {
  const groups = new Map<string, Entry & { kind: 'group' }>();
  const out: Entry[] = [];
  for (const row of rows) {
    if (row.itineraryHash === null || !isClassed(row)) {
      out.push({ kind: 'row', row });
      continue;
    }
    const group = groups.get(row.itineraryHash);
    if (group === undefined) {
      const entry: Entry & { kind: 'group' } = { kind: 'group', rows: [row] };
      groups.set(row.itineraryHash, entry);
      out.push(entry);
    } else {
      group.rows.push(row);
    }
  }
  return out.map((entry) => {
    if (entry.kind === 'row') return entry.row;
    // why: decision 45 (review prov I2): an unconfirmed offer heads its itinerary only when no offer of it is confirmed,
    // whatever the classes; among the candidates the row order decides.
    const confirmed = entry.rows.filter((r) => !priceUnconfirmed(r));
    const candidates = confirmed.length > 0 ? confirmed : entry.rows;
    const primary = candidates.reduce((best, r) => (compareRows(r, best, now) < 0 ? r : best));
    const otherOffers = entry.rows
      .filter((r) => r !== primary)
      .sort((a, b) => a.pricePence - b.pricePence || compareRows(a, b, now))
      .map((r) => ({
        seller: r.seller ?? '',
        pricePence: r.pricePence,
        provenance: r.provenance,
        booking: r.booking,
        stale: r.stale,
        ageHours: r.ageHours,
        verdictClass: r.verdictClass,
        unverified: r.unverified,
        notSeenInLatest: r.notSeenInLatest,
      }));
    return { ...primary, otherOffers };
  });
}
