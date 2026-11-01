import { RESULTS_BASE } from '@gmt/core';

/**
 * The worker's URLs (spec §2; brief §6). The list page's one URL form (`pageUrl`, `?q=Flights from <origin> to
 * <destination> on <departure> returning <return>&curr=GBP&hl=en-GB&gl=<gl>`) lives in core since spec revision 55
 * (prov-int-017), so a camoufox row's search link is the page the worker read; it is re-exported here for the
 * worker's own callers. `tfs` is never built; `hl=en-GB` is load-bearing (the selectors and the grammar read English
 * names).
 */
export { pageUrl, RESULTS_BASE } from '@gmt/core';

/** The consent probe's page (Task 14.2): the bare search page with the same locale, naming no airport. */
export function probeUrl(gl: string): string {
  const u = new URL(RESULTS_BASE);
  u.search = new URLSearchParams({ curr: 'GBP', hl: 'en-GB', gl }).toString();
  return u.href;
}

/** The consent command's and the consent research's one page (spec §2 "Consent"): the landing page, no query. */
export function landingUrl(gl: string): string {
  const u = new URL(RESULTS_BASE);
  u.search = new URLSearchParams({ hl: 'en-GB', gl }).toString();
  return u.href;
}
