/**
 * Travelpayouts request facts. Spec §2 (Travelpayouts row) and §5.2 "Point of sale": `currency=gbp` only, `market`
 * and `trip_class` never sent, every fixed value hard-coded here.
 */

/** Public Data API host; the only host in this provider's egress allowlist (spec §5.3). */
export const TRAVELPAYOUTS_HOST = 'api.travelpayouts.com';

/** The only endpoint this adapter calls (spec §2); also the ledger endpoint_path and the allowlist key. */
export const PRICES_FOR_DATES_PATH = '/aviasales/v3/prices_for_dates';

/** Rows per page (spec §5.2: `limit=1000`, the vendor's maximum). A shorter page is the last one. */
export const PAGE_LIMIT = 1000;

/**
 * Fixed parameters (spec §5.2). `market` and `trip_class` are absent on purpose: the spike proved the vendor ignores
 * both (spec §2 fact 1).
 * why: `limit` is derived from PAGE_LIMIT, so the page size sent and the short-page stop rule cannot drift apart.
 */
export const FIXED_PARAMS = { one_way: 'false', currency: 'gbp', limit: `${PAGE_LIMIT}` } as const;

/**
 * Names that must never be sent. `token`: the credential travels in X-Access-Token only (spec §2 fact 8). `market`,
 * `trip_class`: ignored by the vendor (fact 1). `return_at`: month tiles send none (spec §5.2).
 */
export const FORBIDDEN_PARAM_NAMES = ['token', 'market', 'trip_class', 'return_at'] as const;
