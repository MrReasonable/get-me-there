/**
 * Database fixtures for the alert runner tests (spec §6.8): an in-memory database with the real WP3 migrations and
 * repositories, a fixed clock, a capturing logger and a recording notifier.
 * why: alerts refuse synthetic rows (spec §5.5), so these tests write rows of the real provider kinds into a ':memory:'
 * test database; nothing here is reachable from a production bootstrap. Worked example only (London → New York).
 */
import {
  type AlertDigest,
  type AlertEventPayload,
  type AlertRule,
  addDays,
  apiContract,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type Booking,
  type Cabin,
  type Cell,
  type CellKey,
  type DefinitionInput,
  type DefinitionSnapshot,
  fixedClock,
  type IsoDate,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  itineraryHash,
  type Logger,
  type NormalisedItinerary,
  type Notifier,
  type OperatorMessage,
  type ProviderId,
  parseConfig,
  type SearchDefinition,
  type Segment,
  type SuppliedField,
} from '@gmt/core';
import { applyMigrations, createRepos, type Db, MIGRATIONS_DIR, openDatabase, type Repos } from '@gmt/db';
import type { AlertRunnerDeps } from '../../src/alerts/runner.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');
const HOUR = 3_600_000;

/** An instant `hours` before `at`. */
export function hoursBefore(at: IsoDateTime, hours: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(at) - hours * HOUR);
}

export interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  msg: string | undefined;
}

/** A Logger that keeps every line with its child bindings, so tests can assert on messages and on absent secrets. */
export function captureLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const make = (bindings: object): Logger => {
    const at =
      (level: LogLine['level']) =>
      (o: object, msg?: string): void => {
        lines.push({ level, fields: { ...bindings, ...o }, msg });
      };
    return {
      debug: at('debug'),
      info: at('info'),
      warn: at('warn'),
      error: at('error'),
      child: (b) => make({ ...bindings, ...b }),
    };
  };
  return Object.assign(make({}), { lines });
}

type NotifierMessage = Parameters<Notifier['send']>[0];
export interface SentDigest {
  digest: AlertDigest;
  subject: string;
  body: string;
}

/** A Notifier that records every message and answers with a fixed result. */
export class RecordingNotifier implements Notifier {
  readonly id: string;
  readonly sent: NotifierMessage[] = [];
  #result: { ok: boolean; detail?: string };
  /** Called during each send, before it answers (a test can look at the database mid-send). */
  onSend: (() => void) | null = null;
  constructor(id = 'recording', result: { ok: boolean; detail?: string } = { ok: true }) {
    this.id = id;
    this.#result = result;
  }
  async send(msg: NotifierMessage): Promise<{ ok: boolean; detail?: string }> {
    this.sent.push(msg);
    this.onSend?.();
    return this.#result;
  }
  /** Changes the answer of every later send. */
  respondWith(result: { ok: boolean; detail?: string }): void {
    this.#result = result;
  }
  digests(): SentDigest[] {
    return this.sent.flatMap((m) =>
      m.kind === 'digest' ? [{ digest: m.digest, subject: m.subject, body: m.body }] : [],
    );
  }
  operatorMessages(): OperatorMessage[] {
    return this.sent.flatMap((m) => (m.kind === 'operator' ? [m.message] : []));
  }
}

/** Test configuration through core's own parser (no hand-built Config). */
export function testConfig(env: Record<string, string> = {}) {
  const parsed = parseConfig(
    { NODE_ENV: 'test', DATABASE_PATH: ':memory:', BIND_ADDRESS: '127.0.0.1', ...env },
    { realpath: (p) => p },
  );
  if (!parsed.ok) throw new Error(`test config invalid: ${JSON.stringify(parsed.errors)}`);
  return parsed.config;
}

export interface Fixture {
  db: Db;
  clock: ReturnType<typeof fixedClock>;
  repos: Repos;
  log: ReturnType<typeof captureLogger>;
  notifier: RecordingNotifier;
  deps: AlertRunnerDeps;
}

/** A fresh database and repositories per test. `env` reaches the config parser (APP_BASE_URL, STALE_AFTER_HOURS, …). */
export function fixture(opts: { notifier?: RecordingNotifier; env?: Record<string, string> } = {}): Fixture {
  const db = openDatabase(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = fixedClock(NOW);
  // why: allowSynthetic lets Task 11.6 write fixture rows so the runner's own refusal can be observed.
  const repos = createRepos(db, clock, { allowSynthetic: true });
  repos.airports.upsertAll({
    version: 'test',
    airports: [
      {
        iata: LHR,
        icao: 'EGLL',
        name: 'Heathrow',
        city: 'London',
        country: 'GB',
        tz: 'Europe/London',
        lat: 51.47,
        lon: -0.4543,
        metro: 'LON',
      },
      {
        iata: LGW,
        icao: 'EGKK',
        name: 'Gatwick',
        city: 'London',
        country: 'GB',
        tz: 'Europe/London',
        lat: 51.148,
        lon: -0.19,
        metro: 'LON',
      },
      {
        iata: JFK,
        icao: 'KJFK',
        name: 'John F Kennedy',
        city: 'New York',
        country: 'US',
        tz: 'America/New_York',
        lat: 40.64,
        lon: -73.78,
        metro: 'NYC',
      },
      {
        iata: EWR,
        icao: 'KEWR',
        name: 'Newark',
        city: 'New York',
        country: 'US',
        tz: 'America/New_York',
        lat: 40.69,
        lon: -74.17,
        metro: 'NYC',
      },
    ],
    metros: { LON: [LHR, LGW], NYC: [JFK, EWR] },
  });
  const log = captureLogger();
  const notifier = opts.notifier ?? new RecordingNotifier();
  const config = testConfig(opts.env);
  return {
    db,
    clock,
    repos,
    log,
    notifier,
    deps: { config, db, repos, providers: [], notifiers: [notifier], clock, log },
  };
}

/** The worked-example definition (London → New York), with overrides. */
export function seedDefinition(f: Fixture, over: Partial<DefinitionInput> = {}): SearchDefinition {
  return f.repos.definitions.create({
    name: 'London to New York (worked example)',
    origins: [LHR, LGW],
    destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: {
      maxJourneyMinutes: 1500,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
      checkedBagRequired: true,
    },
    verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
    budget: { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 },
    providers: {
      discovery: ['travelpayouts', 'searchapi'],
      verification: ['searchapi'],
      discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
    },
    destinationNotes: {},
    onwardCostPence: {},
    scheduleCron: '0 5 * * 1',
    scheduleTz: 'Europe/London',
    enabled: true,
    ...over,
  });
}

/**
 * A running execution over the definition's snapshot (a child of one cell when `child` is given); returns its id.
 * A new parent first completes the definition's running parent, as consecutive runs leave it (one active parent).
 */
export function seedExecution(f: Fixture, def: SearchDefinition, child: CellKey | null = null): string {
  const active = child === null ? f.repos.executions.activeParent(def.id) : null;
  if (active !== null) f.repos.executions.setStatus(active.id, 'completed', { finishedAt: f.clock.now() });
  const snapshot: DefinitionSnapshot = {
    ...def,
    resolved: {
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: asIsoDate('2026-10-21'),
      departureTo: asIsoDate('2027-04-20'),
      minNights: def.minNights,
      maxNights: def.maxNights,
    },
    resolvedAt: f.clock.now(),
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
  return f.repos.executions.create({
    definitionId: def.id,
    isChild: child !== null,
    cell: child,
    snapshot,
    estimate: null,
    trigger: 'manual',
    status: 'running',
  }).id;
}

/** `n` cells of 14 nights departing daily from 2026-11-01. */
export function cells(n: number, origin = LHR, destination = JFK): Cell[] {
  return Array.from({ length: n }, (_, i) => {
    const departureDate = addDays(asIsoDate('2026-11-01'), i);
    return { origin, destination, departureDate, returnDate: addDays(departureDate, 14), nights: 14 };
  });
}

/** The one cell of `cells(n)` at index `i`, or a thrown error (keeps tests free of non-null assertions). */
export function cellAt(list: Cell[], i: number): Cell {
  const c = list[i];
  if (c === undefined) throw new Error(`no cell at ${i}`);
  return c;
}

export interface CalendarSeed {
  cell: CellKey;
  pricePence: number;
  fetchedAt?: IsoDateTime;
  providerId?: ProviderId;
  cabin?: Cabin;
  /** The vendor's own age bound; null = unknown. Defaults: Travelpayouts 48, SearchApi date grid 24. */
  maxAgeHours?: number | null;
  providerObservedAt?: IsoDateTime | null;
}

function calendarRow(f: Fixture, r: CalendarSeed) {
  const providerId = r.providerId ?? 'searchapi';
  const sourceKind =
    providerId === 'searchapi'
      ? 'scraped-aggregate'
      : providerId === 'travelpayouts'
        ? 'authorised-cached'
        : 'synthetic';
  return {
    providerId,
    sourceKind,
    cabin: r.cabin ?? 'economy',
    cell: r.cell,
    pricePence: r.pricePence,
    priceNativeMinor: r.pricePence,
    currencyNative: 'GBP',
    fx: { converted: false },
    pointOfSale: providerId === 'searchapi' ? 'GB' : 'unknown',
    fetchedAt: r.fetchedAt ?? f.clock.now(),
    providerObservedAt: r.providerObservedAt ?? null,
    maxAgeHours:
      r.maxAgeHours !== undefined
        ? r.maxAgeHours
        : providerId === 'searchapi'
          ? 24
          : providerId === 'travelpayouts'
            ? 48
            : 0,
    vendorLink: null,
    reusedFromExecutionId: null,
  } as const;
}

/** Calendar rows of a real provider kind (SearchApi date grid by default) fetched by the execution; 'fixture' is synthetic. */
export function seedCalendar(f: Fixture, executionId: string, rows: CalendarSeed[]): number[] {
  return f.repos.calendarPrices.insert(
    executionId,
    rows.map((r) => calendarRow(f, r)),
  );
}

/**
 * One discovery tile through CellsRepo.writeTile, so the priced outcome can carry `lastError` (decision 30: a tile the
 * page cap cut short leads its last_error with core's TRUNCATED_NOTE).
 */
export function seedTile(
  f: Fixture,
  executionId: string,
  rows: CalendarSeed[],
  lastError: string | null,
): void {
  const prices = rows.map((r) => calendarRow(f, r));
  const providerId = prices[0]?.providerId ?? 'searchapi';
  f.repos.cells.seed(
    executionId,
    rows.map((r) => ({ ...r.cell, nights: 14 })),
    [providerId],
  );
  f.repos.cells.writeTile(executionId, providerId, {
    tileIndex: 0,
    cells: rows.map((r) => r.cell),
    prices: [...prices],
    outcomes: prices.map((p) => ({
      ...p.cell,
      status: 'priced',
      reason: null,
      lastError,
      fetchedAt: p.fetchedAt,
      minPence: p.pricePence,
      cabin: p.cabin,
      pointOfSale: p.pointOfSale,
      sourceKind: p.sourceKind,
    })),
    discards: 0,
  });
}

/**
 * Copies the newest earlier SearchApi date-grid price of `cell` into the execution, as the engine's reuse does
 * (spec §8.1: original fetchedAt, reused_from_execution_id set). A reused row is never an alert candidate.
 */
export function seedReused(
  f: Fixture,
  def: SearchDefinition,
  executionId: string,
  cell: Cell,
  newerThan: IsoDateTime,
): void {
  const criteria = { pointOfSale: 'GB', sourceKind: 'scraped-aggregate', newerThan } as const;
  const copies = f.repos.calendarPrices.reuseCandidates(
    def.id,
    'searchapi',
    'economy',
    criteria.pointOfSale,
    criteria.sourceKind,
    [cell],
    newerThan,
  );
  f.repos.cells.seed(executionId, [cell], ['searchapi']);
  f.repos.cells.copyReused(executionId, 'searchapi', copies, criteria);
}

export const ALL_FIELDS: SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'fareConditions',
  'seller',
  'price',
];

export interface ObservationSeed {
  departureDate: IsoDate;
  pricePence: number;
  flight?: number;
  seller?: string;
  fetchedAt?: IsoDateTime;
  suppliedFields?: SuppliedField[];
  booking?: Booking;
  bookingExpiresAt?: IsoDateTime | null;
  synthetic?: boolean;
  /** Default 'unknown', as SearchApi itinerary results carry (decision 24). */
  maxAgeHours?: number | 'unknown';
}

/** One BA nonstop LHR→JFK round trip of 14 nights, its offer and one observation (SearchApi itinerary age: unknown). */
export function seedObservation(
  f: Fixture,
  executionId: string,
  o: ObservationSeed,
): { offerId: number; observationId: number; itineraryHash: string } {
  const returnDate = addDays(o.departureDate, 14);
  const flight = o.flight ?? 117;
  const outbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: flight,
      from: LHR,
      to: JFK,
      departLocal: `${o.departureDate}T08:25`,
      arriveLocal: `${o.departureDate}T11:20`,
      durationMinutes: 475,
    },
  ];
  const inbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: flight + 1,
      from: JFK,
      to: LHR,
      departLocal: `${returnDate}T18:30`,
      arriveLocal: `${addDays(returnDate, 1)}T06:35`,
      durationMinutes: 425,
    },
  ];
  const hash = itineraryHash(outbound, inbound);
  const it: NormalisedItinerary = {
    hash,
    origin: LHR,
    destination: JFK,
    departureDate: o.departureDate,
    returnDate,
    nights: 14,
    outbound,
    inbound,
    outboundMinutes: 475,
    inboundMinutes: 425,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    airportChange: false,
    marketingCarriers: ['BA'],
  };
  f.repos.itineraries.upsertItinerary(it);
  const providerId: ProviderId = o.synthetic === true ? 'fixture' : 'searchapi';
  const r = f.repos.itineraries.recordObservation(
    { itineraryHash: hash, providerId, seller: o.seller ?? 'British Airways', cabin: 'economy' },
    {
      executionId,
      // why: decision 24 — SearchApi itinerary results carry maxAgeHours 'unknown'
      provenance: {
        providerId,
        sourceKind: o.synthetic === true ? 'synthetic' : 'scraped-search',
        fetchedAt: o.fetchedAt ?? f.clock.now(),
        maxAgeHours: o.maxAgeHours ?? 'unknown',
        fx: { converted: false },
        pointOfSale: 'GB',
        cabin: 'economy',
      },
      pricePence: o.pricePence,
      priceNativeMinor: o.pricePence,
      currencyNative: 'GBP',
      fx: { converted: false },
      taxesIncluded: true,
      selfTransfer: false,
      segmentCabins: ['economy', 'economy'],
      baggage: { cabinBag: 'included', checkedBags: 1 },
      fareConditions: null,
      booking: o.booking ?? { kind: 'none' },
      bookingExpiresAt: o.bookingExpiresAt ?? null,
      suppliedFields: o.suppliedFields ?? ALL_FIELDS,
      partialExpansion: false,
    },
  );
  return { ...r, itineraryHash: hash };
}

/**
 * Selects `selected` for itinerary search; the first `searched` come back empty (an itinerary search with no fares,
 * which counts as itinerary-searched), the rest end in error, as a completed run leaves them.
 */
export function seedVerificationCoverage(
  f: Fixture,
  executionId: string,
  selected: Cell[],
  searched: number,
): void {
  f.repos.cells.seed(executionId, selected, []);
  f.repos.cells.seedVerification(
    executionId,
    selected.map((cell) => ({ cell, reason: 'top_n' })),
    selected,
    ['searchapi'],
  );
  selected.forEach((cell, i) => {
    if (i < searched) searchedEmpty(f, executionId, cell);
    else
      f.repos.cells.setOutcome(executionId, cell, 'verification', 'searchapi', {
        status: 'error',
        reason: 'upstream',
      });
  });
}

/** An itinerary search of `cell` by the execution that found no fares (an `empty` verification outcome). */
export function searchedEmpty(f: Fixture, executionId: string, cell: CellKey): void {
  f.repos.cells.writeVerifiedCell(executionId, 'searchapi', {
    cell,
    outcome: {
      ...cell,
      status: 'empty',
      reason: null,
      lastError: null,
      fetchedAt: f.clock.now(),
      minPence: null,
      cabin: 'economy',
      pointOfSale: 'GB',
      sourceKind: 'scraped-search',
    },
    itineraries: [],
  });
}

/** Creates an enabled alert rule (calendar, absolute, £500 by default). */
export function seedRule(
  f: Fixture,
  def: SearchDefinition,
  over: Partial<Omit<AlertRule, 'id' | 'definitionId'>> = {},
): AlertRule {
  return f.repos.alerts.create({
    definitionId: def.id,
    type: 'absolute',
    thresholdPence: 50000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
    ...over,
  });
}

/** The runner's payload on an event row, parsed with core's schema (decision 56: one schema, no local copies). */
export function payloadOf(e: { payload: unknown }): AlertEventPayload {
  return apiContract.alertEventPayloadSchema.parse(e.payload);
}
