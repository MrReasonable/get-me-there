// The date-pair core of the Dates view (WP19): the space arithmetic, the figure precedence, the board's rank, the
// folded stay bands, the detail link, the route's codec, (WP20) the main path's five marks and (WP21) the pairing figure.
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
  PAIRING_READ,
  type Pairing,
  type PairingCandidate,
  type PairingPriceKind,
  type PairingRead,
  pairingLeads,
  pairingOffer,
  pairingPrice,
  pairingReadOf,
  resultBasisOf,
} from './pairing.js';
export { bestPerWeek, rankDatePairs } from './rank.js';
export {
  type DatePairSpace,
  datePairAt,
  datePairCount,
  datePairIndex,
  datePairIndexer,
  stayCount,
} from './space.js';
