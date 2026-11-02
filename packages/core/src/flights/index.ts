// Spec revision 55 §2 and §8.1: the flight list's figures and shapes (WP20 Task 20.7; Task 20.10 adds the choosers);
// revision 56 (WP21 Task 21.2) adds the return and booking reads, the limits with stops and the outbound selection.

export * from './choose.js';
export * from './limits.js';
export {
  BOOKING_FINISHED,
  BOOKING_STATUS,
  BOOKING_TRANSIENT,
  type BookingRead,
  type BookingStatus,
  bookingReadSchema,
  cheapestOffer,
  // why: the package barrel already exports an itinerary `Offer` (types/itinerary.ts); a booking view's offer is named
  // for what it is there
  type Offer as BookingOffer,
  offerSchema,
  offersComplete,
  RETURN_FINISHED,
  RETURN_STATUS,
  RETURN_TRANSIENT,
  type ReturnAttempt,
  type ReturnRead,
  type ReturnStatus,
  returnAttemptSchema,
  returnReadSchema,
  returnsOutboundIssue,
} from './returns.js';
export * from './ties.js';
// why: flightTextSchema stays off the barrel (spec rev 56 §5.1: returns.ts's offer reads it from the module)
export {
  FLIGHT_TEXT,
  type LegTimes,
  LISTED,
  type Listed,
  type ListedFlight,
  type ListedReturn,
  listedFlightSchema,
  listedReturnSchema,
} from './types.js';
