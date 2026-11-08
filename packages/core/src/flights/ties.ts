/**
 * Spec revision 55 §11 "Ties" (WP20 Task 20.10): the runs of a search's board at one price, and the order of the date
 * pairs inside one run by the flights read for them. Pure. The rank column stays the price rank: this orders rows, it
 * never ranks them, and a flight read never changes a price (§6.9).
 */
import { clockOf, type ShownFlights } from './choose.js';
import type { ListedFlight } from './types.js';

/** A tie group's key: price and whether current, and (design 2026-11-08 §5.2) optionally the rank tier. */
export interface TieKey {
  pricePence: number;
  current: boolean;
  tier?: number;
}

/**
 * Spec rev 55 §11 Ties: the contiguous runs of `ranked` at one price and of one current or superseded kind, in rank
 * order (a superseded figure at the same price is its own run). Design 2026-11-08 §5.2: a key may also name a `tier`
 * (the figure's rank tier), and a run then holds one tier only, so a trip with flights read and a calendar price at one
 * price are not one tie. The groups, flattened, are `ranked` itself.
 */
export function tieGroups<P>(ranked: readonly P[], keyOf: (p: P) => TieKey): P[][] {
  const runs: Array<{ key: TieKey; members: P[] }> = [];
  for (const p of ranked) {
    const key = keyOf(p);
    const run = runs.at(-1);
    if (
      run !== undefined &&
      run.key.pricePence === key.pricePence &&
      run.key.current === key.current &&
      run.key.tier === key.tier
    )
      run.members.push(p);
    else runs.push({ key, members: [p] });
  }
  return runs.map((r) => r.members);
}

/**
 * Spec rev 55 §11 Ties: inside one run, the date pairs with flights shown come first, by their first shown flight's
 * outbound time, then fewer changes, then earlier departure; the rest keep their input (board) order after them. The
 * caller passes null for a failed, empty or missing list and for a pair whose only list is another airport pair's
 * (prov-r2-004: only the figure's own airport pair's list orders a tie); an empty `shown` counts as none. Stable.
 */
export function orderWithinTie<P>(
  group: readonly P[],
  shownOf: (p: P) => ShownFlights<ListedFlight> | null,
): P[] {
  const withFlights: Array<{ p: P; f: ListedFlight }> = [];
  const rest: P[] = [];
  for (const p of group) {
    const f = shownOf(p)?.shown[0];
    if (f === undefined) rest.push(p);
    else withFlights.push({ p, f });
  }
  // why: Array.prototype.sort is stable (ES2019), so equal keys keep the board's order
  withFlights.sort(
    (a, b) =>
      a.f.durationMinutes - b.f.durationMinutes ||
      a.f.stops - b.f.stops ||
      clockOf(a.f.departsLocal) - clockOf(b.f.departsLocal),
  );
  return [...withFlights.map((w) => w.p), ...rest];
}
