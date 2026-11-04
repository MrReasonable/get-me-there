/**
 * The camoufox worker's wire contract (spec §2, §5.2 rev 32; brief WP14 §5 and §6): pure zod, the one copy both the
 * host-side worker (`apps/camoufox-worker`) and the app's adapter (`@gmt/providers` camoufox) parse with (arch-011).
 * The worker serves `POST /v1/page`, `POST /v1/flights` (spec revision 55 §2 "The flight-list read": a list page's
 * flights, mode `flights` only), `POST /v1/awake` (the keep-awake lease) and `GET /v1/status`; every answer carries
 * GOOGLE_CONTACTED_HEADER.
 */
import { z } from 'zod';
import { flightLimitsSchema } from '../flights/choose.js';
import { FLIGHT_LIST_MAX_FLIGHTS } from '../flights/limits.js';
import { returnReadSchema, returnsOutboundIssue } from '../flights/returns.js';
import { LISTED, listedFlightSchema } from '../flights/types.js';
import { MAX_AIRPORTS_A_SIDE } from '../types/definition.js';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { vendorPriceMarkSchema } from '../types/provenance.js';
import { OS_ARCHES } from './builds.js';
import { GRID_MAX_SCROLLS_PER_PAGE } from './grid.js';
import { workerRuleSchema } from './rule.js';
import { sharedSettingsSchema } from './settings.js';

// why: the rule's one home is the leaf rule.ts (spec rev 56: returns.ts and the stored plan name it too); the
// protocol's importers keep reading it from here
export { workerRuleSchema } from './rule.js';

/** On every worker answer: `1` when the worker loaded a Google page for it, `0` when it did not (decision 69). */
export const GOOGLE_CONTACTED_HEADER = 'x-gmt-google-contacted';
/** The request header that carries CAMOUFOX_WORKER_KEY (spec §2); a credential header everywhere it is handled. */
export const WORKER_KEY_HEADER = 'x-gmt-worker-key';

/** The camoufox-js version the worker is pinned to and the smoke checks (spec §2; one copy, fix round 1 arch M11). */
export const CAMOUFOX_JS_VERSION = '0.11.5';

/**
 * The clock difference tolerated between the app (perhaps in a container) and the host worker, each way: the adapter's
 * fetchedAt window and the smoke's freshness row read this one value (fix rounds 1 and 2).
 */
export const CAMOUFOX_CLOCK_SKEW_MS = 5000;

/** The seven page kinds the worker stops on (brief §9), in the classifier's order. */
export const BLOCKED_PAGES = [
  'captcha',
  'unusual-traffic',
  'signed-in',
  'consent-unhandled',
  'sign-in',
  'off-allowlist',
  'unrecognised',
] as const;
export const blockedPageSchema = z.enum(BLOCKED_PAGES);
export type BlockedPage = z.infer<typeof blockedPageSchema>;

// why: names from the airports dataset (one a code); bounded so a body stays well under the worker's 8 KiB limit.
// why: fix round 1 (prov M2): at least one name, or no option could ever match and every page would read as unrecognised
const airportNameList = z.array(z.string().min(1).max(120)).min(1).max(2);
// why: spec §2 "Airport names": the search's other chosen airports on one side, every chosen airport but the cell's
const otherAirportNames = z.array(airportNameList).max(MAX_AIRPORTS_A_SIDE - 1);

/**
 * The one cell a list or flights page loads (spec revision 55 §2: one shared field shape and one shared refinement pair
 * build both requests, so the two can never drift apart). `gl` is POINT_OF_SALE.
 */
const cellPageFields = {
  origin: iataSchema,
  destination: iataSchema,
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
  gl: z.string().regex(/^[A-Z]{2}$/),
  airportNames: z.strictObject({
    origin: airportNameList,
    destination: airportNameList,
    otherOrigins: otherAirportNames,
    otherDestinations: otherAirportNames,
  }),
};
type CellPage = { origin: string; destination: string; departureDate: string; returnDate: string };
/** The two refinements every cell page request carries: one cell (the return follows the departure), two airports. */
function oneCell<T extends z.ZodType<CellPage>>(schema: T) {
  return schema
    .refine((r) => r.returnDate > r.departureDate, {
      message: 'a page request is one cell: the return date must follow the departure date',
      path: ['returnDate'],
    })
    .refine((r) => r.origin !== r.destination, {
      message: 'origin and destination must differ',
      path: ['destination'],
    });
}

/** One list page request: one cell, never a range. `gl` is POINT_OF_SALE. */
export const listRequestSchema = oneCell(z.strictObject({ mode: z.literal('list'), ...cellPageFields }));
export type ListRequest = z.infer<typeof listRequestSchema>;

/**
 * Spec revision 55 §2 "The flight-list read": the same list page as a `list` request, read for its flights; served only
 * by `POST /v1/flights`, which admits nothing else (and `POST /v1/page` refuses it: `pageRequestSchema` is unchanged).
 * Revision 56 "The return phase": `returnLimits` (the search's limits, `flightLimitsOf`) asks for the return phase
 * (absent: none, and no `returns` on the answer; a `/v1/page` request carrying it is refused, its list schema being
 * strict), and `booking` (true: read the shown pairing's booking options; absent read as false; refused without
 * `returnLimits`).
 */
export const flightsRequestSchema = oneCell(
  z.strictObject({
    mode: z.literal('flights'),
    ...cellPageFields,
    returnLimits: flightLimitsSchema.exactOptional(),
    booking: z.boolean().exactOptional(),
  }),
).refine((r) => r.booking === undefined || r.returnLimits !== undefined, {
  message: 'booking is asked only with returnLimits',
  path: ['booking'],
});
export type FlightsRequest = z.infer<typeof flightsRequestSchema>;

/** The grid's four scroll directions (spec §2 rev 34): left and right move the departures, up and down the returns. */
export const GRID_MOVES = ['left', 'right', 'up', 'down'] as const;
export const gridMoveSchema = z.enum(GRID_MOVES);
export type GridMove = z.infer<typeof gridMoveSchema>;

/**
 * One grid page request (spec §2 rev 34; WP15 §5): the first block's centre as the page's query, the moves, which views
 * are read (`reads[0]` the first view, `reads[i + 1]` the view after `moves[i]`), and how many scrolls the run's and
 * the month's scroll caps leave (the worker never scrolls past it).
 */
export const gridRequestSchema = z
  .strictObject({
    mode: z.literal('grid'),
    origin: iataSchema,
    destination: iataSchema,
    gl: z.string().regex(/^[A-Z]{2}$/),
    start: z.strictObject({ departureDate: isoDateSchema, returnDate: isoDateSchema }),
    moves: z.array(gridMoveSchema).max(GRID_MAX_SCROLLS_PER_PAGE),
    reads: z.array(z.boolean()),
    scrollAllowance: z.number().int().min(0),
  })
  .refine((r) => r.reads.length === r.moves.length + 1, {
    message: 'reads names the first view and each move',
    path: ['reads'],
  })
  .refine((r) => r.scrollAllowance <= r.moves.length, {
    message: 'the allowance is at most the moves',
    path: ['scrollAllowance'],
  })
  .refine((r) => r.start.returnDate > r.start.departureDate, {
    message: 'the first block centre is a round trip',
    path: ['start'],
  })
  .refine((r) => r.origin !== r.destination, {
    message: 'origin and destination must differ',
    path: ['destination'],
  });
export type GridRequest = z.infer<typeof gridRequestSchema>;

/** Either page request; the worker answers a grid one `mode-unavailable` until its grid flag and step are set. */
export const pageRequestSchema = z.union([listRequestSchema, gridRequestSchema]);
export type PageRequest = z.infer<typeof pageRequestSchema>;

const count = z.number().int().min(0);
/** The versions that read a page: the dated selectors and grammar, the pinned library and binary. */
export const versionsSchema = z.strictObject({
  selectors: z.string().min(1),
  grammar: z.string().min(1),
  camoufoxJs: z.string().min(1),
  binary: z.string().min(1),
  /** The grid's cell grammar date, on grid answers (PIE-15). */
  gridGrammar: z.string().min(1).exactOptional(),
  /** Spec rev 56: the offer grammar's date, on a flights answer with a booking read (return names use the one grammar). */
  offerGrammar: z.string().min(1).exactOptional(),
});
export type Versions = z.infer<typeof versionsSchema>;

/**
 * One list-mode cell: the cheapest parsed option for exactly this cell, the Cheapest tab's price, and the options the
 * worker could not read or that belong to another cell (spec §2). `no-flights` is Google's own line, once recorded.
 */
export const pageCellSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('price'),
    amountMinor: z.number().int().min(1),
    tabMinor: z.number().int().min(1).nullable(),
    optionsUnparsed: count,
    optionsOtherCell: count,
    returnDateFrom: z.literal('query-and-form'),
  }),
  z.strictObject({ status: z.literal('no-flights') }),
  // why: fix round 1 (prov I1): the page was read, but every option was for another day or airport (or unreadable):
  // a cell issue for the engine, never a block and never `no_data`
  z
    .strictObject({ status: z.literal('none-for-cell'), optionsOtherCell: count, optionsUnparsed: count })
    .refine((c) => c.optionsOtherCell > 0, {
      message: 'none-for-cell names at least one option for another cell',
      path: ['optionsOtherCell'],
    }),
]);
export type PageCell = z.infer<typeof pageCellSchema>;

const returnsOnOrAfter = {
  message: 'a cell returns on or after it departs',
  path: ['returnDate'],
};
const onOrAfter = (c: { departureDate: string; returnDate: string }): boolean =>
  c.returnDate >= c.departureDate;
/**
 * One read grid cell (spec §2, "Cells by name"), both dates from the cell's own name (a same-day pair is shown):
 * - `price`: the price in pence (the grid states whole pounds) and Google's mark relative to that view;
 * - `no-flights`: the cell's own words say there are no flights for this pair ("no flights, 14 Nov to 20 Nov");
 * - `price-unknown`: the cell shows no price and says nothing of flights ("price unknown, 10 Nov to 24 Nov").
 * The two unpriced forms are read only where a recording proved them (GRID_UNPRICED_VERIFIED, the grid recordings of
 * 2026-10-26); elsewhere the worker counts them unparsed, as any name it does not read.
 */
export const gridCellSchema = z.discriminatedUnion('status', [
  z
    .strictObject({
      status: z.literal('price'),
      departureDate: isoDateSchema,
      returnDate: isoDateSchema,
      amountMinor: z.number().int().min(1),
      mark: vendorPriceMarkSchema,
    })
    .refine(onOrAfter, returnsOnOrAfter),
  z
    .strictObject({
      status: z.enum(['no-flights', 'price-unknown']),
      departureDate: isoDateSchema,
      returnDate: isoDateSchema,
    })
    .refine(onOrAfter, returnsOnOrAfter),
]);
export type GridCell = z.infer<typeof gridCellSchema>;
/** One settled, read view of the grid. `structural: 'unparsed'`: nothing from it is stored (duplicates, a set mismatch). */
export const gridViewSchema = z.strictObject({
  index: count,
  departures: z.array(isoDateSchema).max(7),
  returns: z.array(isoDateSchema).max(7),
  cells: z.array(gridCellSchema).max(49),
  unparsed: count,
  structural: z.enum(['ok', 'unparsed']),
  offPlan: z.enum(['near-today', 'sale-window-end', 'shifted', 'short-move']).nullable(),
});
export type GridView = z.infer<typeof gridViewSchema>;
/**
 * How a grid page ended: every move made, a scroll that did not settle, an off-plan view, the allowance, no flights, or
 * a first view whose prices had not arrived when its time ran out (`first-not-drawn`, Ian's ruling of 2026-11-03: no
 * view read, and the worker stops on a second such page in a row).
 */
export const GRID_ENDS = [
  'complete',
  'scroll-not-settled',
  'off-plan',
  'allowance',
  'no-flights',
  'first-not-drawn',
] as const;

/**
 * Spec rev 56 §2 (R-zero, R-spacing): on every answer kind that may answer a flights request carrying `returnLimits`:
 * `pagesLoaded`, the documents that request loaded (0 when the first load was refused or the browser failed first;
 * stated on a verified entry, absent otherwise: a list or grid page, or an older worker, whose ledger counts the page
 * class as before), and `nextLoadNotBefore`, the worker's last document load's start plus the spacing, stated once the
 * phase started the reload (its start recorded, whether or not that document then loaded).
 */
const pageCounts = {
  pagesLoaded: count.exactOptional(),
  nextLoadNotBefore: isoDateTimeSchema.exactOptional(),
};

/** Every answer of `POST /v1/page`, discriminated on `kind`; the status codes are brief §6's table. */
export const workerAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cells'),
    fetchedAt: isoDateTimeSchema,
    currency: z.literal('GBP'),
    pointOfSale: z.string().regex(/^([A-Z]{2}|unknown)$/),
    cell: pageCellSchema,
    notes: z.array(z.string()),
    versions: versionsSchema,
  }),
  z
    .strictObject({
      kind: z.literal('grid'),
      fetchedAt: isoDateTimeSchema,
      currency: z.literal('GBP'),
      pointOfSale: z.string().regex(/^([A-Z]{2}|unknown)$/),
      views: z.array(gridViewSchema),
      scrolls: count,
      ended: z.enum(GRID_ENDS),
      notes: z.array(z.string()),
      versions: versionsSchema,
    })
    // why: CodeRabbit on PR #39: a grid whose prices never arrived read no view, so its answer carries none to price from
    .refine((a) => a.ended !== 'first-not-drawn' || a.views.length === 0, {
      message: 'a page whose first view never drew a price reads no view',
      path: ['views'],
    }),
  /**
   * Spec revision 55 §2 "The flight-list read": what a flights page listed for the cell: `listed` (LISTED), the 30
   * cheapest of the cell's flights in page order, and, as the list read keeps them, the minimum over every parsed option
   * of the cell, the Cheapest tab's price, which view was read (`cheapest`: the Cheapest view; `best-fallback`: the Best
   * view after the Cheapest flow failed; null: no Cheapest flow ran) and the options unparsed, for another cell and
   * stated by the page. At the schema's limits the answer stays under about 25 KB.
   */
  z
    .strictObject({
      kind: z.literal('flights'),
      fetchedAt: isoDateTimeSchema,
      currency: z.literal('GBP'),
      pointOfSale: z.string().regex(/^([A-Z]{2}|unknown)$/),
      listed: z.enum(LISTED),
      flights: z.array(listedFlightSchema).max(FLIGHT_LIST_MAX_FLIGHTS),
      minMinor: z.number().int().min(1).nullable(),
      tabMinor: z.number().int().min(1).nullable(),
      cheapestView: z.enum(['cheapest', 'best-fallback']).nullable(),
      optionsUnparsed: count,
      optionsOtherCell: count,
      resultsStated: count.nullable(),
      notes: z.array(z.string()),
      versions: versionsSchema,
      ...pageCounts,
      /** Spec rev 56: the return read, present exactly on an answer to a request that carried `returnLimits`. */
      returns: returnReadSchema.exactOptional(),
    })
    .superRefine((a, ctx) => {
      // why: `flights` means at least one flight was read; the other two outcomes carry none (spec rev 55 §7 LISTED)
      if ((a.listed === 'flights') !== a.flights.length > 0)
        ctx.addIssue({
          code: 'custom',
          path: ['flights'],
          message: "listed 'flights' exactly when a flight was read",
        });
      // why: spec rev 56 §5.1: every attempt's outbound is one of the answer's flights (the provider maps a breach to
      // list-error parse unknown-answer); the booking's indices are returnReadSchema's
      const breach = a.returns === undefined ? null : returnsOutboundIssue(a.returns, a.flights.length);
      if (breach !== null)
        ctx.addIssue({
          code: 'custom',
          path: ['returns', 'attempts', breach, 'outboundIndex'],
          message: "an attempt's outbound is one of the answer's flights",
        });
    }),
  // why: CB-4: an answer to a grid request that reached Google carries the scroll clicks it made
  z.strictObject({
    kind: z.literal('blocked'),
    page: blockedPageSchema,
    cooldownUntil: isoDateTimeSchema,
    scrolls: count.exactOptional(),
    // why: the grid runs of 2026-10-26 stopped as unrecognised with nothing to say why; optional, so an app reads a
    // worker built before it
    rule: workerRuleSchema.exactOptional(),
    ...pageCounts,
  }),
  z.strictObject({
    kind: z.literal('cooling-down'),
    cause: blockedPageSchema,
    cooldownUntil: isoDateTimeSchema,
    ...pageCounts,
  }),
  z.strictObject({ kind: z.literal('spacing'), retryAfterSeconds: z.number().int().min(1), ...pageCounts }),
  z.strictObject({ kind: z.literal('mode-unavailable'), mode: z.literal('grid') }),
  z.strictObject({
    kind: z.literal('not-ready'),
    elapsedMs: count,
    scrolls: count.exactOptional(),
    ...pageCounts,
  }),
  z.strictObject({
    kind: z.literal('browser-error'),
    stage: z.enum(['launch', 'navigate', 'read']),
    detail: z.string().max(500),
    scrolls: count.exactOptional(),
    ...pageCounts,
  }),
  // why: decision 82: the worker's own monthly page cap, for every caller together over the ledger's billing month;
  // nothing was loaded, and the adapter maps it to BudgetExceeded at provider-month with the worker's own figures
  z.strictObject({
    kind: z.literal('monthly-cap'),
    cap: count,
    used: count,
    windowEnd: isoDateTimeSchema,
    ...pageCounts,
  }),
  // why: W3: the counts file is missing or unreadable, so no page is admitted; it is not a cap reached, and waiting
  // does not repair it (`pnpm gmt browser counts` does)
  z.strictObject({
    kind: z.literal('counts-unreadable'),
    problem: z.enum(['missing', 'unreadable']),
    ...pageCounts,
  }),
]);
export type WorkerAnswer = z.infer<typeof workerAnswerSchema>;

/** The HTTP status of each answer kind (brief §6), the one table the worker serves and the adapter reads. */
export const ANSWER_STATUS: Readonly<Record<WorkerAnswer['kind'], number>> = {
  cells: 200,
  grid: 200,
  flights: 200,
  blocked: 423,
  'cooling-down': 423,
  spacing: 429,
  'mode-unavailable': 409,
  'not-ready': 504,
  'browser-error': 502,
  'monthly-cap': 429,
  'counts-unreadable': 503,
};

/**
 * Spec §2 "The keep-awake lease": `POST /v1/awake` asks the worker to hold the machine's idle sleep off for `seconds`
 * from now, replacing any lease it holds; `seconds: 0` releases it. The worker holds it only while the lease is live,
 * so an app that dies or is suspended stops renewing and the machine may sleep again once the lease runs out.
 */
export const AWAKE_ENDPOINT_PATH = '/v1/awake';
/** The longest lease one request may ask for (10 minutes), so no hold outlives a silent app by long. */
export const AWAKE_MAX_SECONDS = 600;
/** The lease the engine asks for: five minutes, which outlasts four missed renewals. */
export const AWAKE_LEASE_SECONDS = 300;
/** How often the engine renews the lease while a run is in progress. */
export const AWAKE_RENEW_SECONDS = 60;
/** What holds it: macOS's `caffeinate -i -s`, Linux's `systemd-inhibit`, or nothing on this machine. */
export const AWAKE_MECHANISMS = ['caffeinate', 'systemd-inhibit', 'none'] as const;
export type AwakeMechanism = (typeof AWAKE_MECHANISMS)[number];

export const awakeRequestSchema = z.strictObject({
  seconds: z.number().int().min(0).max(AWAKE_MAX_SECONDS),
});
export type AwakeRequest = z.infer<typeof awakeRequestSchema>;

/** The worker's answer, and its status's `awake`: `until` is the lease's end while a hold is held, else null. */
export const awakeAnswerSchema = z
  .strictObject({
    held: z.boolean(),
    until: isoDateTimeSchema.nullable(),
    mechanism: z.enum(AWAKE_MECHANISMS),
  })
  .refine((a) => a.held === (a.until !== null), {
    message: 'a held lease states its end, and only a held one',
    path: ['until'],
  });
export type AwakeAnswer = z.infer<typeof awakeAnswerSchema>;

/**
 * Decision 82: the header the adapter sends on every request (the database's app-instance id, a random id stored with
 * the ledger), so the worker can report a second app, a second ledger, in a month.
 */
export const APP_INSTANCE_HEADER = 'x-gmt-app-instance';

/**
 * `GET /v1/status`: live values only (SEC-R2-004, TS2-17). `accountCookie` is the account-cookie check run on this
 * request (a cookie read, no page load); `flags` are the selectors module's verification flags. The optional fields
 * below enter the schema one work package before any worker emits them (decision 76): this package's worker fills
 * `sharedSettings`; WP17's fills the rest. An app never infers anything from one that is absent.
 */
export const workerStatusSchema = z.strictObject({
  ok: z.boolean(),
  coolingDownUntil: isoDateTimeSchema.nullable(),
  cooldownCause: blockedPageSchema.nullable(),
  signedInRefusal: z.boolean(),
  lastPageAt: isoDateTimeSchema.nullable(),
  busySince: isoDateTimeSchema.nullable(),
  versions: versionsSchema,
  flags: z.record(z.string(), z.boolean()),
  accountCookie: z.strictObject({
    found: z.boolean(),
    names: z.array(z.string()),
    checkedAt: isoDateTimeSchema,
  }),
  socsCapturedAt: isoDateTimeSchema.nullable(),
  socsStable: z.boolean(),
  cooldownHours: z.number().int().min(24),
  pageTimeoutSeconds: z.number().int().min(30).max(240),
  /** The measured grid step the worker uses (spec §2 rev 34), or null when grid mode is not verified. */
  gridStepDays: z
    .strictObject({ departures: z.number().int().min(1), returns: z.number().int().min(1) })
    .nullable()
    .exactOptional(),
  /** The worker's own CAMOUFOX_GRID_SCROLL_CAP and spacing (fix round 1, CA 9), which the app's must equal in grid mode. */
  gridScrollCap: z.number().int().min(0).nullable().exactOptional(),
  gridScrollSpacingSeconds: z.number().int().min(0).nullable().exactOptional(),
  /** Spec §12: the worker's effective shared settings, every name present. */
  sharedSettings: sharedSettingsSchema.exactOptional(),
  osArch: z.enum(OS_ARCHES).exactOptional(),
  build: z.string().exactOptional(),
  /**
   * The captured consent record: its expiry, what bounds it, and (review X1) the mark its value carries, which a worker
   * of an earlier version does not report. A record in an older shape is never served (the start refuses it).
   */
  consent: z
    .strictObject({
      kind: z.literal('socs'),
      expiresAt: isoDateTimeSchema,
      boundedBy: z.enum(['cookie', 'capture']),
      mark: z.enum(['reject', 'accept', 'unknown']).exactOptional(),
    })
    .exactOptional(),
  /** Decision 82: the worker's own count over the billing month; `readable` false when its counts file refused. */
  monthly: z
    .strictObject({
      windowStart: isoDateTimeSchema,
      windowEnd: isoDateTimeSchema,
      pages: z.number().int().min(0),
      scrolls: z.number().int().min(0),
      readable: z.boolean(),
    })
    .exactOptional(),
  /** Decision 82: how many app instances spoke to it this month (a second one is reported, never refused). */
  appInstances: z
    .strictObject({ windowStart: isoDateTimeSchema, count: z.number().int().min(0) })
    .exactOptional(),
  /** Spec §2 "The keep-awake lease": whether the worker is holding the machine awake now, until when, and by what. */
  awake: awakeAnswerSchema.exactOptional(),
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
