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
/**
 * Page text held to `FLIGHT_TEXT`, trimmed and whitespace collapsed: a carrier, an operator, and (spec revision 56
 * §5.1) a seller's and a fare's name on the booking view. Exported for `returns.ts`'s offer; off the package barrel.
 */
// why: the name must also be trimmed and collapsed, which the character class alone cannot say
export const flightTextSchema = z
  .string()
  .regex(FLIGHT_TEXT)
  .refine((s) => s === s.trim() && !/\s{2,}/.test(s), { message: 'trimmed, whitespace collapsed' });
/** A local wall-clock time as the page states it, `HH:MM` on the 24-hour clock (`24:00` is refused). */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Spec revision 56 §5.1: the leg fields an outbound and a return share, with their checks (module-private; spread by
 * both schemas). Split around the day offset, whose range differs per leg, so the outbound's stored key order stays.
 */
const legTimes = { departsLocal: hhmm, arrivesLocal: hhmm };
const legRest = {
  durationMinutes: z.number().int().min(1).max(6000),
  stops: z.number().int().min(0).max(5),
  carriers: z.array(flightTextSchema).min(1).max(6),
  operatedBy: flightTextSchema.nullable(),
};

/**
 * Spec revision 55 §2 "The flight-list read": one outbound flight a list page showed for a date pair. Times are the
 * page's local times; `arrivesDayOffset` is the days from the departure date to the arrival date the option's name
 * states (0 to 3); `carriers` are the marketing carriers as named, `operatedBy` the operating carrier when the name
 * states one; `amountMinor` is the lowest round-trip total, GBP pence, listed with this outbound (its "From" price;
 * ruling A28: above 0). Revision 56: the return flights are read by the return phase (`listedReturnSchema`); no flight
 * number or baggage is.
 */
export const listedFlightSchema = z.strictObject({
  ...legTimes,
  arrivesDayOffset: z.number().int().min(0).max(3),
  ...legRest,
  amountMinor: z.number().int().min(1),
});
export type ListedFlight = z.infer<typeof listedFlightSchema>;

/**
 * Spec revision 56 §5.1 (prov-r3-003): one return flight the return view listed for the selected outbound. The leg
 * fields and checks are the outbound's; `arrivesDayOffset` is from the RETURN date (−1 to 3: −1 a date-line return
 * arriving the previous calendar day); `fromMinor` is the return's "From" price in GBP pence, the lowest Google listed
 * for that outbound with this return (the cheapest seller's), named for what it is: a lower bound, never the total.
 */
export const listedReturnSchema = z.strictObject({
  ...legTimes,
  arrivesDayOffset: z.number().int().min(-1).max(3),
  ...legRest,
  fromMinor: z.number().int().min(1),
});
export type ListedReturn = z.infer<typeof listedReturnSchema>;

/** Spec revision 56 §6.2: what `withinLimits` judges of either leg. */
export type LegTimes = Pick<ListedFlight, 'departsLocal' | 'arrivesLocal' | 'durationMinutes' | 'stops'>;
