import type { ListRequest } from '@gmt/core';

/**
 * The one URL form (spec §2; brief §6), the feasibility load's: `?q=Flights from <origin> to <destination> on
 * <departure> returning <return>&curr=GBP&hl=en-GB&gl=<gl>`. `tfs` is never built; `hl=en-GB` is load-bearing (the
 * selectors and the grammar read English names).
 */
export const RESULTS_BASE = 'https://www.google.com/travel/flights';

export function pageUrl(
  req: Pick<ListRequest, 'origin' | 'destination' | 'departureDate' | 'returnDate' | 'gl'>,
): string {
  const u = new URL(RESULTS_BASE);
  u.search = new URLSearchParams({
    q: `Flights from ${req.origin} to ${req.destination} on ${req.departureDate} returning ${req.returnDate}`,
    curr: 'GBP',
    hl: 'en-GB',
    gl: req.gl,
  }).toString();
  return u.href;
}

/** The consent probe's page (Task 14.2): the bare search page with the same locale, naming no airport. */
export function probeUrl(gl: string): string {
  const u = new URL(RESULTS_BASE);
  u.search = new URLSearchParams({ curr: 'GBP', hl: 'en-GB', gl }).toString();
  return u.href;
}
