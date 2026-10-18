/**
 * The camoufox worker's wire contract (spec §2, §5.2 rev 32; brief WP14 §5 and §6): pure zod, the one copy both the
 * host-side worker (`apps/camoufox-worker`) and the app's adapter (`@gmt/providers` camoufox) parse with (arch-011).
 * The worker serves `POST /v1/page` and `GET /v1/status`; every answer carries GOOGLE_CONTACTED_HEADER.
 */
import { z } from 'zod';
import { iataSchema, isoDateSchema, isoDateTimeSchema } from '../types/ids.js';

/** On every worker answer: `1` when the worker loaded a Google page for it, `0` when it did not (decision 69). */
export const GOOGLE_CONTACTED_HEADER = 'x-gmt-google-contacted';
/** The request header that carries CAMOUFOX_WORKER_KEY (spec §2); a credential header everywhere it is handled. */
export const WORKER_KEY_HEADER = 'x-gmt-worker-key';

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

// why: names from the airports dataset; bounded so a body stays well under the worker's 4 KiB limit.
const airportNameList = z.array(z.string().min(1).max(120)).max(8);

/**
 * One page request: one cell (`mode: 'list'`), never a range. `gl` is POINT_OF_SALE. `grid` parses so the worker
 * can answer `mode-unavailable` (409) rather than `bad-request`; nothing in this work package sends it.
 */
export const pageRequestSchema = z
  .strictObject({
    mode: z.enum(['list', 'grid']),
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
export type PageRequest = z.infer<typeof pageRequestSchema>;

const count = z.number().int().min(0);
/** The versions that read a page: the dated selectors and grammar, the pinned library and binary. */
export const versionsSchema = z.strictObject({
  selectors: z.string().min(1),
  grammar: z.string().min(1),
  camoufoxJs: z.string().min(1),
  binary: z.string().min(1),
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
]);
export type PageCell = z.infer<typeof pageCellSchema>;

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
  z.strictObject({ kind: z.literal('blocked'), page: blockedPageSchema, cooldownUntil: isoDateTimeSchema }),
  z.strictObject({
    kind: z.literal('cooling-down'),
    cause: blockedPageSchema,
    cooldownUntil: isoDateTimeSchema,
  }),
  z.strictObject({ kind: z.literal('spacing'), retryAfterSeconds: z.number().int().min(1) }),
  z.strictObject({ kind: z.literal('mode-unavailable'), mode: z.literal('grid') }),
  z.strictObject({ kind: z.literal('not-ready'), elapsedMs: count }),
  z.strictObject({
    kind: z.literal('browser-error'),
    stage: z.enum(['launch', 'navigate', 'read']),
    detail: z.string().max(500),
  }),
]);
export type WorkerAnswer = z.infer<typeof workerAnswerSchema>;

/** The HTTP status of each answer kind (brief §6), the one table the worker serves and the adapter reads. */
export const ANSWER_STATUS: Readonly<Record<WorkerAnswer['kind'], number>> = {
  cells: 200,
  blocked: 423,
  'cooling-down': 423,
  spacing: 429,
  'mode-unavailable': 409,
  'not-ready': 504,
  'browser-error': 502,
};

/**
 * `GET /v1/status`: live values only (SEC-R2-004, TS2-17). `accountCookie` is the account-cookie check run on this
 * request (a cookie read, no page load); `flags` are the selectors module's verification flags.
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
});
export type WorkerStatus = z.infer<typeof workerStatusSchema>;
