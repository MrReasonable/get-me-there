/**
 * Spec revision 55 §10 (WP20 Task 20.7): the flight-list contract, read by `GET /definitions/:id/flight-lists` and
 * started by its POST (the routes and handlers arrive in Task 20.9). A list is the browser worker's record of one date
 * pair's list page (§2 "The flight-list read"; §7 `flight_lists`): never a price row, a verdict or a coverage bucket.
 */
import { z } from 'zod';
import { FLIGHT_LIST_MAX_FLIGHTS } from '../flights/limits.js';
import { returnReadSchema, returnsOutboundIssue } from '../flights/returns.js';
import { LISTED, listedFlightSchema } from '../flights/types.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { pointOfSaleSchema } from '../types/provenance.js';
import { ageHoursSchema, countSchema, moneyPenceSchema, staleMarkSchema } from './common.js';
import { STOP_DETAILS } from './stopCause.js';

/**
 * `?pairs=2027-03-14_2027-03-24,…`: the date pairs a page asks for, 1 to MAX_FLIGHT_LIST_PAIRS (50) of them, each
 * `departure_return`; the handler refuses any other count or form with 422 `invalid_pairs` (spec §10), 51 pairs
 * included. Only a string far past any valid one (50 pairs are 1,099 characters) is refused here, as a 400.
 */
export const flightListsQuerySchema = z.strictObject({ pairs: z.string().max(4096) });

/**
 * A flight list's provenance (spec rev 55 §2; §7's CHECKs): the browser worker's own page, `scraped-self`, read in GBP
 * (`fx` not converted), economy, `maxAgeHours` 0, at the point of sale the page stated. A fixture or synthetic list is
 * refused, as the database refuses it.
 */
export const flightListProvenanceSchema = z.strictObject({
  providerId: z.literal('camoufox'),
  sourceKind: z.literal('scraped-self'),
  fetchedAt: isoDateTimeSchema,
  maxAgeHours: z.literal(0),
  fx: z.strictObject({ converted: z.literal(false) }),
  pointOfSale: pointOfSaleSchema,
  cabin: z.literal('economy'),
});

/**
 * One stored flight list (spec rev 55 §10): `read` lists carry what the page listed (`listed`, never null) and no
 * reason; `failed` lists carry one STOP_DETAILS word (`reason`, never null) and no outcome. `stale`: the list's stale
 * mark, `'refresh'` once older than the search's camoufox refresh, else false (§10: every price-bearing shape carries the
 * mark, never a bare true). `flights` are the 30 cheapest of the pair's options in page order; `minMinor`, `tabMinor`
 * and `cheapestView` are the page's as the list read keeps them, a price never 0 (ruling A28, as the worker protocol and
 * the database hold it).
 */
export const flightListSchema = z
  .strictObject({
    id: z.number().int(),
    executionId: z.string().nullable(),
    origin: iataSchema,
    destination: iataSchema,
    departureDate: isoDateSchema,
    returnDate: isoDateSchema,
    fetchedAt: isoDateTimeSchema,
    ageHours: ageHoursSchema,
    stale: staleMarkSchema,
    provenance: flightListProvenanceSchema,
    status: z.enum(['read', 'failed']),
    reason: z.enum(STOP_DETAILS).nullable(),
    listed: z.enum(LISTED).nullable(),
    minMinor: moneyPenceSchema.min(1).nullable(),
    tabMinor: moneyPenceSchema.min(1).nullable(),
    cheapestView: z.enum(['cheapest', 'best-fallback']).nullable(),
    flights: z.array(listedFlightSchema).max(FLIGHT_LIST_MAX_FLIGHTS),
    optionsUnparsed: countSchema,
    optionsOtherCell: countSchema,
    resultsStated: countSchema.nullable(),
    /**
     * Spec rev 56 §10: the return read with its attempts, returns and booking read with its offers; null for a list read
     * without a return phase or stored before migration 0012. Required since Task 21.7 (R-order).
     */
    returns: returnReadSchema.nullable(),
  })
  .superRefine((l, ctx) => {
    // why: §7's CHECKs: (status = 'failed') = (reason IS NOT NULL) and (status = 'read') = (listed IS NOT NULL)
    if ((l.status === 'failed') !== (l.reason !== null))
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'a reason exactly when the list failed' });
    if ((l.status === 'read') !== (l.listed !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['listed'],
        message: 'an outcome exactly when the list was read',
      });
    if ((l.listed === 'flights') !== l.flights.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['flights'],
        message: "listed 'flights' exactly when a flight was read",
      });
    // why: spec rev 56 §10: an outbound index past the flights is refused (the booking's indices: returnReadSchema)
    const breach = l.returns === null ? null : returnsOutboundIssue(l.returns, l.flights.length);
    if (breach !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['returns', 'attempts', breach, 'outboundIndex'],
        message: "an attempt's outbound is one of the list's flights",
      });
  });
export type FlightList = z.infer<typeof flightListSchema>;

/**
 * A date pair's search link (spec §6.9): https, on Google's host only (the camoufox link is the worker's page), and
 * the url's own host is the one it states (20.7 review finding 3), so a stated host can never mask another.
 */
const flightListLinkSchema = z
  .strictObject({
    url: z.url({ protocol: /^https$/ }),
    host: z.enum(['www.google.com']),
    label: z.string(),
  })
  // why: zod runs an object's refinement even when a field failed, so an unparseable url is refused here, not thrown
  .refine((l) => URL.canParse(l.url) && new URL(l.url).hostname === l.host, {
    message: "the url's host is the stated host",
    path: ['url'],
  });

/**
 * `GET /definitions/:id/flight-lists`'s answer (spec rev 55 §10): whether flight lists can be read here (and why not),
 * the search's camoufox refresh, the browser worker's month's pages left and one run's pages, the pair being read now, and per asked pair
 * its airports, its link, the newest list for the figure's airport pair (`list`, the only one that feeds the outcome
 * beside the price, the difference line and orderWithinTie) and else the newest list for another airport pair of the
 * current space (`listOtherPair`, shown only inside the flights block under its airport-pair label).
 */
export const flightListsResponseSchema = z.strictObject({
  available: z.boolean(),
  unavailableReason: z.enum(['not-named', 'not-configured', 'cabin']).nullable(),
  refreshHours: countSchema,
  monthlyPagesLeft: countSchema.nullable(),
  // why: ruling R-pages (WP20 Task 20.10): this search's browser pages for one run, flight pages included, from its own
  // estimate; the read button adds "N pages left this month" only when `monthlyPagesLeft` is below it. Null when no
  // camoufox line of the search can run (or flight lists are not available here).
  runPages: countSchema.nullable(),
  /**
   * Ruling D3 (spec rev 56 §10): the pages one on-demand read plans, `flightPagesPerPair` of the worker's last reported
   * flags (2 with a return phase, or while the flags are unread: prov-008; else 1); the read button and its words use
   * it, never a hard number. Required since Task 21.7 (R-order: filled in 21.6, read by the web).
   */
  pagesPlanned: countSchema,
  reading: z.strictObject({ departureDate: isoDateSchema, returnDate: isoDateSchema }).nullable(),
  pairs: z.array(
    z.strictObject({
      departureDate: isoDateSchema,
      returnDate: isoDateSchema,
      origin: iataSchema.nullable(),
      destination: iataSchema.nullable(),
      link: flightListLinkSchema.nullable(),
      list: flightListSchema.nullable(),
      listOtherPair: flightListSchema.nullable(),
      /**
       * Final review B-I3 (spec rev 56 §10, §11): whether a read of this date pair would go now: flight lists can be
       * read here, the date pair is the board's and departs after today, and its newest list is none, one the
       * on-demand read would not refuse as `fresh` (the engine's one rule, `flightListFresh`), and not a failed list a
       * monthly or per-run limit stopped. The read button shows exactly when it is true; the status notes word what
       * happens next by it.
       */
      readNow: z.boolean(),
    }),
  ),
});
export type FlightListsResponse = z.infer<typeof flightListsResponseSchema>;

/** `POST /definitions/:id/flight-lists`: read one date pair's list now (spec rev 55 §8.1 "Reading one date pair's flights"). */
export const readFlightListRequestSchema = z.strictObject({
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
});
/** Its answer: the read was started (its outcome is read back through the GET). */
export const readFlightListResponseSchema = z.strictObject({ accepted: z.literal(true) });
