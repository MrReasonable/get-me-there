import type { IsoDate } from '../types/ids.js';
import type { ResultBasis } from '../types/itinerary.js';

/**
 * The date pair detail's URL parameters (spec §8.3, §11 URLs): the one place their names live. The engine's alert
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
 * The detail URL's query, without the leading `?`: `view=results&def=…&depart=…&return=…&basis=…[&row=…]`, in
 * §8.3's order, each value encoded as a query component.
 */
export function detailLinkQuery(p: {
  definitionId: string;
  departureDate: IsoDate;
  returnDate: IsoDate;
  basis: ResultBasis;
  row?: string;
}): string {
  const q = new URLSearchParams([
    [DETAIL_LINK_PARAMS.view, 'results'],
    [DETAIL_LINK_PARAMS.def, p.definitionId],
    [DETAIL_LINK_PARAMS.depart, p.departureDate],
    [DETAIL_LINK_PARAMS.return, p.returnDate],
    [DETAIL_LINK_PARAMS.basis, p.basis],
  ]);
  if (p.row !== undefined) q.append(DETAIL_LINK_PARAMS.row, p.row);
  return q.toString();
}
