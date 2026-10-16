import type { CellKey } from '../types/definition.js';
import type { ErrorReason } from '../types/execution.js';
import type { Iata, IsoDate, IsoDateTime, IsoMonth } from '../types/ids.js';
import type { BaggageSnapshot, FareConditions, SuppliedField } from '../types/itinerary.js';
import type { Cabin, PointOfSale, ProviderId, SourceKind } from '../types/provenance.js';

export { AbortedError, BudgetExceeded, ProviderError } from '../errors.js';
export type { CellKey } from '../types/definition.js';
export type { Cabin, ProviderId, SourceKind } from '../types/provenance.js';
export type { BudgetGuard, BudgetScope, Reservation, Usage } from './budget.js';
export type { ResponseCache } from './cache.js';
export type { Notifier } from './notifier.js';

/** Spec §5.1 (revision 11). Declared per capability and stamped on every stored price row. */
export interface CapabilityInfo {
  sourceKind: SourceKind;
  provenanceNote: string;
  maxAgeHours: number | 'unknown';
}

export interface DiscoveryQuery {
  origin: Iata;
  destination: Iata;
  departureFrom: IsoDate;
  departureTo: IsoDate;
  minNights: number;
  maxNights: number;
  cabin: Cabin;
  currency: 'GBP';
  /** when set, discovery.plan RE-PLANS over this subset (fewer calls); tiles still partition it */
  cells?: CellKey[];
}
/** Vendor-neutral, typed tile requests; `month` is the Travelpayouts tile. */
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate };
export interface TilePlan {
  index: number;
  coveredCells: CellKey[];
  request: TileRequest;
}

/**
 * A covered cell the adapter could not fully price (spec §3, §8.1; plan decision 24): rows it received for exactly
 * this cell but dropped (`offersDropped`), or a cell it never finished reading. The engine records the cell `priced`
 * with `offers-dropped:n` when the tile also returned a price for it, else `error` with `reason`, `detail` going to
 * `last_error`. Never a vendor message in `reason`.
 */
export interface CellIssue {
  cell: CellKey;
  reason: ErrorReason;
  offersDropped: number;
  detail: string;
}

export interface RawCalendarPrice extends CellKey {
  amountMinor: number;
  currency: string;
  providerObservedAt?: IsoDateTime;
  vendorLink?: string;
}
export type DiscoveryTileResult =
  | {
      kind: 'tile';
      index: number;
      coveredCells: CellKey[];
      fetchedAt: IsoDateTime;
      pointOfSale: PointOfSale;
      prices: RawCalendarPrice[];
      noFares: CellKey[];
      notes: string[];
      /** Per-cell shortfalls the engine must record (spec §8.1); absent or empty when every covered cell is clean. */
      cellIssues?: CellIssue[];
      /**
       * True when the adapter stopped at its page cap: a priced cell's minimum is then the cheapest of the rows read,
       * not of the vendor's whole cache, and the engine labels it so. Absent: every page was read.
       */
      truncated?: boolean;
    }
  | {
      kind: 'tile-error';
      index: number;
      coveredCells: CellKey[];
      error: import('../errors.js').ProviderError;
    };

export interface ItineraryQuery extends CellKey {
  cabin: Cabin;
  adults: 1;
  currency: 'GBP';
  maxStops?: number;
  expandTop: number;
  bookingLinks: boolean;
}
export interface RawSegment {
  marketingCarrier: string;
  operatingCarrier?: string;
  flightNumber: string;
  from: Iata;
  to: Iata;
  depart: string;
  arrive: string;
  timeKind: 'local' | 'utc' | 'offset';
  cabin?: Cabin;
  durationMinutes?: number;
  aircraft?: string;
}
export interface RawOffer {
  outbound: RawSegment[];
  inbound: RawSegment[];
  seller: string;
  requestedCabin: Cabin;
  amountMinor: number;
  currency: string;
  taxesIncluded?: boolean;
  baggage?: BaggageSnapshot;
  fareConditions?: FareConditions;
  selfTransfer?: boolean;
  booking: { kind: 'get'; url: string } | { kind: 'post'; url: string; postData: string } | { kind: 'none' };
  bookingExpiresAt?: IsoDateTime;
  /**
   * True only when a seller listing confirmed this price (SearchApi step 3); false for a price the vendor declares
   * without one (a SearchApi step-2 option). The engine writes an unverified offer with `unverified` set and never
   * as a verified fare (plan decisions 27 and 29).
   */
  verified: boolean;
}
/** offers: every return option of every expanded outbound, one RawOffer each; the cheapest per outbound is the step-3 candidate. */
export interface ItinerarySearchResult {
  offers: RawOffer[];
  coverage: 'priced' | 'empty';
  fetchedAt: IsoDateTime;
  pointOfSale: PointOfSale;
  partial: boolean;
  failedExpansions: number;
  notes: string[];
  /** SearchApi price_insights.price_history; the engine upserts route_price_history */
  routeHistory?: Array<{ date: IsoDate; lowestPriceMinor: number; currency: string }>;
}

/** Adapters are constructed once with { http, log, clock }; the context carries only per-call state. */
export interface ProviderContext {
  executionId: string | null;
  signal: AbortSignal;
  recordFixtures: boolean;
}

export interface CostEstimate {
  calls: number;
  costMicroGbp: number;
  seconds: number;
  notes: string[];
}
export interface DiscoveryCapability {
  info: CapabilityInfo;
  plan(q: DiscoveryQuery): TilePlan[];
  fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult>;
}
export interface VerificationCapability {
  info: CapabilityInfo;
  estimate(q: ItineraryQuery): CostEstimate;
  search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult>;
}
export interface FlightProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[];
  readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability;
  readonly verification?: VerificationCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
