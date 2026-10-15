/**
 * The dated parameter allowlists (spec §5.2: "fixtures/recorded/<provider>/params-<date>.json
 * enumerates parameter names and values; tests assert both"), in the plan's ParamsAllowlist shape.
 * Every parameter record:fixtures sends is checked against this table before the request leaves.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { IsoDate } from '@gmt/core';
import { canonicalJson, type ParamsAllowlist } from '@gmt/providers';

export type EndpointKey = 'prices_for_dates' | 'google_flights_calendar' | 'google_flights';
const ENDPOINT_KEYS: readonly EndpointKey[] = [
  'prices_for_dates',
  'google_flights_calendar',
  'google_flights',
];
type ValueKind = 'iata' | 'iso-date' | 'iso-month' | 'positive-int' | 'opaque-token';
/**
 * `fixed`: the allowlist lists the values actually sent. `oneOf`: the allowlist lists the vendor's whole
 * documented set (spec §5.4 `travel_class`), so WP5 may send any cabin while this run sends one.
 * `kind`: a variable value, written as 'any'.
 */
type ParamRule = { fixed: readonly string[] } | { oneOf: readonly string[] } | { kind: ValueKind };
interface EndpointRules {
  provider: 'travelpayouts' | 'searchapi';
  key: string;
  params: Readonly<Record<string, ParamRule>>;
}

const KIND_PATTERN: Record<Exclude<ValueKind, 'opaque-token'>, RegExp> = {
  iata: /^[A-Z]{3}$/,
  'iso-date': /^\d{4}-\d{2}-\d{2}$/,
  'iso-month': /^\d{4}-\d{2}$/,
  'positive-int': /^[1-9]\d*$/,
};
/** Spec §5.4: SearchApi's `travel_class` values. */
export const SEARCHAPI_TRAVEL_CLASSES: readonly string[] = [
  'business',
  'economy',
  'first_class',
  'premium_economy',
];
const RECORDED_DIR = `${sep}fixtures${sep}recorded`;

/** The full rule table. `gl` is pinned to `gb`: the recorded tree is the public worked example's (spec §2). */
export function paramRules(): Readonly<Record<EndpointKey, EndpointRules>> {
  const iata: ParamRule = { kind: 'iata' };
  const date: ParamRule = { kind: 'iso-date' };
  const shared = {
    flight_type: { fixed: ['round_trip'] },
    travel_class: { oneOf: SEARCHAPI_TRAVEL_CLASSES },
    adults: { fixed: ['1'] },
    currency: { fixed: ['GBP'] },
    gl: { fixed: ['gb'] },
    hl: { fixed: ['en'] },
    // why: plan decision 29 — separate-ticket itineraries excluded on both engines (documented for both)
    separate_tickets: { fixed: ['1'] },
  } as const;
  return {
    prices_for_dates: {
      provider: 'travelpayouts',
      key: '/aviasales/v3/prices_for_dates',
      params: {
        origin: iata,
        destination: iata,
        departure_at: { kind: 'iso-month' },
        one_way: { fixed: ['false'] },
        currency: { fixed: ['gbp'] },
        limit: { fixed: ['1000'] },
        page: { kind: 'positive-int' },
      },
    },
    google_flights_calendar: {
      provider: 'searchapi',
      key: '/api/v1/search?engine=google_flights_calendar',
      params: {
        engine: { fixed: ['google_flights_calendar'] },
        departure_id: iata,
        arrival_id: iata,
        outbound_date: date,
        outbound_date_start: date,
        outbound_date_end: date,
        return_date: date,
        return_date_start: date,
        return_date_end: date,
        ...shared,
      },
    },
    google_flights: {
      provider: 'searchapi',
      key: '/api/v1/search?engine=google_flights',
      params: {
        engine: { fixed: ['google_flights'] },
        departure_id: iata,
        arrival_id: iata,
        outbound_date: date,
        return_date: date,
        ...shared,
        // why: plan decision 24 — sorted by price; no `stops` on either engine (separate_tickets is shared, decision 29)
        sort_by: { fixed: ['price'] },
        departure_token: { kind: 'opaque-token' },
        booking_token: { kind: 'opaque-token' },
      },
    },
  };
}

/** Validates outgoing parameters and accumulates the names and fixed values sent. */
export class ParamLog {
  private readonly observed = new Map<EndpointKey, Map<string, Set<string>>>();
  constructor(private readonly rules: Readonly<Record<EndpointKey, EndpointRules>>) {}

  /** Throws before a request leaves if any parameter or value is outside the table. Messages name parameters, never values. */
  validate(key: EndpointKey, params: URLSearchParams): void {
    const table = this.rules[key].params;
    for (const [name, value] of params) {
      const rule = table[name];
      if (rule === undefined) throw new Error(`parameter ${name} is not in the ${key} allowlist`);
      const allowed = 'fixed' in rule ? rule.fixed : 'oneOf' in rule ? rule.oneOf : null;
      if (allowed !== null && !allowed.includes(value))
        throw new Error(`${key}: a value of ${name} is not allowed`);
      if ('kind' in rule && rule.kind !== 'opaque-token' && !KIND_PATTERN[rule.kind].test(value))
        throw new Error(`${key}: ${name} is not a ${rule.kind}`);
    }
  }

  /**
   * Records the names and fixed values of a request the vendor answered. why: only a request that left and got a
   * response evidences a parameter; a call the guard refused or an abort stopped adds nothing (prov-wp04b-r2-003).
   */
  observe(key: EndpointKey, params: URLSearchParams): void {
    const table = this.rules[key].params;
    const seen = this.observed.get(key) ?? new Map<string, Set<string>>();
    this.observed.set(key, seen);
    for (const [name, value] of params) {
      const rule = table[name];
      const values = seen.get(name) ?? new Set<string>();
      seen.set(name, values);
      if (rule !== undefined && 'fixed' in rule) values.add(value); // why: oneOf lists the documented set and variables are 'any'
    }
  }

  /**
   * The allowlist document for one provider, hashed like a recorded fixture (canonicalJson from
   * @gmt/providers, so WP4's loadParamsAllowlist verifies it). Keys are the endpoint path, or
   * '<path>?engine=<value>' for SearchApi's engines multiplexed on one path (plan ParamsAllowlist).
   */
  document(provider: 'travelpayouts' | 'searchapi', recordedAt: IsoDate): ParamsAllowlist {
    const endpoints: ParamsAllowlist['endpoints'] = {};
    for (const k of ENDPOINT_KEYS) {
      const r = this.rules[k];
      const seen = this.observed.get(k);
      if (r.provider !== provider || seen === undefined) continue;
      const names = [...seen.keys()].sort();
      const values: Record<string, string[] | 'any'> = {};
      for (const name of names) {
        const rule = r.params[name];
        values[name] =
          rule === undefined || 'kind' in rule
            ? 'any'
            : 'oneOf' in rule
              ? [...rule.oneOf].sort()
              : [...(seen.get(name) ?? [])].sort();
      }
      endpoints[r.key] = { names, values };
    }
    const body = { provider, recordedAt, endpoints };
    return { ...body, contentSha256: createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex') };
  }
}

/**
 * Writes params-<date>.json under `root` (spec §5.5). Refuses a root whose real path is not a
 * fixtures/recorded directory, a provider directory that resolves outside the real root (sec-003), and an existing
 * file or symlink at the target.
 */
export function writeAllowlist(root: string, doc: ParamsAllowlist): string {
  if (!resolve(root).endsWith(RECORDED_DIR))
    throw new Error(`refusing to write outside fixtures/recorded/: ${resolve(root)}`);
  mkdirSync(root, { recursive: true });
  const realRoot = realpathSync(root);
  if (!realRoot.endsWith(RECORDED_DIR))
    throw new Error(`refusing to write: ${root} resolves to ${realRoot}, outside fixtures/recorded/`);
  const dir = join(root, doc.provider);
  mkdirSync(dir, { recursive: true });
  const realDir = realpathSync(dir);
  if (realDir !== join(realRoot, doc.provider))
    throw new Error(`refusing to write: ${dir} resolves outside ${realRoot}`);
  const path = join(realDir, `params-${doc.recordedAt}.json`);
  // why: 'wx' refuses an existing file or symlink at the target, as WP4's recorder does (sec2-006); a second run on the
  // same date must first delete the earlier session's files and allowlists (Task 12b step 1)
  writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, { flag: 'wx' });
  return path;
}
