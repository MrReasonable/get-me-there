// `@gmt/providers/recording`: the adapter pieces the fixture recording tool (apps/api) must share rather than copy
// (plan decision 32): exact vendor money to minor units, and the one Travelpayouts request URL builder. Not the main
// barrel, because decision 30 keeps the adapter helpers package-internal; this subpath names its only consumer.
export { majorToMinor } from '../shared/money.js'; // apps/api record tool: price diagnostics
export { PAGE_LIMIT } from '../travelpayouts/params.js'; // apps/api record tool: the page size and short-page rule
export { buildRequestUrl, MAX_PAGES } from '../travelpayouts/provider.js'; // apps/api record tool: the one request URL and page cap
export type { TileParams } from '../travelpayouts/tiles.js';
