/**
 * Travelpayouts request facts. Spec §2 (Travelpayouts row) and §5.2 "Point of sale": `currency=gbp` only, `market`
 * and `trip_class` never sent, every fixed value hard-coded here.
 */
import { asIsoDate } from '@gmt/core';
import type { ParamsAllowlist } from '../params/allowlist.js';

/** Public Data API host; the only host in this provider's egress allowlist (spec §5.3). */
export const TRAVELPAYOUTS_HOST = 'api.travelpayouts.com';

/** The only endpoint this adapter calls (spec §2); also the ledger endpoint_path and the allowlist key. */
export const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';

/** Rows per page (spec §5.2: `limit=1000`, the vendor's maximum). A shorter page is the last one. */
export const PAGE_LIMIT = 1000;

/**
 * Fixed parameters (spec §5.2). `market` and `trip_class` are absent on purpose. `trip_class` is not a v3 parameter at
 * all. The vendor's docs derive the market from the `origin` parameter, and the spike saw no effect from sending
 * `market` (spec §2 fact 1); point of sale stays `unknown` either way.
 * why: `limit` is derived from PAGE_LIMIT, so the page size sent and the short-page stop rule cannot drift apart.
 */
export const FIXED_PARAMS = { one_way: 'false', currency: 'gbp', limit: `${PAGE_LIMIT}` } as const;

/**
 * Names that must never be sent. `token`: the credential travels in X-Access-Token only (spec §2 fact 8). `market`,
 * `trip_class`: no observed effect (fact 1), and `trip_class` is not a v3 parameter. `return_at`: month tiles send none (spec §5.2).
 */
export const FORBIDDEN_PARAM_NAMES = ['token', 'market', 'trip_class', 'return_at'] as const;

// why: these two values exist only once WP4b has recorded; they are copied verbatim from
// fixtures/recorded/travelpayouts/params-<date>.json (Task 6.8 Step 3 prints them), and the equality test fails if
// either drifts. asIsoDate is the brand's only mint site (plan decision 15).
const RECORDED_AT = asIsoDate('2026-10-15');
const CONTENT_SHA256 = '0cf1d45436da3fb56cccfa23073d314fec761635435fc1347e09be3f810131a5';

/**
 * The runtime allowlist (plan decision 6: a code constant asserted equal to the recorded file). Keyed by endpoint
 * path; names in ascending order; 'any' for per-request values (plan decision 14).
 */
export const TRAVELPAYOUTS_PARAMS: ParamsAllowlist = {
  provider: 'travelpayouts',
  recordedAt: RECORDED_AT,
  endpoints: {
    [PRICES_FOR_DATES_PATH]: {
      names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
      values: {
        currency: [FIXED_PARAMS.currency],
        departure_at: 'any',
        destination: 'any',
        limit: [FIXED_PARAMS.limit],
        one_way: [FIXED_PARAMS.one_way],
        origin: 'any',
        page: 'any',
      },
    },
  },
  contentSha256: CONTENT_SHA256,
};
