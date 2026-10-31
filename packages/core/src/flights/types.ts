/**
 * Spec revision 55 §7 `flight_lists.listed` and §8.1 (the flight-list step): what a browser flight list showed for a
 * date pair, when it was read. `flights`: at least one flight was read for the pair; `no-flights`: Google's own
 * no-flights line; `none-for-cell`: options were listed, but none this app could read or match to the pair's dates and
 * airports. Never a price, a verdict or a coverage bucket (a flight read changes none of them).
 */
export const LISTED = ['flights', 'no-flights', 'none-for-cell'] as const;
export type Listed = (typeof LISTED)[number];
