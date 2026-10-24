// Test data written through WP3's repositories and their atomic units (writeTile, writeTileError, writeVerifiedCell,
// copyReused), so every repository invariant holds: synthetic gate, priced ⇔ price, roll-ups, UNIQUE keys. Executions
// get generated ids; tests name them ('E1') and read the real id back with `id(name)`.
import {
  asIata,
  asIsoDate,
  type BaggageSnapshot,
  type Booking,
  type Cabin,
  type CellKey,
  type DefinitionSnapshot,
  daysBetween,
  type ExecutionStatus,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  londonDateOf,
  type NormalisedItinerary,
  PRICE_UNCONFIRMED,
  type ProviderId,
  resolveWindow,
  type SearchDefinition,
  type Segment,
  type SelectionReason,
  type SuppliedField,
} from '@gmt/core';
import type { VerifiedCellWrite } from '@gmt/db';
import type { Ports } from '../../src/wiring.js';
import { T0 } from './harness.js';

const HOUR = 3_600_000;
/** An instant `hours` after the harness T0 (negative = before). */
export const at = (hours: number): IsoDateTime => isoDateTimeOfEpochMs(Date.parse(T0) + hours * HOUR);
export const cell = (o: string, d: string, dep: string, ret: string): CellKey => ({
  origin: asIata(o),
  destination: asIata(d),
  departureDate: asIsoDate(dep),
  returnDate: asIsoDate(ret),
});
const withNights = (c: CellKey) => ({ ...c, nights: daysBetween(c.departureDate, c.returnDate) });

export function snapshotOf(def: SearchDefinition, resolvedAt: IsoDateTime): DefinitionSnapshot {
  const w = resolveWindow(def.window, londonDateOf(resolvedAt));
  return {
    ...def,
    resolved: {
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: w.departureFrom,
      departureTo: w.departureTo,
      minNights: def.minNights,
      maxNights: def.maxNights,
    },
    resolvedAt,
    windowClamped: w.clamped,
    droppedAlwaysInclude: [],
  };
}

export interface SeedOffer {
  hash: string;
  pricePence: number;
  fetchedAt: IsoDateTime;
  seller?: string;
  stopsOut?: number;
  /** null: baggage not supplied (its constraints become unverified). */
  baggage?: BaggageSnapshot | null;
  /** false: the final step did not confirm the price (no `price` supplied field, decisions 27, 37). */
  confirmed?: boolean;
  maxAgeHours?: number | 'unknown';
  /** The stored booking, as an adapter wrote it; the api re-validates it on the way out (decision 54). */
  booking?: Booking;
}

/** A synthetic itinerary for the cell: `stopsOut` clearly synthetic connection points (AAA, BBB), one inbound leg. */
function itineraryOf(c: CellKey, hash: string, stopsOut: number): NormalisedItinerary {
  const path = [c.origin, ...['AAA', 'BBB', 'CCC'].slice(0, stopsOut).map(asIata), c.destination];
  const outbound: Segment[] = path.slice(0, -1).map((from, i) => ({
    marketingCarrier: 'BA',
    flightNumber: 100 + i,
    from,
    to: path[i + 1] ?? c.destination,
    departLocal: `${c.departureDate}T${String(8 + i * 3).padStart(2, '0')}:00`,
    arriveLocal: `${c.departureDate}T${String(10 + i * 3).padStart(2, '0')}:00`,
    durationMinutes: 120,
  }));
  const inbound: Segment[] = [
    {
      marketingCarrier: 'BA',
      flightNumber: 200,
      from: c.destination,
      to: c.origin,
      departLocal: `${c.returnDate}T10:00`,
      arriveLocal: `${c.returnDate}T18:00`,
      durationMinutes: 480,
    },
  ];
  return {
    hash,
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
    nights: daysBetween(c.departureDate, c.returnDate),
    outbound,
    inbound,
    outboundMinutes: 480,
    inboundMinutes: 480,
    stopsOut,
    stopsIn: 0,
    layovers: [],
    airportChange: false,
    marketingCarriers: ['BA'],
  };
}

const PROVIDER: ProviderId = 'fixture';
const CABIN: Cabin = 'economy';
const POS = 'GB';

export function seeder(ports: Ports) {
  const { repos } = ports;
  const ids = new Map<string, string>();
  const defs = new Map<string, SearchDefinition>();
  const id = (name: string): string => {
    const v = ids.get(name);
    if (v === undefined) throw new Error(`no seeded execution ${name}`);
    return v;
  };
  return {
    id,

    /** An execution of `def` in `status`, started at `startedAt`; a child when `child` is given. */
    execution(
      name: string,
      s: {
        def: SearchDefinition;
        status: ExecutionStatus;
        startedAt: IsoDateTime;
        finishedAt?: IsoDateTime | null;
        child?: CellKey;
      },
    ): string {
      const e = repos.executions.create({
        definitionId: s.def.id,
        isChild: s.child !== undefined,
        cell: s.child ?? null,
        snapshot: snapshotOf(s.def, s.startedAt),
        estimate: null,
        trigger: 'manual',
        status: 'running',
      });
      repos.executions.setStatus(e.id, s.status, {
        startedAt: s.startedAt,
        finishedAt: s.finishedAt ?? null,
      });
      ids.set(name, e.id);
      defs.set(name, s.def);
      return e.id;
    },

    /** Seeds the cells (not_run per discovery provider) and, when given, the verification selection, once per execution. */
    cells(
      name: string,
      cells: CellKey[],
      o: {
        discovery?: ProviderId[];
        verification?: ProviderId[];
        selected?: Array<{ cell: CellKey; reason: SelectionReason }>;
      } = {},
    ): void {
      const exec = id(name);
      repos.cells.seed(exec, cells.map(withNights), o.discovery ?? [PROVIDER]);
      if (o.selected !== undefined)
        repos.cells.seedVerification(exec, o.selected, cells, o.verification ?? [PROVIDER]);
    },

    /** One discovery tile covering `c`: priced with a calendar price, or empty / no_data (spec §7 atomic unit). */
    tile(
      name: string,
      c: CellKey,
      s: {
        status: 'priced' | 'empty' | 'no_data';
        fetchedAt: IsoDateTime;
        pricePence?: number;
        lastError?: string | null;
        maxAgeHours?: number | null;
        tileIndex?: number;
      },
    ): void {
      const priced = s.status === 'priced';
      const pricePence = s.pricePence ?? 45_000;
      repos.cells.writeTile(id(name), PROVIDER, {
        tileIndex: s.tileIndex ?? 0,
        cells: [c],
        discards: 0,
        prices: priced
          ? [
              {
                providerId: PROVIDER,
                sourceKind: 'synthetic',
                cabin: CABIN,
                cell: c,
                pricePence,
                priceNativeMinor: pricePence,
                currencyNative: 'GBP',
                fx: { converted: false },
                pointOfSale: POS,
                fetchedAt: s.fetchedAt,
                providerObservedAt: null,
                maxAgeHours: s.maxAgeHours === undefined ? 24 : s.maxAgeHours,
                vendorLink: null,
                reusedFromExecutionId: null,
                returnDateSource: 'vendor',
                vendorPriceMark: null,
              },
            ]
          : [],
        outcomes: [
          {
            ...c,
            status: s.status,
            reason: null,
            lastError: s.lastError ?? null,
            fetchedAt: s.fetchedAt,
            minPence: priced ? pricePence : null,
            cabin: CABIN,
            pointOfSale: POS,
            sourceKind: 'synthetic',
          },
        ],
      });
    },

    /** A discovery tile error for `cells` (attempts + 1). */
    tileError(name: string, cells: CellKey[], reason: string, lastError: string | null): void {
      repos.cells.writeTileError(id(name), PROVIDER, cells, reason, lastError);
    },

    /** Copies `from`'s discovery results for `cells` into `name` as reused rows (spec §8.1 reuse). */
    reuse(name: string, from: string, cells: CellKey[], newerThan: IsoDateTime): void {
      const def = defs.get(name);
      if (def === undefined) throw new Error(`no seeded execution ${name}`);
      const copies = repos.calendarPrices
        .reuseCandidates(def.id, PROVIDER, CABIN, POS, 'synthetic', cells, newerThan)
        .filter((c) => c.outcome.executionId === id(from));
      repos.cells.copyReused(id(name), PROVIDER, copies, {
        pointOfSale: POS,
        sourceKind: 'synthetic',
        newerThan,
      });
    },

    /** One verified cell: its itineraries, offers and observations and its priced outcome (spec §7 atomic unit). */
    verified(name: string, c: CellKey, offers: SeedOffer[]): void {
      const itineraries: VerifiedCellWrite['itineraries'] = offers.map((o) => {
        const itinerary = itineraryOf(c, o.hash, o.stopsOut ?? 0);
        const baggage = o.baggage === undefined ? { checkedBags: 1 } : o.baggage;
        const suppliedFields: SuppliedField[] = [
          'segments',
          'segmentTimes',
          'segmentCabins',
          'selfTransfer',
          'seller',
        ];
        if (o.confirmed !== false) suppliedFields.push('price');
        if (baggage !== null) suppliedFields.push('baggage');
        return {
          itinerary,
          offers: [
            {
              offer: { itineraryHash: o.hash, providerId: PROVIDER, seller: o.seller ?? 'BA', cabin: CABIN },
              observation: {
                pricePence: o.pricePence,
                priceNativeMinor: o.pricePence,
                currencyNative: 'GBP',
                fx: { converted: false },
                taxesIncluded: true,
                selfTransfer: false,
                segmentCabins: [...itinerary.outbound, ...itinerary.inbound].map(() => CABIN),
                baggage,
                fareConditions: null,
                booking: o.booking ?? { kind: 'none' },
                bookingExpiresAt: null,
                suppliedFields,
                partialExpansion: false,
                provenance: {
                  providerId: PROVIDER,
                  sourceKind: 'synthetic',
                  fetchedAt: o.fetchedAt,
                  maxAgeHours: o.maxAgeHours ?? 0,
                  fx: { converted: false },
                  pointOfSale: POS,
                  cabin: CABIN,
                },
              },
            },
          ],
        };
      });
      const fetchedAt = [...offers.map((o) => o.fetchedAt)].sort()[0] ?? T0;
      // why: WP7's write rule (decision 45): the cell's price is the cheapest confirmed one, and a cell with no
      // confirmed offer carries the `price-unconfirmed` reason.
      const confirmed = offers.filter((o) => o.confirmed !== false);
      repos.cells.writeVerifiedCell(id(name), PROVIDER, {
        cell: c,
        itineraries,
        outcome: {
          ...c,
          status: 'priced',
          reason: confirmed.length === 0 ? PRICE_UNCONFIRMED : null,
          lastError: null,
          fetchedAt,
          minPence: Math.min(...(confirmed.length > 0 ? confirmed : offers).map((o) => o.pricePence)),
          cabin: CABIN,
          pointOfSale: POS,
          sourceKind: 'synthetic',
        },
      });
    },

    /**
     * Ledger rows as http-kit leaves them (review TS-6): for each tile index, `attempts` upstream calls through the real
     * budget guard, the first one per tile counting as the tile.
     */
    ledger(name: string, tiles: Array<{ tileIndex: number; attempts: number }>): void {
      for (const t of tiles)
        for (let attempt = 1; attempt <= t.attempts; attempt++)
          ports.budget
            .reserve({
              providerId: PROVIDER,
              executionId: id(name),
              tileIndex: t.tileIndex,
              costMicroGbp: ports.config.providers.fixture?.costMicroGbp ?? 0,
              httpAttempt: attempt,
              endpointPath: '/calendar',
            })
            .finalise({ outcome: 'ok', httpStatus: 200, durationMs: 1 });
    },

    /**
     * One point of a vendor price-history series for one searched trip (spec §7 route_price_history rev 28, ruling 6);
     * the trip defaults to 5 to 15 Nov 2026, the cabin to economy, the point of sale to GB.
     */
    routeLowest(s: {
      origin: string;
      destination: string;
      date: string;
      pricePence: number;
      fetchedAt: IsoDateTime;
      trip?: { departureDate: string; returnDate: string };
      pointOfSale?: string;
    }): void {
      const trip = s.trip ?? { departureDate: '2026-11-05', returnDate: '2026-11-15' };
      repos.routeHistory.upsert([
        {
          origin: asIata(s.origin),
          destination: asIata(s.destination),
          trip: { departureDate: asIsoDate(trip.departureDate), returnDate: asIsoDate(trip.returnDate) },
          cabin: CABIN,
          providerId: PROVIDER,
          date: asIsoDate(s.date),
          lowestPricePence: s.pricePence,
          currency: 'GBP',
          fetchedAt: s.fetchedAt,
          pointOfSale: s.pointOfSale ?? 'GB',
        },
      ]);
    },
  };
}

export type Seeder = ReturnType<typeof seeder>;
