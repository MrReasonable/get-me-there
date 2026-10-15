import { compareAges, effectiveAge } from '../labels/age.js';
import { cellKeyString } from '../types/definition.js';
import type { IsoDateTime } from '../types/ids.js';
import type { ResultRow, SortKey } from './types.js';

const CLASS_RANK: Readonly<Record<ResultRow['verdictClass'], number>> = {
  verified: 0,
  'partially-verified': 1,
  failed: 2,
  unchecked: 3,
};

/**
 * Code-unit string order, the same on every host.
 * why: `localeCompare` depends on the host ICU and default locale (review arch-012).
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function identity(r: ResultRow): string {
  return r.itineraryHash ?? `${r.provenance.providerId}|${cellKeyString(r.cell)}`;
}

/**
 * The one row order core uses (spec §6.5, §8.1), shared by `rankRows` and `dedupByItinerary`:
 * verdict class (verified, partially-verified, failed, then calendar `unchecked`); rows seen in
 * the latest search before `notSeenInLatest` ones; price; effective age through `compareAges`
 * (fresher first, unknown age loses to any known age, a future timestamp clamps to "just now":
 * plan review focus 2); seller; identity. Stale rows are not demoted: spec §8.1 returns and
 * labels them, and `hideStale` is the operator's opt-in.
 */
export function compareRows(a: ResultRow, b: ResultRow, now: IsoDateTime): number {
  return (
    CLASS_RANK[a.verdictClass] - CLASS_RANK[b.verdictClass] ||
    Number(a.notSeenInLatest !== null) - Number(b.notSeenInLatest !== null) ||
    a.pricePence - b.pricePence ||
    compareAges(effectiveAge(a.provenance, now), effectiveAge(b.provenance, now)) ||
    compareText(a.seller ?? '', b.seller ?? '') ||
    compareText(identity(a), identity(b))
  );
}

/** Spec §6.5 server ranking with `compareRows`. Returns a sorted copy. */
export function rankRows(rows: ResultRow[], now: IsoDateTime): ResultRow[] {
  return [...rows].sort((a, b) => compareRows(a, b, now));
}

function keyOf(r: ResultRow, key: SortKey): number | string | null {
  switch (key) {
    case 'price':
      return r.pricePence;
    case 'totalTime':
      return r.totalMinutes;
    case 'departure':
      return r.cell.departureDate;
    case 'return':
      return r.cell.returnDate;
    case 'nights':
      return r.cell.nights;
    case 'stops':
      return r.stopsOut === null || r.stopsIn === null ? null : r.stopsOut + r.stopsIn;
    case 'adjusted':
      return r.adjustedPence;
  }
}

/**
 * Spec §6.5 client-side sort over the fetched page; composes with `filterRows` without refetch.
 * Rows lacking the key (calendar rows have no travel time or stops; `adjusted` needs an
 * operator onward cost) sort last in both directions. Stable, so equal keys keep the ranked order.
 */
export function sortRows(rows: ResultRow[], key: SortKey, dir: 'asc' | 'desc'): ResultRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = keyOf(a, key);
    const kb = keyOf(b, key);
    if (ka === null) return kb === null ? 0 : 1;
    if (kb === null) return -1;
    return ka < kb ? -sign : ka > kb ? sign : 0;
  });
}
