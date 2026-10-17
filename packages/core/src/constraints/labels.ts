import type { ConstraintName } from '../types/itinerary.js';

/**
 * Plain-English name of every constraint, for renderers (WP9 rows, WP11 email). `unverifiedNames`
 * and `Verdicts` keep the keys; only text shown to the operator uses these labels (review pft-008).
 * Typed as a full Record, so a new ConstraintName without a label fails to compile.
 */
export const CONSTRAINT_LABELS: Record<ConstraintName, string> = {
  cabin: 'cabin',
  maxStops: 'max stops',
  maxJourneyMinutes: 'max journey time',
  minLayoverMinutes: 'min connection time',
  maxLayoverMinutes: 'max connection time',
  noOvernightLayover: 'no overnight connection',
  departureWindowLocal: 'departure time window',
  arrivalWindowLocal: 'arrival time window',
  noSelfTransfer: 'no self-transfer',
  noAirportChange: 'no airport change',
  includeAirlines: 'airlines to include',
  excludeAirlines: 'airlines to exclude',
  cabinBagRequired: 'cabin bag',
  checkedBagRequired: 'checked bag',
  minCheckedBags: 'min checked bags',
  maxPricePence: 'max price',
  priceConfirmed: 'price not confirmed by the final step',
};

/** Every ConstraintName in a fixed order (cabin, then the spec §6.2 table order, then priceConfirmed). */
export const CONSTRAINT_NAMES = [
  'cabin',
  'maxStops',
  'maxJourneyMinutes',
  'minLayoverMinutes',
  'maxLayoverMinutes',
  'noOvernightLayover',
  'departureWindowLocal',
  'arrivalWindowLocal',
  'noSelfTransfer',
  'noAirportChange',
  'includeAirlines',
  'excludeAirlines',
  'cabinBagRequired',
  'checkedBagRequired',
  'minCheckedBags',
  'maxPricePence',
  'priceConfirmed',
] as const satisfies readonly ConstraintName[];
