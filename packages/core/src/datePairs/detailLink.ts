import type { IsoDate } from '../types/ids.js';

/**
 * The date pair detail's URL parameters (spec §8.3, §11 URLs): the one place their names live. `basis` and `row` are
 * read from old links only (landing.ts); no link is written with them. The engine's alert
 * link and the web's links and landing rules all build or read the detail URL through these.
 */
export const DETAIL_LINK_PARAMS = {
  view: 'view',
  def: 'def',
  depart: 'depart',
  return: 'return',
  basis: 'basis',
  row: 'row',
} as const;

/**
 * The Trip page's URL query, without the leading `?`: `view=trip&def=…&depart=…&return=…`, each value encoded as a query
 * component (design 2026-11-08 §6.1). It no longer names a basis or a row: the page is one pair of dates, whatever
 * figure led it.
 */
export function detailLinkQuery(p: {
  definitionId: string;
  departureDate: IsoDate;
  returnDate: IsoDate;
}): string {
  return new URLSearchParams([
    [DETAIL_LINK_PARAMS.view, 'trip'],
    [DETAIL_LINK_PARAMS.def, p.definitionId],
    [DETAIL_LINK_PARAMS.depart, p.departureDate],
    [DETAIL_LINK_PARAMS.return, p.returnDate],
  ]).toString();
}
