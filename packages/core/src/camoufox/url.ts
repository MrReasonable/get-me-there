import type { Iata, IsoDate } from '../types/ids.js';

/**
 * Spec revision 55 §2 (prov-int-017): the browser worker's one verified URL form, the feasibility load's, moved here from
 * the worker so the worker loads it and a camoufox row's search link reproduces it:
 * `?q=Flights from <origin> to <destination> on <departure> returning <return>&curr=GBP&hl=en-GB&gl=<gl>`. `tfs` is
 * never built; `hl=en-GB` is load-bearing (the worker's selectors and grammar read English names).
 */
export const RESULTS_BASE = 'https://www.google.com/travel/flights';

/** One list page's URL for one cell; `gl` is the point of sale (POINT_OF_SALE). */
export function pageUrl(req: {
  origin: Iata;
  destination: Iata;
  departureDate: IsoDate;
  returnDate: IsoDate;
  gl: string;
}): string {
  const u = new URL(RESULTS_BASE);
  u.search = new URLSearchParams({
    q: `Flights from ${req.origin} to ${req.destination} on ${req.departureDate} returning ${req.returnDate}`,
    curr: 'GBP',
    hl: 'en-GB',
    gl: req.gl,
  }).toString();
  return u.href;
}
