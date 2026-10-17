import { hrefWith } from './urlState.js';

/**
 * Links between views, beside WP9's URL state (review arch2-011): Results' expanded row links to History without
 * importing the History view module and its chart library.
 */
export const HISTORY_PARAMS = { hash: 'hash', pair: 'hist.pair' } as const;

/** Link to one itinerary's history (WP9's expanded row); keeps every other URL parameter. */
export function historyHref(itineraryHash: string): string {
  return hrefWith({ view: 'history', [HISTORY_PARAMS.hash]: itineraryHash });
}
