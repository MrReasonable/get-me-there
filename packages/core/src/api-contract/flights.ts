/**
 * Spec revision 55 §10 (WP20 Task 20.7): the flight-list contract, read by `GET /definitions/:id/flight-lists` and
 * started by its POST (the routes and handlers arrive in Task 20.9). A list is the browser worker's record of one date
 * pair's list page (§2 "The flight-list read"; §7 `flight_lists`): never a price row, a verdict or a coverage bucket.
 */
import { z } from 'zod';
import { FLIGHT_LIST_MAX_FLIGHTS } from '../flights/limits.js';
import { LISTED, listedFlightSchema } from '../flights/types.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { pointOfSaleSchema } from '../types/provenance.js';
import { ageHoursSchema, countSchema } from './common.js';
import { STOP_DETAILS } from './stopCause.js';

/**
 * `?pairs=2027-03-14_2027-03-24,…`: the date pairs a page asks for, 1 to MAX_FLIGHT_LIST_PAIRS (50) of them, each
 * `departure_return`; the handler refuses any other count or form with 422 `invalid_pairs`. 50 pairs are 1,099
 * characters, so a string of 51 is refused here by its length.
 */
export const flightListsQuerySchema = z.strictObject({ pairs: z.string().max(1100) });

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
 * reason; `failed` lists carry one STOP_DETAILS word (`reason`, never null) and no outcome. `stale`: older than the
 * search's camoufox refresh. `flights` are the 30 cheapest of the pair's options in page order; `minMinor`, `tabMinor`
 * and `cheapestView` are the page's as the list read keeps them.
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
    stale: z.boolean(),
    provenance: flightListProvenanceSchema,
    status: z.enum(['read', 'failed']),
    reason: z.enum(STOP_DETAILS).nullable(),
    listed: z.enum(LISTED).nullable(),
    minMinor: countSchema.nullable(),
    tabMinor: countSchema.nullable(),
    cheapestView: z.enum(['cheapest', 'best-fallback']).nullable(),
    flights: z.array(listedFlightSchema).max(FLIGHT_LIST_MAX_FLIGHTS),
    optionsUnparsed: countSchema,
    optionsOtherCell: countSchema,
    resultsStated: countSchema.nullable(),
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
  });
export type FlightList = z.infer<typeof flightListSchema>;

/** A date pair's search link (spec §6.9): https, on Google's host only (the camoufox link is the worker's page). */
const flightListLinkSchema = z.strictObject({
  url: z.string().url().startsWith('https://'),
  host: z.enum(['www.google.com']),
  label: z.string(),
});

/**
 * `GET /definitions/:id/flight-lists`'s answer (spec rev 55 §10): whether flight lists can be read here (and why not),
 * the search's camoufox refresh, the browser worker's month's pages left, the pair being read now, and per asked pair
 * its airports, its link, the newest list for the figure's airport pair (`list`, the only one that feeds the outcome
 * beside the price, the difference line and orderWithinTie) and else the newest list for another airport pair of the
 * current space (`listOtherPair`, shown only inside the flights block under its airport-pair label).
 */
export const flightListsResponseSchema = z.strictObject({
  available: z.boolean(),
  unavailableReason: z.enum(['not-named', 'not-configured', 'cabin']).nullable(),
  refreshHours: countSchema,
  monthlyPagesLeft: countSchema.nullable(),
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
