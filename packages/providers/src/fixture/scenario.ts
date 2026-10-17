import { z } from 'zod';
import { zodReason } from '../util.js';
import { FIXTURE_ORIGIN, RELEASE_PATH, SCENARIO_PATH } from './constants.js';

// Scenario control for the fixture server (brief "Fixture tree and request routing"): the rule and response
// types, their validators, and the two control requests WP7 sends. The routing core is server.ts.

const RESPONSE_HEADERS: readonly string[] = ['retry-after', 'content-type'];
const CODE3 = /^[A-Z]{3}$/;

/** Header names lower-cased, then only `retry-after` and `content-type` admitted (sec-012). */
const responseHeadersSchema = z
  .record(z.string(), z.string())
  .transform((h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])))
  .refine((h) => Object.keys(h).every((k) => RESPONSE_HEADERS.includes(k)), {
    message: 'only retry-after and content-type headers are allowed',
  });

/** How the fixture server answers one request (po-004). Documented in the brief's §8.1 mapping table. */
export const fixtureResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('normal') }),
  z.object({
    kind: z.literal('status'),
    status: z.number().int().min(200).max(599),
    body: z.unknown().optional(),
    headers: responseHeadersSchema.optional(),
  }),
  z.object({ kind: z.literal('malformed') }),
  z.object({ kind: z.literal('network') }),
  z.object({ kind: z.literal('hang') }),
  z.object({ kind: z.literal('hold'), id: z.string().min(1) }),
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('no-fares') }),
  z.object({ kind: z.literal('no-currency') }),
  z.object({ kind: z.literal('no-return-legs') }),
  z.object({ kind: z.literal('partial'), failedExpansions: z.number().int().min(0) }),
  z.object({
    kind: z.literal('variant'),
    currency: z.string().regex(CODE3).optional(),
    carrier: z.string().min(1).max(3).optional(),
    connectVia: z.string().regex(CODE3).optional(),
    scope: z.enum(['first-offer', 'all-offers']).optional(),
  }),
  z.object({ kind: z.literal('cacheable') }),
]);
export type FixtureResponse = z.output<typeof fixtureResponseSchema>;

export const FIXTURE_PATHS = [
  '/calendar',
  '/itinerary',
  '/itinerary/return',
  '/itinerary/booking',
  '/health',
] as const;

/** First matching rule with `times` left answers the request. `params` match query values exactly. */
const fixtureRuleSchema = z.object({
  match: z.object({
    path: z.enum(FIXTURE_PATHS).optional(),
    params: z.record(z.string(), z.string()).optional(),
  }),
  respond: fixtureResponseSchema,
  times: z.number().int().min(1).optional(),
});
export type FixtureRule = z.output<typeof fixtureRuleSchema>;
const scenarioBodySchema = z.object({ rules: z.array(fixtureRuleSchema) });

/** Validates one FixtureResponse; a string is the reason it is refused (po-004, sec-012). */
export function parseFixtureResponse(v: unknown): FixtureResponse | string {
  const r = fixtureResponseSchema.safeParse(v);
  return r.success ? r.data : zodReason(r.error);
}

/** Validates a scenario body `{ rules }`; a string is the reason it is refused. */
export function parseFixtureRules(v: unknown): FixtureRule[] | string {
  const r = scenarioBodySchema.safeParse(v);
  return r.success ? r.data.rules : zodReason(r.error);
}

const releaseBodySchema = z.object({ id: z.string().min(1), respond: fixtureResponseSchema.optional() });

/** Validates a release body `{ id, respond? }`; `respond` defaults to the normal response. */
export function parseReleaseBody(v: unknown): { id: string; respond: FixtureResponse } | string {
  const r = releaseBodySchema.safeParse(v);
  return r.success ? { id: r.data.id, respond: r.data.respond ?? { kind: 'normal' } } : zodReason(r.error);
}

/** The scenario-control request (WP7, WP13): send with `fetch(...)` under msw or `router.fetch(...)` in process. */
export function scenarioRequest(rules: FixtureRule[]): Request {
  return new Request(`${FIXTURE_ORIGIN}${SCENARIO_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
}

/** Releases every request held under `id`, answering it with `respond` (default the normal response). */
export function releaseRequest(id: string, respond?: FixtureResponse): Request {
  return new Request(`${FIXTURE_ORIGIN}${RELEASE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, ...(respond ? { respond } : {}) }),
  });
}
