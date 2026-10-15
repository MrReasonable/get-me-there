import { isRecord } from '../util.js';
import { FIXTURE_ORIGIN, RELEASE_PATH, SCENARIO_PATH } from './constants.js';

// Scenario control for the fixture server (brief "Fixture tree and request routing"): the rule and response
// types, their validators, and the two control requests WP7 sends. The routing core is server.ts.

/** How the fixture server answers one request. Documented in the brief's §8.1 mapping table. */
export type FixtureResponse =
  | { kind: 'normal' }
  | { kind: 'status'; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: 'malformed' }
  | { kind: 'network' }
  | { kind: 'hang' }
  | { kind: 'hold'; id: string }
  | { kind: 'empty' }
  | { kind: 'no-fares' }
  | { kind: 'no-currency' }
  | { kind: 'no-return-legs' }
  | { kind: 'partial'; failedExpansions: number }
  | {
      kind: 'variant';
      currency?: string;
      carrier?: string;
      connectVia?: string;
      scope?: 'first-offer' | 'all-offers';
    }
  | { kind: 'cacheable' };

export const FIXTURE_PATHS = [
  '/calendar',
  '/itinerary',
  '/itinerary/return',
  '/itinerary/booking',
  '/health',
] as const;
export type FixturePath = (typeof FIXTURE_PATHS)[number];

/** First matching rule with `times` left answers the request. `params` match query values exactly. */
export interface FixtureRule {
  match: { path?: FixturePath; params?: Record<string, string> };
  respond: FixtureResponse;
  times?: number;
}

const SIMPLE_KINDS = [
  'normal',
  'malformed',
  'network',
  'hang',
  'empty',
  'no-fares',
  'no-currency',
  'no-return-legs',
  'cacheable',
] as const;
const RESPONSE_HEADERS = ['retry-after', 'content-type'] as const;
const SCOPES = ['first-offer', 'all-offers'] as const;

/** Validates one FixtureResponse; a string is the reason it is refused (po-004, sec-012). */
export function parseFixtureResponse(v: unknown): FixtureResponse | string {
  if (!isRecord(v) || typeof v.kind !== 'string') return 'respond must be an object with a string kind';
  const kind = v.kind;
  const simple = SIMPLE_KINDS.find((k) => k === kind);
  if (simple !== undefined) return { kind: simple };
  if (kind === 'status') {
    const status = v.status;
    if (typeof status !== 'number' || !Number.isInteger(status) || status < 200 || status > 599)
      return 'status must be an integer 200–599';
    const rawHeaders = v.headers;
    let headers: Record<string, string> | undefined;
    if (rawHeaders !== undefined) {
      if (!isRecord(rawHeaders)) return 'headers must be an object';
      headers = {};
      for (const [name, value] of Object.entries(rawHeaders)) {
        const lower = name.toLowerCase();
        if (!RESPONSE_HEADERS.some((h) => h === lower) || typeof value !== 'string')
          return `header ${name} is not allowed`;
        headers[lower] = value;
      }
    }
    return {
      kind: 'status',
      status,
      ...(v.body === undefined ? {} : { body: v.body }),
      ...(headers === undefined ? {} : { headers }),
    };
  }
  if (kind === 'hold')
    return typeof v.id === 'string' && v.id !== '' ? { kind: 'hold', id: v.id } : 'hold needs a non-empty id';
  if (kind === 'partial') {
    const n = v.failedExpansions;
    return typeof n === 'number' && Number.isInteger(n) && n >= 0
      ? { kind: 'partial', failedExpansions: n }
      : 'partial needs an integer failedExpansions ≥ 0';
  }
  if (kind === 'variant') {
    const out: {
      kind: 'variant';
      currency?: string;
      carrier?: string;
      connectVia?: string;
      scope?: 'first-offer' | 'all-offers';
    } = { kind: 'variant' };
    const { currency, carrier, connectVia, scope } = v;
    if (currency !== undefined) {
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency))
        return 'variant currency must be three upper-case letters';
      out.currency = currency;
    }
    if (carrier !== undefined) {
      if (typeof carrier !== 'string' || carrier.length < 1 || carrier.length > 3)
        return 'variant carrier must be 1–3 characters';
      out.carrier = carrier;
    }
    if (connectVia !== undefined) {
      if (typeof connectVia !== 'string' || !/^[A-Z]{3}$/.test(connectVia))
        return 'variant connectVia must be three upper-case letters';
      out.connectVia = connectVia;
    }
    if (scope !== undefined) {
      const s = SCOPES.find((x) => x === scope);
      if (s === undefined) return 'variant scope must be first-offer or all-offers';
      out.scope = s;
    }
    return out;
  }
  return `unknown kind ${kind}`;
}

/** Validates a scenario body `{ rules }`; a string is the reason it is refused. */
export function parseFixtureRules(v: unknown): FixtureRule[] | string {
  if (!isRecord(v) || !Array.isArray(v.rules)) return 'body must be { rules: FixtureRule[] }';
  const rules: FixtureRule[] = [];
  for (const [i, raw] of v.rules.entries()) {
    if (!isRecord(raw)) return `rules[${i}] must be an object`;
    const m = raw.match;
    if (!isRecord(m)) return `rules[${i}]: match is required`;
    const match: { path?: FixturePath; params?: Record<string, string> } = {};
    if (m.path !== undefined) {
      const path = FIXTURE_PATHS.find((p) => p === m.path);
      if (path === undefined) return `rules[${i}]: unknown path ${String(m.path)}`;
      match.path = path;
    }
    const rawParams = m.params;
    if (rawParams !== undefined) {
      if (!isRecord(rawParams)) return `rules[${i}]: params must be an object`;
      const params: Record<string, string> = {};
      for (const [k, x] of Object.entries(rawParams)) {
        if (typeof x !== 'string') return `rules[${i}]: param ${k} must be a string`;
        params[k] = x;
      }
      match.params = params;
    }
    const respond = parseFixtureResponse(raw.respond);
    if (typeof respond === 'string') return `rules[${i}]: ${respond}`;
    const times = raw.times;
    if (times !== undefined && (typeof times !== 'number' || !Number.isInteger(times) || times < 1))
      return `rules[${i}]: times must be a positive integer`;
    rules.push({ match, respond, ...(typeof times === 'number' ? { times } : {}) });
  }
  return rules;
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
