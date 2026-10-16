import type { Constraints } from './definition.js';
import type { Iata, IsoDate, IsoDateTime } from './ids.js';
import type { Cabin, FxInfo, Provenance, ProviderId } from './provenance.js';

/** Which inputs a provider actually supplied; a constraint needing an absent one is `unverified`. Spec §6.2. */
export type SuppliedField =
  | 'segments'
  | 'segmentTimes'
  | 'segmentCabins'
  | 'selfTransfer'
  | 'baggage'
  | 'fareConditions'
  | 'seller'
  | 'price';
export interface BaggageSnapshot {
  cabinBag?: 'included' | 'not-included';
  checkedBags?: number;
  notes?: string[];
}
export interface FareConditions {
  refundable?: boolean;
  changeable?: boolean;
  notes?: string[];
}
/** Spec §5.4: GET links open in the browser; POST bookings render as a form, never fetched server-side. */
export type Booking =
  | { kind: 'get'; url: string; host: string }
  | { kind: 'post'; url: string; postData: string; host: string }
  | { kind: 'none' };

/** Spec §6.3. `departLocal` is `YYYY-MM-DDTHH:mm` local to `from`; `flightNumber` is an integer. */
export interface Segment {
  marketingCarrier: string;
  operatingCarrier?: string;
  flightNumber: number;
  from: Iata;
  to: Iata;
  departLocal: string;
  arriveLocal: string;
  departUtc?: IsoDateTime;
  arriveUtc?: IsoDateTime;
  durationMinutes?: number;
  aircraft?: string;
}
export interface Layover {
  at: Iata;
  minutes: number;
  overnight: boolean;
  airportChange: boolean;
}
/** Spec §6.3 / §6.4: identity by canonical hash over the segments; cabin and price live elsewhere. */
export interface NormalisedItinerary {
  hash: string;
  origin: Iata;
  destination: Iata;
  departureDate: IsoDate;
  returnDate: IsoDate;
  nights: number;
  outbound: Segment[];
  inbound: Segment[];
  outboundMinutes?: number;
  inboundMinutes?: number;
  stopsOut: number;
  stopsIn: number;
  layovers: Layover[];
  airportChange?: boolean;
  marketingCarriers: string[];
}
/** Spec §3 "Fare offer" = (itinerary, provider, seller, cabin). */
export interface Offer {
  itineraryHash: string;
  providerId: ProviderId;
  seller: string;
  cabin: Cabin;
}
/** What normalisation yields for one raw offer, before the db assigns ids. */
export interface ObservationFields {
  pricePence: number;
  priceNativeMinor: number;
  currencyNative: string;
  fx: FxInfo;
  taxesIncluded: boolean | null;
  selfTransfer: boolean | null;
  segmentCabins: Cabin[] | null;
  baggage: BaggageSnapshot | null;
  fareConditions: FareConditions | null;
  booking: Booking;
  bookingExpiresAt: IsoDateTime | null;
}
/** Spec §7 `price_observations` as read back. */
export interface Observation extends ObservationFields {
  id: number;
  offerId: number;
  executionId: string;
  provenance: Provenance;
  suppliedFields: SuppliedField[];
  partialExpansion: boolean;
}
export type Verdict = 'pass' | 'fail' | 'unverified';
/**
 * `cabin` and `priceConfirmed` are judged on every offer whatever the definition sets; `priceConfirmed` is present only
 * as `unverified`, for an offer whose price no seller listing confirmed (decision 37).
 */
export type ConstraintName = keyof Constraints | 'cabin' | 'priceConfirmed';
export type Verdicts = Partial<Record<ConstraintName, Verdict>>;
export type VerdictClass = 'verified' | 'partially-verified' | 'failed';
/** API values; the UI labels them "itinerary-search basis" and "calendar basis". Spec §6.9. */
export type ResultBasis = 'verified' | 'calendar';
