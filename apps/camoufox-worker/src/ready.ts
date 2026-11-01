import type { PageFacts } from './classify.js';
import type { SettleFacts } from './driver.js';

/**
 * Which view the page shows: the first view (Best), the Cheapest view after its click, or (WP21 Task 21.0) the view
 * after an outbound's selection, read by the return patterns.
 */
export type View = 'best' | 'cheapest' | 'returns' | 'booking';

/**
 * Settled (spec §2; brief §9; prov-002, PIE-05; operator rulings of 2026-10-18): no "Fetching results" is visible
 * outside the Cheapest tab (the tab keeps a hidden loading label in its name), the Cheapest tab's name carries a price,
 * and there is at least one result link. The Best view also needs the "<N> results returned." line; the Cheapest view
 * shows none, and needs its tab selected instead. The links must also hold still across two polls (stableAcross).
 */
export function isSettled(
  page: Pick<PageFacts, 'resultLinks'> &
    Partial<Pick<PageFacts, 'outboundLinks'>> & { text?: Pick<PageFacts['text'], 'noFlights'> },
  settle: Pick<SettleFacts, 'resultsReturned' | 'fetching' | 'cheapestPriced' | 'cheapestSelected'>,
  view: View = 'best',
  /**
   * WP21 Task 21.0 (R-settle): whether the view has changed from the one the selection was made on (the caller's
   * rule: another link signature, a return heading, or a further document load); read on the return view only.
   */
  changed = false,
): boolean {
  // why: R-settle: the return view needs only a change and something read by either pattern (or Google's own line);
  // never the results line, the selected tab or the heading, which its classifier judges, not its settle
  // why: Ian's ruling of 2026-11-01: the booking view's structure is what the research records, so nothing about its
  // content is required: it has changed from the return view and nothing is fetching, then it holds still
  if (view === 'booking') return changed && !settle.fetching;
  if (view === 'returns')
    return (
      changed &&
      !settle.fetching &&
      (page.resultLinks > 0 || (page.outboundLinks ?? 0) > 0 || page.text?.noFlights === true)
    );
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
