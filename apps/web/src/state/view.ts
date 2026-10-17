import { oneOf } from './oneOf.js';

/** Every view of spec §11; WP9 owns the nav for all of them. */
export type ViewId =
  | 'results'
  | 'calendar'
  | 'duration'
  | 'history'
  | 'coverage'
  | 'definitions'
  | 'alerts'
  | 'providers';
export const VIEWS: readonly ViewId[] = [
  'results',
  'calendar',
  'duration',
  'history',
  'coverage',
  'definitions',
  'alerts',
  'providers',
];

const isView = oneOf(VIEWS);

/** `?view=`; anything unknown or absent is Results. */
export function parseView(v: string | null): ViewId {
  return v !== null && isView(v) ? v : 'results';
}
