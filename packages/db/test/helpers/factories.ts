import { randomUUID } from 'node:crypto';
import {
  asIata,
  asIsoDate,
  type Cell,
  type CellKey,
  type Clock,
  type DefinitionInput,
  type DefinitionSnapshot,
  type Execution,
  type ExecutionBudget,
  type ExecutionStatus,
  type NormalisedItinerary,
  type ProviderLimits,
  type SearchDefinition,
} from '@gmt/core';
import type { BudgetConfig } from '../../src/budgetConfig.js';
import type { Db } from '../../src/client.js';
import { DefinitionsRepo } from '../../src/repositories/definitions.js';
import { ExecutionsRepo } from '../../src/repositories/executions.js';
import type { CalendarPriceInsert, ExecutionCreateInput, VerifiedCellWrite } from '../../src/types.js';
import { T0 } from './db.js';

/** One provider's guard entry. Defaults: a 40usd-shaped subscription (rate 0, no fee). */
export function limits(
  over: Partial<ProviderLimits & { billable: boolean; trialUsed: number }> = {},
): ProviderLimits & { billable: boolean; trialUsed: number } {
  return {
    monthlyCallCap: 10_000,
    window: 'month',
    billingDay: 1,
    ratePerMinute: 10,
    ratePerHour: 2000,
    concurrency: 2,
    cacheTtlHours: 1,
    costPerCallMicroGbp: 0,
    planFixedMicroGbp: 0,
    excludedFromSchedule: false,
    billable: true,
    trialUsed: 0,
    ...over,
  };
}

/** A guard configuration; `spend` overrides the spec §12 defaults. */
export function budgetConfig(
  providers: BudgetConfig['providers'],
  spend: Partial<BudgetConfig['spend']> = {},
): BudgetConfig {
  return {
    providers,
    spend: {
      monthlyCapMicroGbp: 0,
      globalBillingDay: 1,
      softConfirmMicroGbp: 1_000_000,
      executionMaxCalls: 2000,
      executionMaxFreeCalls: 2000,
      executionMaxCostMicroGbp: 0,
      childMaxCalls: 6,
      ...spend,
    },
  };
}

// The worked example only (brief rules): London → New York.
export const LHR = asIata('LHR');
export const LGW = asIata('LGW');
export const JFK = asIata('JFK');
export const EWR = asIata('EWR');

export function cell(
  origin = LHR,
  destination = JFK,
  departureDate = '2027-03-14',
  returnDate = '2027-03-28',
): CellKey {
  return { origin, destination, departureDate: asIsoDate(departureDate), returnDate: asIsoDate(returnDate) };
}

/**
 * A definition and an execution inserted with raw SQL; the snapshot holds only the budget the guard reads
 * (plan Budget port: per-execution caps come from the snapshot).
 */
export function rawExecution(
  db: Db,
  budget: ExecutionBudget,
  opts: { isChild?: boolean } = {},
): { definitionId: string; executionId: string } {
  const definitionId = randomUUID();
  const executionId = randomUUID();
  db.raw
    .prepare(
      `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
        verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
       VALUES (@id, 'London to New York', '["LHR","LGW"]', '["JFK","EWR"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 21, 'economy', '{}',
        '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', @budget, '{"discovery":[],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`,
    )
    .run({ id: definitionId, budget: JSON.stringify(budget), at: T0 });
  const c = cell();
  const child = opts.isChild === true;
  db.raw
    .prepare(
      `INSERT INTO search_executions (id, definition_id, is_child, child_origin, child_destination, child_departure_date, child_return_date, definition_snapshot_json, trigger, status, created_at, started_at)
       VALUES (@id, @definitionId, @isChild, @o, @d, @dep, @ret, @snapshot, 'manual', 'running', @at, @at)`,
    )
    .run({
      id: executionId,
      definitionId,
      isChild: child ? 1 : 0,
      o: child ? c.origin : null,
      d: child ? c.destination : null,
      dep: child ? c.departureDate : null,
      ret: child ? c.returnDate : null,
      snapshot: JSON.stringify({ budget }),
      at: T0,
    });
  return { definitionId, executionId };
}

/** The worked example (spec §1, §11 defaults): LHR, LGW → JFK, EWR, 10–21 nights, 182-day relative window. */
export function exampleDefinitionInput(over: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: 'London to New York',
    origins: [LHR, LGW],
    destinations: [JFK, EWR],
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
    minNights: 10,
    maxNights: 21,
    cabin: 'economy',
    constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
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
  };
}

/** A frozen snapshot of a definition resolved at T0 (spec §3 "snapshot"). */
export function snapshotOf(d: SearchDefinition): DefinitionSnapshot {
  return {
    ...d,
    resolved: {
      origins: d.origins,
      destinations: d.destinations,
      departureFrom: asIsoDate('2026-10-21'),
      departureTo: asIsoDate('2027-04-20'),
      minNights: d.minNights,
      maxNights: d.maxNights,
    },
    resolvedAt: T0,
    windowClamped: false,
    droppedAlwaysInclude: [],
  };
}

/** The statuses `create` accepts; anything else is reached through `setStatus`, the path the engine takes. */
function creatable(s: ExecutionStatus): ExecutionCreateInput['status'] | null {
  switch (s) {
    case 'pending':
    case 'running':
    case 'skipped_budget':
    case 'skipped_confirm':
    case 'skipped_window':
    case 'skipped_missed':
      return s;
    default:
      return null;
  }
}

/** Creates (or reuses) a definition and one execution through the repositories. */
export function newExecution(
  db: Db,
  clock: Clock,
  opts: {
    definition?: SearchDefinition;
    status?: ExecutionStatus;
    cell?: CellKey | null;
    trigger?: Execution['trigger'];
  } = {},
): { definition: SearchDefinition; execution: Execution } {
  const definition = opts.definition ?? new DefinitionsRepo(db, clock).create(exampleDefinitionInput());
  const executions = new ExecutionsRepo(db, clock);
  const wanted = opts.status ?? 'running';
  // why: a status `create` refuses goes in through an inactive one, so the partial unique index never sees two active parents (arch-r3-004).
  const createAs = creatable(wanted) ?? 'skipped_missed';
  const cell = opts.cell ?? null;
  const created = executions.create({
    definitionId: definition.id,
    isChild: cell !== null,
    cell,
    snapshot: snapshotOf(definition),
    estimate: null,
    trigger: opts.trigger ?? 'manual',
    status: createAs,
  });
  if (createAs === wanted) return { definition, execution: created };
  executions.setStatus(created.id, wanted, { finishedAt: clock.now() });
  const moved = executions.get(created.id);
  if (moved === null) throw new Error('execution vanished');
  return { definition, execution: moved };
}

/** A Cell with its nights computed from the two calendar dates (UTC midnights, so no DST effect). */
export function withNights(c: CellKey): Cell {
  return {
    ...c,
    nights:
      (Date.parse(`${c.returnDate}T00:00:00Z`) - Date.parse(`${c.departureDate}T00:00:00Z`)) / 86_400_000,
  };
}

/** A GBP Travelpayouts calendar price at T0 for a cell; override any field per test. */
export function calendarPrice(c: CellKey, over: Partial<CalendarPriceInsert> = {}): CalendarPriceInsert {
  return {
    providerId: 'travelpayouts',
    sourceKind: 'authorised-cached',
    cabin: 'economy',
    cell: c,
    pricePence: 41_200,
    priceNativeMinor: 41_200,
    currencyNative: 'GBP',
    fx: { converted: false },
    pointOfSale: 'unknown',
    fetchedAt: T0,
    providerObservedAt: null,
    maxAgeHours: 48,
    vendorLink: null,
    reusedFromExecutionId: null,
    ...over,
  };
}

/** A nonstop round trip on the worked example; `hash` stands in for WP2's sha256 hex. */
export function itinerary(hash = 'a'.repeat(64), c: CellKey = cell(), flight = 117): NormalisedItinerary {
  return {
    hash,
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
    nights: withNights(c).nights,
    outbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: flight,
        from: c.origin,
        to: c.destination,
        departLocal: `${c.departureDate}T08:25`,
        arriveLocal: `${c.departureDate}T11:20`,
        durationMinutes: 475,
      },
    ],
    inbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: flight - 5,
        from: c.destination,
        to: c.origin,
        departLocal: `${c.returnDate}T18:30`,
        arriveLocal: `${c.returnDate}T06:35`,
        durationMinutes: 425,
      },
    ],
    outboundMinutes: 475,
    inboundMinutes: 425,
    stopsOut: 0,
    stopsIn: 0,
    layovers: [],
    airportChange: false,
    marketingCarriers: ['BA'],
  };
}

export type ObservationWrite = VerifiedCellWrite['itineraries'][number]['offers'][number]['observation'];

/** One SearchApi observation's fields as normalisation yields them (GBP, unconverted). */
export function observationWrite(over: Partial<ObservationWrite> = {}): ObservationWrite {
  return {
    provenance: {
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      fetchedAt: T0,
      maxAgeHours: 0,
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
    },
    pricePence: 41_200,
    priceNativeMinor: 41_200,
    currencyNative: 'GBP',
    fx: { converted: false },
    taxesIncluded: true,
    selfTransfer: false,
    segmentCabins: ['economy', 'economy'],
    baggage: { cabinBag: 'included', checkedBags: 1 },
    fareConditions: null,
    booking: {
      kind: 'post',
      url: 'https://www.google.com/travel/clk/f',
      postData: 'u=<booking_request:0>',
      host: 'www.google.com',
    },
    bookingExpiresAt: null,
    suppliedFields: ['segments', 'segmentTimes', 'segmentCabins', 'price', 'seller', 'baggage'],
    partialExpansion: false,
    ...over,
  };
}
