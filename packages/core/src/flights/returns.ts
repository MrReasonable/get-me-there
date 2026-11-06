/**
 * Spec revision 56 §2 "The return phase" and §5.1: the return read a flights answer carries, the booking read of the
 * shown pairing (Ian's ruling of 2026-11-01) and its offers, every shape a strict zod schema with the spec's
 * refinements, and the statuses each read ends in. Pure; the worker writes these, the provider, the database, the api
 * and the web read them through these schemas.
 */
import { z } from 'zod';
import { workerRuleSchema } from '../camoufox/rule.js';
import { type FlightLimits, fitsLimits, flightLimitsSchema } from './choose.js';
import { BOOKING_OFFERS_MAX, FLIGHT_LIST_MAX_FLIGHTS, RETURN_ATTEMPTS_MAX } from './limits.js';
import { flightTextSchema, type ListedReturn, listedReturnSchema } from './types.js';

// why: api-contract/common.ts's countSchema would pull api-contract into flights/, so this module keeps its own count
const count = z.number().int().min(0);

/**
 * How a return phase ended (spec rev 56 §2): `read`: at least one attempt's return view was read (its returns may be
 * empty: listed `none-for-cell`); `no-outbound`: the outbound page listed no flight for the pair, nothing activated;
 * `skipped`: no attempt made, rule `spacing` (the spacing wait ran out of its budget) or `not-cheapest-view`;
 * `select-failed`, `not-settled`, `unrecognised`: the first attempt's transient end, with its rule; `not-verified`: the
 * entry's RETURN_SELECT_VERIFIED is false.
 */
export const RETURN_STATUS = [
  'read',
  'no-outbound',
  'skipped',
  'select-failed',
  'not-settled',
  'unrecognised',
  'not-verified',
] as const;
export type ReturnStatus = (typeof RETURN_STATUS)[number];
/**
 * A return phase done (spec rev 56 §8.1 reuse). `not-verified` is reused only while the worker still reports the flag
 * false (R-unverified), which the reuse rule decides, not this set.
 */
export const RETURN_FINISHED: ReadonlySet<ReturnStatus> = new Set<ReturnStatus>(['read', 'no-outbound']);
/**
 * Read again (spec rev 56 §2, §8.1); the step stops the run's return phases after `select-failed`, `not-settled` or
 * `unrecognised`, never after `skipped` (which is the spacing's or the view's).
 */
export const RETURN_TRANSIENT: ReadonlySet<ReturnStatus> = new Set<ReturnStatus>([
  'select-failed',
  'not-settled',
  'unrecognised',
  'skipped',
]);
/** The return statuses whose read carries a rule saying why (a `read` may carry one too: its second attempt's end). */
const RETURN_RULED: ReadonlySet<ReturnStatus> = new Set<ReturnStatus>([
  'skipped',
  'select-failed',
  'not-settled',
  'unrecognised',
]);

/**
 * How the booking read of the shown pairing ended (spec rev 56 §2): `read`: the expansion made (or no control present)
 * and at least one offer read; `no-pairing`: no return was listed on any attempt, nothing selected; `skipped`: no
 * booking step was made, with its rule (`spacing`, `not-cheapest-view`, `reload:<end>`, `second-selection`); `select-failed`, `not-settled`, `unrecognised`: the return's activation, the booking view's settle
 * or its shape (`more-options-count` when two or more expansion controls show, nothing pressed); `expand-failed`: the
 * expansion's activation failed or the expanded view did not settle (the offers read before it kept, `expanded` false);
 * `not-verified`: BOOKING_SELECT_VERIFIED false on the entry.
 */
export const BOOKING_STATUS = [
  'read',
  'no-pairing',
  'skipped',
  'select-failed',
  'not-settled',
  'unrecognised',
  'expand-failed',
  'not-verified',
] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];
/** A booking read done (spec rev 56 §8.1). */
export const BOOKING_FINISHED: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['read', 'no-pairing']);
/** The booking view's own transient ends: each sets the run's `bookingStopped` (spec rev 56 §8.1). */
export const BOOKING_TRANSIENT: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'select-failed',
  'not-settled',
  'unrecognised',
  'expand-failed',
]);
/**
 * Spec rev 56 §8.1 (R-retry; ruling 21.6 I1): the booking ends after which a list is read again, once, then waits for
 * the refresh (its `transientStreak`): the transient ends and `skipped` (any rule). Not `BOOKING_TRANSIENT`: a skipped
 * booking (the month's pages, the spacing, a structural rule) never stops the pass's booking reads.
 */
export const BOOKING_REREAD: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  ...BOOKING_TRANSIENT,
  'skipped',
]);
/** The booking statuses that carry a rule. */
const BOOKING_RULED: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'skipped',
  'select-failed',
  'not-settled',
  'unrecognised',
  'expand-failed',
]);
/** The booking statuses that name the pairing they selected (`attempt`, `returnIndex`). */
const BOOKING_SELECTED: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'read',
  'select-failed',
  'not-settled',
  'unrecognised',
  'expand-failed',
]);
/** The booking statuses that may keep offers (test-r3-001: an expand-failed read keeps the offers read before it). */
const BOOKING_WITH_OFFERS: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['read', 'expand-failed']);

/**
 * One seller's offer on the booking view (spec rev 56 §2): "Continue to book with <seller>[, <fare>] for <price> British
 * pounds", the price stated (never "From"), in GBP pence by the ISO 4217 exponent; seller and fare are page text held
 * to `FLIGHT_TEXT`, rendered as text only.
 */
export const offerSchema = z.strictObject({
  seller: flightTextSchema,
  fare: flightTextSchema.nullable(),
  priceMinor: z.number().int().min(1),
});
export type Offer = z.infer<typeof offerSchema>;

/**
 * The booking read of the shown pairing (spec rev 56 §2, §5.1): its status and rule, the pairing selected
 * (`attempts[attempt].returns[returnIndex]`), whether the "more booking options" control was activated and its view
 * settled (`expanded`), whether a further expansion control remained (`moreControl`, never pressed), the grouped
 * "View <seller>, …" controls seen (`grouped`, never activated), the offers read (at most BOOKING_OFFERS_MAX), the offer
 * buttons dropped (`unparsed`: a name the grammar refuses; `nonGbp`: a price in another currency) and the offer buttons
 * counted before the cut when above it (`offersStated`).
 */
export const bookingReadSchema = z
  .strictObject({
    status: z.enum(BOOKING_STATUS),
    rule: workerRuleSchema.nullable(),
    attempt: count.nullable(),
    returnIndex: count.nullable(),
    expanded: z.boolean(),
    moreControl: z.boolean(),
    grouped: count,
    offers: z.array(offerSchema).max(BOOKING_OFFERS_MAX),
    unparsed: count,
    nonGbp: count,
    offersStated: count.nullable(),
  })
  .superRefine((b, ctx) => {
    const fail = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (b.status === 'read' && b.offers.length === 0) fail('offers', 'a read booking has at least one offer');
    if (!BOOKING_WITH_OFFERS.has(b.status) && b.offers.length > 0)
      fail('offers', 'offers only on a read or expand-failed booking');
    if (BOOKING_RULED.has(b.status) !== (b.rule !== null))
      fail('rule', 'a rule exactly for skipped, select-failed, not-settled, unrecognised and expand-failed');
    const selected = BOOKING_SELECTED.has(b.status);
    if (selected !== (b.attempt !== null))
      fail('attempt', 'the pairing selected exactly when one was activated');
    if (selected !== (b.returnIndex !== null))
      fail('returnIndex', 'the pairing selected exactly when one was activated');
    if (b.offersStated !== null && b.offersStated <= b.offers.length)
      fail('offersStated', 'offersStated only when more offers were stated than kept');
  });
export type BookingRead = z.infer<typeof bookingReadSchema>;

/**
 * The lowest stated price of a `read` or `expand-failed` booking with offers, ties to the lower index (spec rev 56
 * §6.9); null for null and for every other status. The offers are kept cheapest first, but this does not rely on it.
 */
export function cheapestOffer(b: BookingRead | null): { index: number; offer: Offer } | null {
  if (b === null || !BOOKING_WITH_OFFERS.has(b.status)) return null;
  let best: { index: number; offer: Offer } | null = null;
  for (const [index, offer] of b.offers.entries())
    if (best === null || offer.priceMinor < best.offer.priceMinor) best = { index, offer };
  return best;
}

/**
 * R-sellers with rulings A8 and R-unread (spec rev 56 §6.9): whether a booking read's offers are complete for a return
 * whose "from" price is `fromMinor`: its cheapest offer equals that price, or, on a `read` booking, no further expansion
 * control, no grouped seller control and no offer left unread remained (none the grammar refused, `unparsed`, and none
 * priced in another currency, `nonGbp`). An `expand-failed` booking is complete only by the first test. A read that is
 * not complete never leads and is shown "a cheaper seller may not have been read".
 */
export function offersComplete(b: BookingRead, fromMinor: number): boolean {
  const cheapest = cheapestOffer(b);
  if (cheapest !== null && cheapest.offer.priceMinor === fromMinor) return true;
  return b.status === 'read' && !b.moreControl && b.grouped === 0 && b.unparsed === 0 && b.nonGbp === 0;
}

/**
 * One attempt of a return phase (spec rev 56 §5.1): the outbound selected (`outboundIndex` into the list's `flights`;
 * `outboundFits` false only on the no-outbound-fits attempt), what its return view listed, whether it showed more than
 * this app read (`moreListed`, R-viewmore), the returns read (R-returns30: those fitting the request's limits first,
 * then the rest, cut to 30, kept in page order) and the options it could not read or that were another cell's.
 */
export const returnAttemptSchema = z
  .strictObject({
    outboundIndex: count,
    outboundFits: z.boolean(),
    listed: z.enum(['returns', 'none-for-cell']),
    moreListed: z.boolean(),
    returns: z.array(listedReturnSchema).max(FLIGHT_LIST_MAX_FLIGHTS),
    optionsUnparsed: count,
    optionsOtherCell: count,
    resultsStated: count.nullable(),
  })
  .refine((a) => (a.listed === 'returns') === a.returns.length > 0, {
    message: "listed 'returns' exactly when a return was read",
    path: ['returns'],
  });
export type ReturnAttempt = z.infer<typeof returnAttemptSchema>;

/** Whether any of an attempt's returns fits the limits on the return leg. */
const anyFits = (returns: readonly ListedReturn[], l: FlightLimits): boolean =>
  returns.some((r) => fitsLimits(r, l, 'return'));

/**
 * The return read of one flights request (spec rev 56 §5.1): the limits the selection used (stored: reuse and the
 * figure's lead compare them), its status and rule (a `read` may carry the rule of a second attempt that ended early or
 * could not start), the attempts in order made, whether no further outbound within the limits remained untried, and the
 * booking read of the shown pairing (null when the request asked for none).
 */
export const returnReadSchema = z
  .strictObject({
    limits: flightLimitsSchema,
    status: z.enum(RETURN_STATUS),
    rule: workerRuleSchema.nullable(),
    attempts: z.array(returnAttemptSchema).max(RETURN_ATTEMPTS_MAX),
    triedAll: z.boolean(),
    booking: bookingReadSchema.nullable(),
  })
  .superRefine((r, ctx) => {
    const fail = (path: Array<string | number>, message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if ((r.status === 'read') !== r.attempts.length > 0)
      fail(['attempts'], 'attempts exactly when the return read is read');
    if (RETURN_RULED.has(r.status) && r.rule === null)
      fail(['rule'], 'skipped, select-failed, not-settled and unrecognised name their rule');
    if ((r.status === 'no-outbound' || r.status === 'not-verified') && r.rule !== null)
      fail(['rule'], 'no-outbound and not-verified carry no rule');
    const [first, second] = r.attempts;
    if (first !== undefined && second !== undefined) {
      // why: an outbound over the limits is selected only when none fits, so no fitting outbound remains to try
      if (!first.outboundFits)
        fail(['attempts', 0, 'outboundFits'], 'a second attempt follows a first outbound within the limits');
      if (!second.outboundFits) fail(['attempts', 1, 'outboundFits'], 'a second outbound fits the limits');
      if (anyFits(first.returns, r.limits))
        fail(['attempts', 1], 'a second attempt only when the first has no return within the limits');
    }
    const b = r.booking;
    if (b !== null && b.attempt !== null) {
      const last = r.attempts.length - 1;
      if (b.attempt !== last) fail(['booking', 'attempt'], 'the booking read is of the last attempt');
      const returns = r.attempts[b.attempt]?.returns.length ?? 0;
      if (b.returnIndex !== null && b.returnIndex >= returns)
        fail(['booking', 'returnIndex'], "the booking's return is one of its attempt's returns");
    }
  });
export type ReturnRead = z.infer<typeof returnReadSchema>;

/**
 * The first attempt whose `outboundIndex` is not one of `flightCount` flights, or null: the protocol and the contract
 * refuse a return read naming an outbound past the list's flights (the provider maps the breach to `list-error` parse).
 */
export function returnsOutboundIssue(r: ReturnRead, flightCount: number): number | null {
  const i = r.attempts.findIndex((a) => a.outboundIndex >= flightCount);
  return i < 0 ? null : i;
}
