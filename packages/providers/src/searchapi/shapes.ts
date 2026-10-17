import { MINOR_EXPONENT } from '@gmt/core';
import { z } from 'zod';
import { parseError } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import type { NoteCounter } from '../shared/notes.js';
import { SEARCHAPI_WHERE } from './params.js';

const echoSchema = z.object({ currency: z.string().optional(), gl: z.string().optional() });

/**
 * One `google_flights_calendar` entry (docs 2026-10-14): `has_no_flights` is per entry and such entries omit `price`.
 * Dates stay strings here and are checked per entry with core's `isoDateSchema`; prices stay numbers and go through
 * `majorToMinor`.
 */
export const calendarEntrySchema = z.object({
  departure: z.string(),
  return: z.string().optional(),
  price: z.number().optional(),
  is_lowest_price: z.boolean().optional(),
  has_no_flights: z.boolean().optional(),
});
/**
 * The calendar envelope, strict; its entries are read one by one with `calendarEntrySchema`, so one wrongly shaped
 * entry is dropped and counted rather than failing the tile (CodeRabbit batch 3).
 */
export const calendarResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  calendar: z.array(z.unknown()),
});

const airportSchema = z.object({ id: z.string(), date: z.string(), time: z.string() });
/** One flight of an option; `id` may be a vendor place id rather than an IATA code (docs), so it is checked per segment. */
export const segmentSchema = z.object({
  departure_airport: airportSchema,
  arrival_airport: airportSchema,
  airline: z.string().optional(),
  flight_number: z.string(),
  travel_class: z.string().optional(),
  duration: z.number().int().nonnegative().optional(),
  airplane: z.string().optional(),
});
export const optionSchema = z.object({
  flights: z.array(segmentSchema),
  price: z.number().optional(),
  departure_token: z.string().optional(),
  booking_token: z.string().optional(),
});
/** One `price_insights.price_history` point; checked per point so a bad one is dropped, never fatal. */
export const historyPointSchema = z.object({ price: z.number(), iso_date: z.string() });
/**
 * Steps 1 and 2. `other_flights` is not on the docs page; it is read when present. The envelope is strict; each option
 * is read on its own with `optionSchema`, so one wrongly shaped option is dropped and counted (CodeRabbit batch 3).
 */
export const flightsResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  best_flights: z.array(z.unknown()).optional(),
  other_flights: z.array(z.unknown()).optional(),
  price_insights: z.object({ price_history: z.array(z.unknown()).nullish() }).nullish(),
});
export const bookingOptionSchema = z.object({
  book_with: z.string().optional(),
  price: z.number().optional(),
  baggage_prices: z.array(z.string()).optional(),
  booking_request: z.object({ url: z.string(), post_data: z.string() }).optional(),
  booking_phone: z.string().optional(),
  is_split_booking: z.boolean().optional(),
  /** The designators the seller lists, one per flight in step-1 then step-2 order (recorded 2026-10-15). */
  flight_numbers: z.array(z.string()).optional(),
});
/** Step 3 (`booking_token`). */
export const bookingResponseSchema = z.object({
  search_parameters: echoSchema.optional(),
  booking_options: z.array(bookingOptionSchema).optional(),
});
export type VendorSegment = z.infer<typeof segmentSchema>;
export type VendorOption = z.infer<typeof optionSchema>;
export type VendorBookingOption = z.infer<typeof bookingOptionSchema>;

/**
 * Currency and point of sale from the `search_parameters` echo. Spec §2: a response that states no currency is a
 * parse error; spec §5.2: `pointOfSale` is the upper-cased `gl` echo, and an echo other than the request is a
 * parse error (the vendor answered for another market).
 */
export function readEcho(
  echo: z.infer<typeof echoSchema> | undefined,
  requestedGl: string,
): { currency: string; pointOfSale: string } {
  const currency = echo?.currency;
  if (currency === undefined || !/^[A-Za-z]{3}$/.test(currency))
    throw parseError(
      'no-currency',
      'the response states no currency (search_parameters.currency)',
      SEARCHAPI_WHERE,
    );
  const gl = echo?.gl;
  if (gl === undefined || !/^[A-Za-z]{2}$/.test(gl))
    throw parseError(
      'no-point-of-sale',
      'the response does not echo gl (search_parameters.gl)',
      SEARCHAPI_WHERE,
    );
  if (gl.toLowerCase() !== requestedGl)
    throw parseError(
      'point-of-sale-mismatch',
      `echoed gl=${gl}; requested gl=${requestedGl}`,
      SEARCHAPI_WHERE,
    );
  return { currency: currency.toUpperCase(), pointOfSale: gl.toUpperCase() };
}

/** True when core knows the currency's minor-unit exponent (spec §6.3); otherwise rows are `currency-unsupported`. */
export function currencySupported(currency: string): boolean {
  return MINOR_EXPONENT[currency] !== undefined;
}

/** A vendor price as minor units, or why the row was dropped (a closed-list reason for `CellIssue.reason`). */
export type Minor =
  | { minor: number; dropped: null }
  | { minor: null; dropped: 'currency-unsupported' | 'parse' };

/**
 * Vendor major units → integer minor units through WP6's shared `majorToMinor` (exact decimal arithmetic, plan
 * decision 24; never rounded). A row is dropped and counted `offers-dropped` (WP6's notes vocabulary): with
 * reason `currency-unsupported` when core knows no exponent for the currency (plan decision 29: a normalisation
 * reason, never a tile-level parse error), else with reason `parse` (decision 28: a bad vendor price) for excess
 * precision or a non-positive amount. The reason travels in the result (a `CellIssue`, an error), not in a note.
 */
export function minorOrDrop(major: number, currency: string, notes: NoteCounter): Minor {
  if (!currencySupported(currency)) {
    notes.add('offers-dropped');
    return { minor: null, dropped: 'currency-unsupported' };
  }
  const minor = majorToMinor(major, currency);
  if (minor === null) {
    notes.add('offers-dropped');
    return { minor: null, dropped: 'parse' };
  }
  return { minor, dropped: null };
}
