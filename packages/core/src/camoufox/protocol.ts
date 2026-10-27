/**
 * The camoufox worker's wire contract (spec §2, §5.2 rev 32; brief WP14 §5 and §6): pure zod, the one copy both the
 * host-side worker (`apps/camoufox-worker`) and the app's adapter (`@gmt/providers` camoufox) parse with (arch-011).
 * The worker serves `POST /v1/page` and `GET /v1/status`; every answer carries GOOGLE_CONTACTED_HEADER.
 */
import { z } from 'zod';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';
import { vendorPriceMarkSchema } from '../types/provenance.js';
import { OS_ARCHES } from './builds.js';
import { GRID_MAX_SCROLLS_PER_PAGE } from './grid.js';
import { sharedSettingsSchema } from './settings.js';

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

/**
 * The rule that stopped a page (spec §2 "Navigation and the stops"): the classifier's rule (`cheapest-tab-count`), a
 * check's (`search-form:mismatch`, `currency`) or a grid step's (`grid:first-view:price`). A bounded token of lower-case
 * words joined by `:`, so it can never carry page text, a name or a URL; the app shows it in `last_error`.
 */
export const workerRuleSchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)*$/);

// why: names from the airports dataset; bounded so a body stays well under the worker's 4 KiB limit.
// why: fix round 1 (prov M2): at least one name, or no option could ever match and every page would read as unrecognised
const airportNameList = z.array(z.string().min(1).max(120)).min(1).max(8);

/** One list page request: one cell, never a range. `gl` is POINT_OF_SALE. */
export const listRequestSchema = z
  .strictObject({
    mode: z.literal('list'),
    origin: iataSchema,
    destination: iataSchema,
    departureDate: isoDateSchema,
    returnDate: isoDateSchema,
    gl: z.string().regex(/^[A-Z]{2}$/),
    airportNames: z.strictObject({ origin: airportNameList, destination: airportNameList }),
  })
  .refine((r) => r.returnDate > r.departureDate, {
    message: 'a page request is one cell: the return date must follow the departure date',
    path: ['returnDate'],
  })
  .refine((r) => r.origin !== r.destination, {
    message: 'origin and destination must differ',
    path: ['destination'],
  });
export type ListRequest = z.infer<typeof listRequestSchema>;

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
/** How a grid page ended: every move made, a scroll that did not settle, an off-plan view, the allowance, no flights. */
export const GRID_ENDS = ['complete', 'scroll-not-settled', 'off-plan', 'allowance', 'no-flights'] as const;

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
  z.strictObject({
    kind: z.literal('grid'),
    fetchedAt: isoDateTimeSchema,
    currency: z.literal('GBP'),
    pointOfSale: z.string().regex(/^([A-Z]{2}|unknown)$/),
    views: z.array(gridViewSchema),
    scrolls: count,
    ended: z.enum(GRID_ENDS),
    notes: z.array(z.string()),
    versions: versionsSchema,
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
  }),
  z.strictObject({
    kind: z.literal('cooling-down'),
    cause: blockedPageSchema,
    cooldownUntil: isoDateTimeSchema,
  }),
  z.strictObject({ kind: z.literal('spacing'), retryAfterSeconds: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal('mode-unavailable'), mode: z.literal('grid') }),
  z.strictObject({ kind: z.literal('not-ready'), elapsedMs: count, scrolls: count.exactOptional() }),
  z.strictObject({
    kind: z.literal('browser-error'),
    stage: z.enum(['launch', 'navigate', 'read']),
    detail: z.string().max(500),
    scrolls: count.exactOptional(),
  }),
  // why: decision 82: the worker's own monthly page cap, for every caller together over the ledger's billing month;
  // nothing was loaded, and the adapter maps it to BudgetExceeded at provider-month with the worker's own figures
  z.strictObject({ kind: z.literal('monthly-cap'), cap: count, used: count, windowEnd: isoDateTimeSchema }),
  // why: W3: the counts file is missing or unreadable, so no page is admitted; it is not a cap reached, and waiting
  // does not repair it (`pnpm gmt browser counts` does)
  z.strictObject({ kind: z.literal('counts-unreadable'), problem: z.enum(['missing', 'unreadable']) }),
]);
export type WorkerAnswer = z.infer<typeof workerAnswerSchema>;

/** The HTTP status of each answer kind (brief §6), the one table the worker serves and the adapter reads. */
export const ANSWER_STATUS: Readonly<Record<WorkerAnswer['kind'], number>> = {
  cells: 200,
  grid: 200,
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
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
