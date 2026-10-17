/** Picking one figure out of rows (spec §8.1, §11 View B; plan decisions 54, 58). */
import type { ResultRow } from './rows.js';

/** The cheapest row, or null (calendar-basis minima). */
export function cheapest(rows: readonly ResultRow[]): ResultRow | null {
  let best: ResultRow | null = null;
  for (const r of rows) if (best === null || r.pricePence < best.pricePence) best = r;
  return best;
}

/**
 * The verified-basis figure of a set of rows (plan decision 54, spec §8.1, §11 View B): a row the newest search of its
 * cell returned beats one it did not, a fresh row beats a stale one, then the cheaper wins. The caller carries the
 * winner's `notSeenInLatest`, so a not-seen figure is shown only when nothing seen exists, and says so.
 */
export function pickVerified(rows: readonly ResultRow[]): ResultRow | null {
  const rank = (r: ResultRow) => [r.notSeenInLatest === null ? 0 : 1, r.stale ? 1 : 0, r.pricePence];
  let best: ResultRow | null = null;
  for (const r of rows) {
    if (best === null) {
      best = r;
      continue;
    }
    const [a, b] = [rank(r), rank(best)];
    const i = a.findIndex((x, k) => x !== b[k]);
    if (i >= 0 && (a[i] ?? 0) < (b[i] ?? 0)) best = r;
  }
  return best;
}

/** The calendar-basis figure: a current price before one a later search superseded (decision 54), then the cheapest. */
export function pickCalendar(rows: readonly ResultRow[]): ResultRow | null {
  return cheapest(rows.filter((r) => !r.superseded)) ?? cheapest(rows);
}
