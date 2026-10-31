import { DETAIL_LINK_PARAMS } from '@gmt/core';
import { oneOf } from './oneOf.js';

/**
 * Every view of spec rev 55 §11 (WP20 Task 20.3): Searches is the first screen and the landing for every URL that
 * names no usable view; `dates` is a search's page (`def=`), `results` the date pair detail and `definitions` the Edit
 * page (`edit=`). The last three are opened from a card, a board row or an alert email, never from the nav's Set up.
 */
export type ViewId =
  | 'searches'
  | 'dates'
  | 'results'
  | 'history'
  | 'definitions'
  | 'providers'
  | 'alerts'
  | 'status';
export const VIEWS: readonly ViewId[] = [
  'searches',
  'dates',
  'results',
  'history',
  'definitions',
  'providers',
  'alerts',
  'status',
];

/**
 * Spec §11 layout: the nav's two labelled tiers. Decide lists Searches, the search last opened (its `dates` view,
 * rendered only once one has been opened) and History; Set up lists Providers, Alerts and Status. Results and the Edit
 * page are in neither.
 */
export const NAV_TIERS: readonly { id: 'decide' | 'setup'; views: readonly ViewId[] }[] = [
  { id: 'decide', views: ['searches', 'dates', 'history'] },
  { id: 'setup', views: ['providers', 'alerts', 'status'] },
];

export const isView = oneOf(VIEWS);

/** `?view=`; anything unknown or absent is Searches (spec §11 URLs). */
export function parseView(v: string | null): ViewId {
  return v !== null && isView(v) ? v : 'searches';
}

/**
 * A nav link's patch: the view, with the detail's date pair and row dropped (they name one date pair's results and
 * mean nothing to another view); every filter (`d.*`, `f.*`, the sort, `def=`) is kept, so the filters travel with
 * every nav link (spec §11; WP19 Task 19.7).
 */
export function navPatch(view: ViewId): Record<string, string | null> {
  return {
    [DETAIL_LINK_PARAMS.view]: view,
    [DETAIL_LINK_PARAMS.depart]: null,
    [DETAIL_LINK_PARAMS.return]: null,
    [DETAIL_LINK_PARAMS.row]: null,
  };
}
