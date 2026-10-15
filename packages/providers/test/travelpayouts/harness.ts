/**
 * Test harness for the Travelpayouts adapter (WP6), built on the package's shared fakes (test/fakes.ts: FakeBudget,
 * FakeCache, CapturingLogger, SENTINELS, testLimits, TP) and the shared guarded msw server (test/support/msw.ts,
 * installed by test/support/setup.ts). Every test runs the REAL http-kit pipeline; only the BudgetGuard and
 * ResponseCache ports are fakes, and setup.ts checks after every test that no reservation was left open.
 */
import {
  asIata,
  asIsoDate,
  BudgetExceeded,
  type CellKey,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Iata,
  type ProviderContext,
  type ProviderError,
} from '@gmt/core';
import type { HttpKit, HttpKitRequest, ProviderHttpLimits } from '../../src/http/types.js';
import type { ParamsAllowlist } from '../../src/params/allowlist.js';
import {
  type TravelpayoutsProviderOptions,
  travelpayoutsProvider,
} from '../../src/travelpayouts/provider.js';
import type { MetroLookup } from '../../src/travelpayouts/tiles.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { type LedgerEvent, makeKit, SENTINELS, testLimits } from '../fakes.js';

/** The sentinel token (test/fakes.ts SENTINELS.travelpayouts; briefs README: secrets in tests are sentinels). */
export const TOKEN = SENTINELS.travelpayouts;
/** makeKit's fixed clock start. */
export const NOW = '2026-10-14T15:00:00.000Z';

export interface Harness extends ReturnType<typeof makeKit> {
  /** The kit, spied so a test can read every request the adapter made (tileIndex, ledgerCacheHit included). */
  http: HttpKit;
  requests: HttpKitRequest[];
}

/**
 * The real http-kit with only Travelpayouts limits and `syntheticAllowed: false` (the adapter never depends on the
 * synthetic gate). `limits` replaces the limits whole (for example travelpayoutsHttpLimits' output); otherwise
 * `overrides` adjust testLimits().travelpayouts. `refuse: true` makes every reserve throw BudgetExceeded;
 * `refuse: n` refuses from the n-th reserve on (FakeBudget counts reserves before asking the hook).
 */
export function makeHarness(
  o: { limits?: ProviderHttpLimits; overrides?: Partial<ProviderHttpLimits>; refuse?: boolean | number } = {},
): Harness {
  // why: 60 000/min makes the limiter's smoothing gap 1 ms (testLimits' 600/min spaces requests 100 ms apart), so
  // multi-tile tests stay fast; tests about rates pass their own limits.
  const k = makeKit({
    syntheticAllowed: false,
    limits: {
      travelpayouts: o.limits ?? {
        ...testLimits().travelpayouts,
        ratePerMinute: 60_000,
        ratePerHour: 3_600_000,
        ...o.overrides,
      },
    },
  });
  const from = o.refuse === true ? 1 : typeof o.refuse === 'number' ? o.refuse : null;
  if (from !== null) {
    k.budget.refuse = () =>
      k.budget.reserveCalls >= from
        ? new BudgetExceeded({
            scope: 'execution-free-calls',
            cap: 0,
            current: 0,
            requested: 1,
            providerId: 'travelpayouts',
          })
        : null;
  }
  const requests: HttpKitRequest[] = [];
  // why: a spy around the real kit records each request without replacing the pipeline under test.
  const http: HttpKit = {
    request: (r) => {
      requests.push(r);
      return k.kit.request(r);
    },
    stats: () => k.kit.stats(),
  };
  return { ...k, http, requests };
}

/** Ledger events of one type, in order (FakeBudget records every reserve, finalise, cache hit and fetch). */
export function eventsOf<T extends LedgerEvent['type']>(
  h: Harness,
  type: T,
): Array<Extract<LedgerEvent, { type: T }>> {
  return h.events.filter((e): e is Extract<LedgerEvent, { type: T }> => e.type === type);
}

/** Synthetic stand-in for AirportsRepo.metroOf over the worked example only (London → New York). */
export const airports: MetroLookup = {
  metroOf: (iata) =>
    iata === 'LHR' || iata === 'LGW' ? 'LON' : iata === 'JFK' || iata === 'EWR' ? 'NYC' : null,
};
export const noMetro: MetroLookup = { metroOf: () => null };

/** Synthetic allowlist in the plan's ParamsAllowlist shape (not the recorded one; Task 6.8 tests that). */
export const ALLOWLIST: ParamsAllowlist = {
  provider: 'travelpayouts',
  recordedAt: asIsoDate('2026-10-14'),
  endpoints: {
    '/aviasales/v3/prices_for_dates': {
      names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
      values: {
        currency: ['gbp'],
        departure_at: 'any',
        destination: 'any',
        limit: ['1000'],
        one_way: ['false'],
        origin: 'any',
        page: 'any',
      },
    },
  },
  contentSha256: 'synthetic',
};

export function makeProvider(h: Harness, over: Partial<TravelpayoutsProviderOptions> = {}): FlightProvider {
  return travelpayoutsProvider({
    http: h.http,
    log: h.log,
    clock: h.clock,
    token: TOKEN,
    cacheTtlSeconds: 6 * 3600,
    paramsAllowlist: ALLOWLIST,
    airports,
    ...over,
  });
}

export function discoveryOf(p: FlightProvider): DiscoveryCapability {
  if (p.discovery === undefined) throw new Error(`${p.id} has no discovery capability`);
  return p.discovery;
}

export function only<T>(xs: readonly T[]): T {
  const [x, ...rest] = xs;
  if (x === undefined || rest.length > 0) throw new Error(`expected exactly one item, got ${xs.length}`);
  return x;
}

export function ctx(signal: AbortSignal = new AbortController().signal): ProviderContext {
  return { executionId: 'exec-1', signal, recordFixtures: false };
}

/** The `tile` variant, or a thrown error naming what came back. */
export function tileOf(r: DiscoveryTileResult): Extract<DiscoveryTileResult, { kind: 'tile' }> {
  if (r.kind !== 'tile')
    throw new Error(`expected a tile, got a tile-error: ${r.error.kind} ${r.error.message}`);
  return r;
}

/** The ProviderError of a `tile-error`, or a thrown error naming what came back. */
export function errorOf(r: DiscoveryTileResult): ProviderError {
  if (r.kind !== 'tile-error')
    throw new Error(`expected a tile-error, got a tile with notes ${r.notes.join(', ')}`);
  return r.error;
}

/**
 * LHR → JFK, 10–20 March 2027, 10–12 nights: 11 × 3 = 33 cells in one departure month. The definition lists both
 * London airports, so the tile queries the shared metro (spec §5.2 rev 14).
 */
export function query(over: Partial<DiscoveryQuery> = {}): DiscoveryQuery {
  return {
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureFrom: asIsoDate('2027-03-10'),
    departureTo: asIsoDate('2027-03-20'),
    minNights: 10,
    maxNights: 12,
    cabin: 'economy',
    currency: 'GBP',
    definitionOrigins: [asIata('LHR'), asIata('LGW')],
    ...over,
  };
}

/** The cells of one pair over a window and band, through the adapter's own cellsOf (one generator, arch-016). */
export function cellsFor(
  origin: Iata,
  destination: Iata,
  from: string,
  to: string,
  minNights: number,
  maxNights: number,
): CellKey[] {
  return cellsOf(
    query({
      origin,
      destination,
      departureFrom: asIsoDate(from),
      departureTo: asIsoDate(to),
      minNights,
      maxNights,
    }),
  );
}

export interface RowSpec {
  origin: string;
  dest: string;
  dep: string;
  ret: string | null;
  price: unknown;
  link?: string;
}

/** Synthetic row in the documented prices_for_dates shape (Library notes); carrier `ZZ` is synthetic. */
export function row(s: RowSpec): Record<string, unknown> {
  return {
    origin: s.origin,
    destination: s.dest,
    origin_airport: s.origin,
    destination_airport: s.dest,
    departure_at: `${s.dep}T08:55:00+00:00`,
    ...(s.ret === null ? {} : { return_at: `${s.ret}T18:10:00-04:00` }),
    price: s.price,
    airline: 'ZZ',
    flight_number: '100',
    transfers: 0,
    return_transfers: 0,
    duration: 900,
    link: s.link ?? '/search/synthetic?t=1',
  };
}

/** A synthetic success envelope (the documented shape) in the given currency. */
export const envelope = (data: unknown[], currency = 'gbp') => ({ success: true, data, currency });
