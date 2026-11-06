import type { StopDetail } from '../api-contract/stopCause.js';
import type { GridMove } from '../camoufox/protocol.js';
import type { ProviderError } from '../errors.js';
import type { FlightLimits } from '../flights/choose.js';
import type { ReturnRead } from '../flights/returns.js';
import type { Listed, ListedFlight } from '../flights/types.js';
import type { CellKey } from '../types/definition.js';
import type { ErrorReason } from '../types/execution.js';
import type { Iata, IsoDate, IsoDateTime, IsoMonth } from '../types/ids.js';
import type { BaggageSnapshot, FareConditions, SuppliedField } from '../types/itinerary.js';
import type {
  Cabin,
  PointOfSale,
  ProviderId,
  ReturnDateSource,
  SourceKind,
  VendorPriceMark,
} from '../types/provenance.js';

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
  /**
   * Ruling 17 (pie-007): true when `maxAgeHours` is the app's own assumption about an undocumented vendor cache, not a
   * bound the vendor states; the Providers view then words it "assumed ≤24h (undocumented)". Absent means stated.
   */
  maxAgeAssumed?: boolean | undefined;
  /** Spec §2 rev 34: where this capability's return dates come from, when it names its own source label by it. */
  returnDateSource?: ReturnDateSource | undefined;
}

/**
 * Spec §5.1 rev 32, revision 55 §8.1, §2 "Airport names": the airports dataset's names for a cell's two codes, which a
 * provider that matches airports by name (camoufox reads names, never codes) uses to tell a cell's options apart, and
 * the names of the search's other chosen airports on each side, one list an airport, so an option is matched among the
 * airports the operator chose ("London (all)": every London airport chosen). Discovery's query carries it, and the
 * flight-list read's query (Task 20.7) carries the same shape.
 */
export interface CellAirportNames {
  origin: string[];
  destination: string[];
  otherOrigins: string[][];
  otherDestinations: string[][];
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
  /**
   * Spec §5.1 rev 32: the airports dataset's names for the query's codes, set by the engine for every query, so a
   * provider that matches airports by name (camoufox reads names, never codes) can tell this cell's options apart.
   */
  airportNames?: CellAirportNames;
  /**
   * Spec §2 rev 34: how many pairs the stage plans for this provider, set by the engine, so a provider whose caps are
   * per run (camoufox grid pages and scrolls) gives each pair its share. Absent: one pair.
   */
  share?: { pairs: number };
}
/** Vendor-neutral, typed tile requests; `month` is the Travelpayouts tile. */
export type TileRequest =
  | { kind: 'month'; month: IsoMonth }
  | { kind: 'length-month'; length: number; month: IsoMonth }
  | { kind: 'month-pair'; departMonth: IsoMonth; returnMonth: IsoMonth }
  | { kind: 'rectangle'; departFrom: IsoDate; departTo: IsoDate; returnFrom: IsoDate; returnTo: IsoDate }
  /**
   * Spec §2 rev 34 (camoufox grid): one page: its first block's centre as the query, its scroll moves, and which views
   * are read (`reads[0]` the first view, `reads[i + 1]` the view after `moves[i]`).
   */
  | {
      kind: 'grid-path';
      start: { departureDate: IsoDate; returnDate: IsoDate };
      moves: GridMove[];
      reads: boolean[];
      /** The probe page past the planning horizon: its no-flights answer is the sale window's end (ruling on N1). */
      probe?: true;
    };
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
  /** Where the return date came from (spec §7 rev 34); every adapter states it. */
  returnDateSource: ReturnDateSource;
  /** The vendor's own mark, or null where the vendor states no marks (PA-08); never this app's minimum. */
  vendorPriceMark: VendorPriceMark | null;
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
  /**
   * Decision 83: called once the provider's rate limiter admits a call and immediately before the request is sent (a
   * browser page's real start, however long it waited for its slot). Throwing AbortedError from it abandons the call
   * before anything is reserved or sent; the engine passes it only for browser pages.
   */
  beforeSend?: () => void;
}

export interface CostEstimate {
  calls: number;
  costMicroGbp: number;
  seconds: number;
  notes: string[];
}
/**
 * Spec §5.1 rev 32: an unledgered check before a stage plans tiles (camoufox reads its worker's `/v1/status`). A refusal
 * skips every cell of the provider in the stage with `skip` as the reason and `detail` in `last_error`; `until` is the
 * end of a cool-down, which keys the once-per-cool-down notice. Revision 55 §8.1 "Stop causes": `reason` is the refusal's
 * class word, the only part of it a stop cause stores (`detail` is the provider's own sentence, kept in `last_error` and
 * the log); a provider that states none is classed by the engine from `skip` and `until`.
 */
export type PreflightResult = (
  | { ok: true }
  | {
      ok: false;
      skip: 'provider_disabled' | 'provider_unavailable';
      detail: string;
      until?: IsoDateTime;
      reason?: StopDetail;
    }
) & {
  /**
   * Spec rev 56 §5.1, §8.1: camoufox: the worker's reported verification flags, on every read that returned a status
   * (ok or refused); the engine keeps them per provider and plans the return phase from them.
   */
  flags?: Readonly<Record<string, boolean>>;
};
export interface DiscoveryCapability {
  info: CapabilityInfo;
  plan(q: DiscoveryQuery): TilePlan[];
  /**
   * Spec §2 rev 34 (CB-3; fix round 1, CA 5): a provider whose tiles are timed per tile (camoufox grid pages: the page
   * time and each scroll's) states each tile's scrolls and seconds; the engine's estimate reads them from here.
   */
  estimateTile?(plan: TilePlan): { scrolls: number; seconds: number };
  /**
   * Fix round 2 (ruling 1): the engine takes the pairs' tiles in turn (round-robin) rather than pair by pair, so a run
   * capped in pages spreads them across every pair (camoufox grid mode).
   */
  interleavePairs?: true;
  fetchTile(plan: TilePlan, q: DiscoveryQuery, ctx: ProviderContext): Promise<DiscoveryTileResult>;
  /** Optional, unledgered (spec §5.1 rev 32); absent for every provider but camoufox. */
  preflight?(ctx: ProviderContext): Promise<PreflightResult>;
}
export interface VerificationCapability {
  info: CapabilityInfo;
  estimate(q: ItineraryQuery): CostEstimate;
  search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult>;
}
/**
 * Spec revision 55 §2 "The flight-list read" and §5.1: one cell's flight list, economy only (the capability's `cabins`),
 * read in the adapter's own point of sale. The engine fills `airportNames` with `cellAirportNames`, from the cell's codes
 * and the search's chosen airports.
 */
export interface FlightListQuery {
  cell: CellKey;
  airportNames: CellAirportNames;
  /**
   * Spec rev 56 §5.1: the search's limits (`flightLimitsOf`, §6.2), sent only when the plan reads returns; absent or null:
   * no return phase. Optional for good (ruling A4: an input, absent ≡ null).
   */
  returnLimits?: FlightLimits | null;
  /** Spec rev 56 §5.1: read the shown pairing's booking options; sent only with `returnLimits`; absent read as false. */
  booking?: boolean;
}
/**
 * What the read gave (spec rev 55 §5.1): the list (`listed`, the 30 cheapest flights in page order, the page's own
 * minimum, Cheapest-tab price, view read and option counts), or the error that stopped it. A query without airport
 * names fails closed (`parse`, reason `no-airport-names`) before any request; a page cap is thrown as BudgetExceeded,
 * as `fetchTile` throws it.
 */
export type FlightListResult =
  | {
      kind: 'list';
      fetchedAt: IsoDateTime;
      pointOfSale: PointOfSale;
      listed: Listed;
      flights: ListedFlight[];
      minMinor: number | null;
      tabMinor: number | null;
      cheapestView: 'cheapest' | 'best-fallback' | null;
      optionsUnparsed: number;
      optionsOtherCell: number;
      resultsStated: number | null;
      notes: string[];
      /**
       * Spec rev 56 §5.1: the worker's return read, null when the request had no return phase (or an older worker
       * answered without one). Required since Task 21.6 (R-order: the engine stores it).
       */
      returns: ReturnRead | null;
      // why: final review A-M3: the answer's `nextLoadNotBefore` is not here: http-kit holds the next camoufox start
      // from it inside the attempt (`nextStartOf`), and nothing past the provider reads it; `pagesLoaded` reaches only
      // the ledger (arch-r3-014)
    }
  | { kind: 'list-error'; error: ProviderError };
/**
 * Spec rev 55 §5.1: the browser worker's flight lists (camoufox only; its preflight is discovery's). `cabins` are the
 * cabins it reads (prov-int-002: economy only), so a non-economy search's flights are `not_available` with reason
 * `cabin` before any page.
 */
export interface FlightListCapability {
  info: CapabilityInfo;
  cabins: readonly Cabin[];
  read(q: FlightListQuery, ctx: ProviderContext): Promise<FlightListResult>;
}
/**
 * Spec §2 "The keep-awake lease" (camoufox only): asks the browser worker to hold the machine's idle sleep off. `hold`
 * starts or renews a lease of `seconds` from now; `release` ends it. Neither ever throws: a worker that cannot be
 * reached, or refuses, is logged at warn, and the run goes on (the lease then runs out on its own).
 */
export interface KeepAwakeCapability {
  hold(seconds: number, signal: AbortSignal): Promise<void>;
  release(signal: AbortSignal): Promise<void>;
}
export interface FlightProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly suppliedFields: readonly SuppliedField[];
  readonly cabins: readonly Cabin[];
  readonly discovery?: DiscoveryCapability;
  readonly verification?: VerificationCapability;
  /** Spec rev 55 §5.1: camoufox only. */
  readonly flightLists?: FlightListCapability;
  /** Spec §2 "The keep-awake lease": camoufox only; the engine holds it while any run is in progress. */
  readonly keepAwake?: KeepAwakeCapability;
  healthcheck(ctx: ProviderContext): Promise<{ ok: boolean; detail: string }>;
}
