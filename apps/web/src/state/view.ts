import { DETAIL_LINK_PARAMS } from '@gmt/core';
import { oneOf } from './oneOf.js';

/**
 * Every view of spec §11 (revision 48, WP19 Task 19.7): Dates is the default; Results is the date pair detail, opened
 * from a board row, an overview cell or an alert email, never from the nav. The retired Calendar, Duration and Coverage
 * values land on Dates (`landing.ts`).
 */
export type ViewId = 'dates' | 'results' | 'history' | 'definitions' | 'providers' | 'alerts' | 'status';
export const VIEWS: readonly ViewId[] = [
  'dates',
  'results',
  'history',
  'definitions',
  'providers',
  'alerts',
  'status',
];

/** Spec §11 layout: the nav's two labelled tiers, Decide and Set up. Results is in neither. */
export const NAV_TIERS: readonly { id: 'decide' | 'setup'; views: readonly ViewId[] }[] = [
  { id: 'decide', views: ['dates', 'history'] },
  { id: 'setup', views: ['definitions', 'providers', 'alerts', 'status'] },
];

export const isView = oneOf(VIEWS);

/** `?view=`; anything unknown or absent is Dates (spec §11 URLs). */
export function parseView(v: string | null): ViewId {
  return v !== null && isView(v) ? v : 'dates';
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
