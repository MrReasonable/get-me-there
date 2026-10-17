// `@gmt/providers/recording`: the adapter pieces the fixture recording tool (apps/api) must share rather than copy
// (plan decision 32): exact vendor money to minor units, the one Travelpayouts request URL builder and SearchApi's
// parameter builders. Not the main
// barrel, because decision 30 keeps the adapter helpers package-internal; this subpath names its only consumer.

// apps/api record tool (ruling 18 of decision 67): SearchApi's own parameter sets and URL, so a recording sends exactly
// what the adapter sends and a parameter is added in one place.
export {
  calendarParams as searchApiCalendarParams,
  flightsParams as searchApiFlightsParams,
  toUrl as searchApiUrl,
} from '../searchapi/params.js';
export { majorToMinor } from '../shared/money.js'; // apps/api record tool: price diagnostics
export { PAGE_LIMIT } from '../travelpayouts/params.js'; // apps/api record tool: the page size and short-page rule
export { buildRequestUrl, MAX_PAGES } from '../travelpayouts/provider.js'; // apps/api record tool: the one request URL and page cap
export type { TileParams } from '../travelpayouts/tiles.js';
