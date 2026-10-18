import type { PageFacts } from './classify.js';
import type { SettleFacts } from './driver.js';

/**
 * Settled (spec §2; brief §9; prov-002, PIE-05; operator ruling of 2026-10-18): a results page is read only when the
 * "<N> results returned." line is present, no "Fetching results" is visible outside the Cheapest tab (the tab keeps a
 * hidden loading label in its name once loaded), the Cheapest tab's name carries a price, there is at least one result
 * link, and the result links (their names and count) are unchanged across two polls at least STABLE_MS apart. The
 * session polls this within the page deadline, classifying blocked kinds on every poll.
 */
export function isSettled(
  page: Pick<PageFacts, 'resultLinks'>,
  settle: Omit<SettleFacts, 'linkSignature'>,
): boolean {
  return settle.resultsReturned && !settle.fetching && settle.cheapestPriced && page.resultLinks > 0;
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
