import type { PageFacts } from './classify.js';
import type { SettleFacts } from './driver.js';

/** Which tab the page shows: the first view (Best) or the Cheapest view after its click. */
export type View = 'best' | 'cheapest';

/**
 * Settled (spec §2; brief §9; prov-002, PIE-05; operator rulings of 2026-10-18): no "Fetching results" is visible
 * outside the Cheapest tab (the tab keeps a hidden loading label in its name), the Cheapest tab's name carries a price,
 * and there is at least one result link. The Best view also needs the "<N> results returned." line; the Cheapest view
 * shows none, and needs its tab selected instead. The links must also hold still across two polls (stableAcross).
 */
export function isSettled(
  page: Pick<PageFacts, 'resultLinks'>,
  settle: Pick<SettleFacts, 'resultsReturned' | 'fetching' | 'cheapestPriced' | 'cheapestSelected'>,
  view: View = 'best',
): boolean {
  const common = !settle.fetching && settle.cheapestPriced && page.resultLinks > 0;
  return common && (view === 'best' ? settle.resultsReturned : settle.cheapestSelected);
}

/** The least time between the two polls whose links must agree. */
export const STABLE_MS = 2000;

/** One poll's links, as the next poll compares them. */
export interface Previous {
  signature: string;
  links: number;
  at: number;
}

/** True when the previous settled poll's links equal this one's and the polls are at least STABLE_MS apart. */
export function stableAcross(previous: Previous | null, current: Previous): boolean {
  return (
    previous !== null &&
    previous.signature === current.signature &&
    previous.links === current.links &&
    current.at - previous.at >= STABLE_MS
  );
}
