import { z } from 'zod';
import { BLOCKED_PAGES } from '../camoufox/protocol.js';
import { BUDGET_SCOPE_KINDS, type BudgetScopeKind, PROVIDER_ERROR_KINDS } from '../errors.js';
import { SKIP_CODES } from '../types/execution.js';
import { isoDateTimeSchema } from '../types/ids.js';
import type { NonEmpty } from '../types/nonEmpty.js';
import type { ProviderId } from '../types/provenance.js';
import { countSchema, moneyPenceSchema, providerIdSchema, stageSchema } from './common.js';

// Spec revision 55 §7 `search_executions.stop_cause_json` and §8.1 "Stop causes". The schema lives in api-contract
// because db parses stored JSON through api-contract schemas (as `estimate_json` is read), and `core/labels/stopCause.ts`
// words every cause it accepts.

const count = countSchema;

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

/**
 * The units a budget cause may carry for its scope and provider (spec §5.1 scopes; revision 55 §8.1): the spending
 * scopes count pence; the run's call scopes and a plan's lifetime count calls; a provider's own run and month caps count
 * the browser worker's pages or scrolls, and every other provider's calls. Writers and the schema read this one rule.
 */
export function budgetUnitsFor(scope: BudgetScopeKind, providerId: ProviderId | null): NonEmpty<BudgetUnit> {
  switch (scope) {
    case 'execution-cost':
    case 'global-month':
      return ['pence'];
    case 'execution-calls':
    case 'execution-free-calls':
    case 'provider-lifetime':
      return ['calls'];
    case 'provider-execution':
    case 'provider-month':
      return providerId === 'camoufox' ? ['pages', 'scrolls'] : ['calls'];
  }
}

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
 * A budget stop (spec revision 55 §8.1): the cap's scope, its provider (the guard's, on any scope, or null),
 * its unit (`budgetUnitsFor`), its limit, the scheduled resume, the cap window's end (`resetsAt`, kept even when no
 * resume is scheduled) and, when the flight-list step ran after the stop, its counts. `cap` is the limit in `unit`:
 * pence for the spending scopes (`execution-cost`, `global-month`), which the writer converts from the guard's µGBP
 * (ruling A2); calls, pages or scrolls otherwise. `flights` is set only on the browser worker's per-run page cap, the
 * one stop the flight-list step runs after (Review Focus 3).
 */
const budgetCauseSchema = z
  .strictObject({
    kind: z.literal('budget'),
    scope: z.enum(BUDGET_SCOPE_KINDS),
    providerId: providerIdSchema.nullable(),
    unit: z.enum(BUDGET_UNITS),
    cap: count,
    resumeAfter: isoDateTimeSchema.nullable(),
    resetsAt: isoDateTimeSchema.nullable(),
    flights: flightsReadSchema.nullable(),
  })
  .superRefine((c, ctx) => {
    if (!budgetUnitsFor(c.scope, c.providerId).includes(c.unit)) {
      ctx.addIssue({ code: 'custom', path: ['unit'], message: `${c.scope} does not count ${c.unit}` });
    }
    if (c.flights !== null && !(c.scope === 'provider-execution' && c.providerId === 'camoufox')) {
      ctx.addIssue({
        code: 'custom',
        path: ['flights'],
        message: "flights only follow the browser worker's per-run page cap",
      });
    }
  });

/**
 * Spec revision 55 §8.1 "Stop causes": why a run stopped or was skipped, stored by every status write that stops or skips
 * one (§7 `stop_cause_json`) and worded by `stopText`. `sources-unavailable.searched` is the date pairs searched before
 * the stop (`datePairSearched`, §6.6); its `sources` is a non-empty tuple where §5 writes `z.array(…).min(1)` (the same
 * values, typed so a reader's first source needs no assertion; writers build it with `nonEmpty`). Every object is
 * strict: a stored cause with an unknown key is refused, so free text cannot ride along.
 */
export const stopCauseSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('sources-unavailable'),
    stage: stageSchema,
    searched: count,
    // why: a non-empty tuple, so the type itself says there is a first source (its fix is the sentence's fix)
    sources: z.tuple([unavailableSourceSchema], unavailableSourceSchema),
  }),
  budgetCauseSchema,
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
  // why: R3 — a tool run (smoke, record) that ended early stores a cause too, so NULL means only "written before 0011"
  z.strictObject({ kind: z.literal('tool'), ended: z.enum(['failed', 'aborted']) }),
  z.strictObject({
    kind: z.literal('skipped-confirm'),
    estimatePence: moneyPenceSchema,
    confirmedPence: moneyPenceSchema.nullable(),
  }),
  // why: the provider is the guard's (`BudgetExceeded.providerId`), on any scope: a run or month cap may name the
  // provider whose reserve tripped it (controller ruling on Task 20.1)
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
      /** Present (true) only when the run can be resumed: only then does a Resume button belong with the sentence (never matched on words). */
      resume: z.literal(true).optional(),
    })
    .nullable(),
});
export type StopText = z.infer<typeof stopTextSchema>;
