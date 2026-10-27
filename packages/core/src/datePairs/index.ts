// The date-pair core of the Dates view (WP19): the space arithmetic, the figure precedence, the board's rank, the
// folded stay bands, the detail link and the route's codec. Re-exported through the package barrel.
export { foldNights, MAX_NIGHT_BANDS, type NightsBand } from './bands.js';
export { decodeDatePairs } from './decode.js';
export { DETAIL_LINK_PARAMS, detailLinkQuery } from './detailLink.js';
export {
  type DatePair,
  type DatePairFigure,
  type DecodedDatePairs,
  encodeDatePairs,
  provenanceKey,
} from './encode.js';
export {
  type Figure,
  type FigureCandidate,
  type FigureScope,
  figuresByDatePair,
  pickCalendarFigure,
  pickFigure,
  pickVerifiedFigure,
} from './figure.js';
export { bestPerWeek, rankDatePairs } from './rank.js';
export {
  type DatePairSpace,
  datePairAt,
  datePairCount,
  datePairIndex,
  datePairIndexer,
  stayCount,
} from './space.js';
