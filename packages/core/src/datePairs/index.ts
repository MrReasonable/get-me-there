// The date-pair core of the Dates view (WP19): the space arithmetic, the figure precedence, the board's rank, the
// folded stay bands, the detail link, the route's codec, (WP20) the main path's five marks, (WP21) the pairing figure
// and (Ruling 3) which figures are trips, flights read or lower on the calendar.
// Re-exported through the package barrel.
export { foldNights, MAX_NIGHT_BANDS, type NightsBand } from './bands.js';
export {
  applyCheck,
  type Check,
  CONFIRM_PATIENCE,
  CONFIRM_TARGET,
  checkOfRead,
  EMPTY_STANDINGS,
  improves,
  patienceSpent,
  type Standings,
  uncheckedCheaper,
} from './confirm.js';
export { decodeDatePairs } from './decode.js';
export { DETAIL_LINK_PARAMS, detailLinkQuery } from './detailLink.js';
export {
  type DatePair,
  type DatePairFigure,
  type DatePairPairing,
  type DecodedDatePairs,
  encodeDatePairs,
  provenanceKey,
} from './encode.js';
export {
  type Figure,
  type FigureCandidate,
  type FigureScope,
  figuresByDatePair,
  type GridPrice,
  type PairingOf,
  pickCalendarFigure,
  pickFigure,
  pickVerifiedFigure,
} from './figure.js';
export {
  datePairBuckets,
  datePairSearched,
  markCounts,
  REDUCED_MARKS,
  type ReducedMark,
  reducedMark,
  searchedDatePairCount,
} from './marks.js';
// why: cheapestOffer reaches the barrel through flights/ (its one body is beside the booking read)
export {
  bookingReturnOf,
  cheapestPairing,
  FIGURE_BASES,
  type FigureBasis,
  type LeadFacts,
  type ListPairingRead,
  listFresh,
  PAIRING_KINDS,
  PAIRING_READ,
  type Pairing,
  type PairingCandidate,
  type PairingKind,
  type PairingPriceKind,
  type PairingRead,
  pairingKindOf,
  pairingLeads,
  pairingOffer,
  pairingPrice,
  pairingReadOf,
  resultBasisOf,
} from './pairing.js';
export { bestPerWeek, rankDatePairs, rankTierOf } from './rank.js';
export {
  type DatePairSpace,
  datePairAt,
  datePairCount,
  datePairIndex,
  datePairIndexer,
  stayCount,
} from './space.js';
export {
  cheapestTrips,
  flightsRead,
  isTrip,
  lowerOnCalendar,
  overLimitCount,
  type RankFacts,
  type ReadFacts,
  type TripFacts,
} from './views.js';
