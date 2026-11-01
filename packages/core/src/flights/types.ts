import { z } from 'zod';

/**
 * Spec revision 55 §7 `flight_lists.listed` and §8.1 (the flight-list step): what a browser flight list showed for a
 * date pair, when it was read. `flights`: at least one flight was read for the pair; `no-flights`: Google's own
 * no-flights line; `none-for-cell`: options were listed, but none this app could read or match to the pair's dates and
 * airports. Never a price, a verdict or a coverage bucket (a flight read changes none of them).
 */
export const LISTED = ['flights', 'no-flights', 'none-for-cell'] as const;
export type Listed = (typeof LISTED)[number];

/**
 * Spec revision 55 §2 (sec-004, prov-int-008): one carrier or operator name as a flight list stores it: trimmed,
 * whitespace collapsed, 1 to 80 characters, and no control or format character (`\p{Cc}`, `\p{Cf}`: the bidi
 * overrides and zero-width marks included), so a name can never reorder or hide the text around it where it is shown.
 */
export const FLIGHT_TEXT = /^[^\p{Cc}\p{Cf}]{1,80}$/u;
// why: the name must also be trimmed and collapsed, which the character class alone cannot say
const flightText = z
  .string()
  .regex(FLIGHT_TEXT)
  .refine((s) => s === s.trim() && !/\s{2,}/.test(s), { message: 'trimmed, whitespace collapsed' });
/** A local wall-clock time as the page states it, `HH:MM` on the 24-hour clock (`24:00` is refused). */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Spec revision 55 §2 "The flight-list read": one outbound flight a list page showed for a date pair. Times are the
 * page's local times; `arrivesDayOffset` is the days from the departure date to the arrival date the option's name
 * states (0 to 3); `carriers` are the marketing carriers as named, `operatedBy` the operating carrier when the name
 * states one; `amountMinor` is the lowest round-trip total, GBP pence, listed with this outbound (its "From" price;
 * ruling A28: above 0). The return flight is neither chosen nor read; no flight number, seller or baggage is.
 */
export const listedFlightSchema = z.strictObject({
  departsLocal: hhmm,
  arrivesLocal: hhmm,
  arrivesDayOffset: z.number().int().min(0).max(3),
  durationMinutes: z.number().int().min(1).max(6000),
  stops: z.number().int().min(0).max(5),
  carriers: z.array(flightText).min(1).max(6),
  operatedBy: flightText.nullable(),
  amountMinor: z.number().int().min(1),
});
export type ListedFlight = z.infer<typeof listedFlightSchema>;
