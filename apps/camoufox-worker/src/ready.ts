import type { PageFacts } from './classify.js';
import type { SettleFacts } from './driver.js';

/**
 * Settled (spec §2; brief §9; prov-002, PIE-05): a results page is read only when the "<N> results returned." line is
 * present, nothing still reads "Fetching results", the Cheapest tab's name carries a price, and there is at least one
 * result link. The session polls this within the page deadline, classifying blocked kinds on every poll.
 */
export function isSettled(page: Pick<PageFacts, 'resultLinks'>, settle: SettleFacts): boolean {
  return settle.resultsReturned && !settle.fetching && settle.cheapestPriced && page.resultLinks > 0;
}
