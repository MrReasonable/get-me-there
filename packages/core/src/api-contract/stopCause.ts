import { z } from 'zod';
import { BLOCKED_PAGES } from '../camoufox/protocol.js';
import { BUDGET_SCOPE_KINDS, PROVIDER_ERROR_KINDS } from '../errors.js';
import { SKIP_CODES } from '../types/execution.js';
import { isoDateTimeSchema } from '../types/ids.js';
import { moneyPenceSchema, providerIdSchema, stageSchema } from './common.js';

// Spec revision 55 §7 `search_executions.stop_cause_json` and §8.1 "Stop causes". The schema lives in api-contract
// because db parses stored JSON through api-contract schemas (as `estimate_json` is read), and `core/labels/stopCause.ts`
// words every cause it accepts.

const count = z.number().int().min(0);

/**
 * Every detail or reason the app stores in a stop cause or a flight list is one of these words, never free text, so no
 * vendor or engine sentence can reach a cause (a preflight's vendor detail is stored as its class word only): the nine
 * `ProviderError` kinds (§5.1), the browser worker's blocked page kinds (§2), then the app's own words.
 */
export const STOP_DETAILS = [
  ...PROVIDER_ERROR_KINDS,
  ...BLOCKED_PAGES,
  'settings-differ',
  'grid-unverified',
  'counts-unreadable',
  'no-airport-names',
  'none-for-cell',
  'unparsed',
  'monthly-cap',
  'execution-cap',
  'free-call-cap',
  'outside-browser-window',
  'fatal',
  'aborted',
] as const;
export type StopDetail = (typeof STOP_DETAILS)[number];

/** What a budget cap counts, so its sentence can name it (pages and scrolls are the browser worker's). */
export const BUDGET_UNITS = ['calls', 'pages', 'scrolls', 'pence'] as const;
export type BudgetUnit = (typeof BUDGET_UNITS)[number];

/** One source a run could not use: how it was left out (§6.6 skip reasons), its detail word, and when a pause ends. */
const unavailableSourceSchema = z.strictObject({
  providerId: providerIdSchema,
  skip: z.enum(['provider_disabled', 'provider_unavailable']),
  detail: z.enum(STOP_DETAILS),
  until: isoDateTimeSchema.nullable(),
});

/** The flight-list step's counts, set on a budget cause when that step ran after the stop (§8.1). */
const flightsReadSchema = z.strictObject({ read: count, planned: count }).refine((f) => f.read <= f.planned, {
  message: 'flights read must not exceed flights planned',
  path: ['read'],
});

/**
 * Spec revision 55 §8.1 "Stop causes": why a run stopped or was skipped, stored by every status write that stops or skips
 * one (§7 `stop_cause_json`) and worded by `stopText`. `sources-unavailable.searched` is the date pairs searched before
 * the stop (`datePairSearched`, §6.6). A `budget` cause carries the cap's scope, provider, unit and limit (`cap`, in
 * `unit`: pence for a spending cap, converted from µGBP by its writer; ruling A2), the scheduled resume, the cap
 * window's end (`resetsAt`, kept even when no resume is scheduled) and, when the flight-list step ran after the stop,
 * its counts. Every object is strict: a stored cause with an unknown key is refused, so free text cannot ride along.
 */
export const stopCauseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sources-unavailable'),
    stage: stageSchema,
    searched: count,
    // why: a non-empty tuple, so the type itself says there is a first source (its fix is the sentence's fix)
    sources: z.tuple([unavailableSourceSchema], unavailableSourceSchema),
  }),
  z.strictObject({
    kind: z.literal('budget'),
    scope: z.enum(BUDGET_SCOPE_KINDS),
    providerId: providerIdSchema.nullable(),
    unit: z.enum(BUDGET_UNITS),
    cap: count,
    resumeAfter: isoDateTimeSchema.nullable(),
    resetsAt: isoDateTimeSchema.nullable(),
    flights: flightsReadSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('limiter-timeout'),
    providerId: providerIdSchema,
    resumeAfter: isoDateTimeSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('cancelled') }),
  // why: 'schedule' is a scheduled firing over a stopped run of the same search; 'search-again' a fresh start over one;
  // 'stale' the resume's supersede of a run too old to carry on; 'remove' the cancel a Remove makes.
  z.strictObject({
    kind: z.literal('superseded'),
    by: z.enum(['schedule', 'search-again', 'stale', 'remove']),
  }),
  z.strictObject({ kind: z.literal('never-started') }),
  z.strictObject({ kind: z.literal('interrupted') }),
  z.strictObject({ kind: z.literal('fatal') }),
  z.strictObject({ kind: z.literal('child-cap') }),
  z.strictObject({
    kind: z.literal('skipped-confirm'),
    estimatePence: moneyPenceSchema,
    confirmedPence: moneyPenceSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('skipped-budget'),
    scope: z.enum(BUDGET_SCOPE_KINDS),
    providerId: providerIdSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('skipped-window') }),
  z.strictObject({ kind: z.literal('skipped-missed'), code: z.enum(SKIP_CODES) }),
]);
export type StopCause = z.infer<typeof stopCauseSchema>;

/**
 * A stop cause in words (spec revision 55 §8.1, §10): one full sentence, which no caller prefixes, and one fix or none.
 * The fix's `command` is a `pnpm gmt …` line, given in native mode only.
 */
export const stopTextSchema = z.strictObject({
  sentence: z.string().max(400),
  fix: z
    .strictObject({
      text: z.string().max(200),
      command: z.string().startsWith('pnpm gmt ').max(200).nullable(),
    })
    .nullable(),
});
export type StopText = z.infer<typeof stopTextSchema>;
