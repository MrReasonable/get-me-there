import { DETAIL_LINK_PARAMS } from '@gmt/core';
import { oneOf } from './oneOf.js';
import { TRIP_PAIR_PARAMS } from './resultsState.js';

/**
 * Every view of spec rev 55 §11 (WP20 Task 20.3; design 2026-11-08 Ruling 9): Searches is the first screen (the nav says
 * Trips) and the landing for every URL
 * that names no usable view; `dates` is a search's page (`def=`), `trip` one pair of dates of it (design
 * 2026-11-08 §6.1; an old `view=results` link lands there) and `definitions` the Edit page (`edit=`). These are
 * opened from a card, a board row or an alert email, never from the nav. `settings` is the interim page whose three
 * sections are `providers`, `alerts` and `status`.
 */
export type ViewId =
  | 'searches'
  | 'dates'
  | 'trip'
  | 'history'
  | 'definitions'
  | 'settings'
  | 'providers'
  | 'alerts'
  | 'status';
export const VIEWS: readonly ViewId[] = [
  'searches',
  'dates',
  'trip',
  'history',
  'definitions',
  'settings',
  'providers',
  'alerts',
  'status',
];

/** The nav's two items (Ruling 9). */
export type NavItem = 'trips' | 'settings';
export const NAV_ITEMS: readonly NavItem[] = ['trips', 'settings'];

/** The view a nav item opens. */
export const NAV_VIEW: Record<NavItem, ViewId> = { trips: 'searches', settings: 'settings' };

const NAV_ITEM_OF: Record<ViewId, NavItem> = {
  searches: 'trips',
  dates: 'trips',
  trip: 'trips',
  definitions: 'trips',
  history: 'trips',
  settings: 'settings',
  providers: 'settings',
  alerts: 'settings',
  status: 'settings',
};

/** The nav item a view sits under: a search, its Trip page, Edit and History are Trips; Settings and its sections are Settings. */
export const navItemOf = (view: ViewId): NavItem => NAV_ITEM_OF[view];

export const isView = oneOf(VIEWS);

/** `?view=`; anything unknown or absent is Searches (spec §11 URLs). */
export function parseView(v: string | null): ViewId {
  return v !== null && isView(v) ? v : 'searches';
}

/**
 * A nav link's patch: the view, with the detail's date pair, its airport pair and row dropped (they name one trip and
 * mean nothing to another view); every filter (`d.*`, `f.*`, the sort, `def=`) is kept, so the filters travel with
 * every nav link (spec §11; WP19 Task 19.7).
 */
export function navPatch(view: ViewId): Record<string, string | null> {
  return {
    [DETAIL_LINK_PARAMS.view]: view,
    [DETAIL_LINK_PARAMS.depart]: null,
    [DETAIL_LINK_PARAMS.return]: null,
    [DETAIL_LINK_PARAMS.row]: null,
    [TRIP_PAIR_PARAMS.from]: null,
    [TRIP_PAIR_PARAMS.to]: null,
  };
}
