import type {
  Cabin,
  Cell,
  CellKey,
  CellOutcome,
  DefinitionSnapshot,
  Estimate,
  Execution,
  ExecutionStatus,
  FxInfo,
  HistoryPoint,
  Iata,
  IsoDate,
  IsoDateTime,
  Listed,
  ListedFlight,
  NormalisedItinerary,
  Observation,
  ObservationFields,
  Offer,
  PointOfSale,
  Provenance,
  ProviderId,
  ReturnDateSource,
  ReturnRead,
  SkipCode,
  SourceKind,
  StopCause,
  StopDetail,
  SuppliedField,
  VendorPriceMark,
} from '@gmt/core';

/** OurAirports' size class of an airport (spec §7, revision 51). */
export type AirportKind = 'large' | 'medium' | 'small' | 'other';
export const AIRPORT_KINDS: readonly AirportKind[] = ['large', 'medium', 'small', 'other'];

/** Spec §7 `airports` row. */
export interface Airport {
  iata: Iata;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  tz: string;
  lat: number;
  lon: number;
  metro: string | null;
  /** OurAirports' size class; null for an airport OurAirports does not list. */
  kind: AirportKind | null;
  /** OurAirports' scheduled service; null when unknown. An airport with none is left out of search suggestions. */
  scheduled: boolean | null;
  source: string;
  datasetVersion: string;
}
/** The vendored airports dataset plus the attributed metro-code list (decision 11). */
export interface AirportsDataset {
  version: string;
  /** `kind` and `scheduled` may be left out (unknown), as for a dataset built without the OurAirports facts. */
  airports: Array<
    Omit<Airport, 'source' | 'datasetVersion' | 'kind' | 'scheduled'> &
      Partial<Pick<Airport, 'kind' | 'scheduled'>>
  >;
  metros: Record<string, string[]>;
}
/** Repositories refuse synthetic rows unless this is true (`syntheticAllowed(config)`, spec §5.5). */
export interface RepoOptions {
  allowSynthetic: boolean;
}
export type ExecutionCreateInput = {
  definitionId: string;
  isChild: boolean;
  cell: CellKey | null;
  snapshot: DefinitionSnapshot;
  estimate: Estimate | null;
  trigger: Execution['trigger'];
  status: 'pending' | 'running' | (ExecutionStatus & `skipped_${string}`);
  /** Spec §7 rev 36: set only through `createForFiring`, which inserts through the firing unique index. */
  scheduledFor?: IsoDateTime | null;
  isCatchUp?: boolean;
  /** Decision 83: the run's browser window end, written by the start transaction. */
  browserWindowEnd?: IsoDateTime | null;
  /** Spec §8.2: only on a `skipped_missed` row. */
  skipCode?: SkipCode | null;
  /**
   * Spec revision 55 §8.1 "Stop causes": a `skipped_*` row is written with its cause and that cause's sentence (the
   * scheduler's skips); a pending or running row carries none.
   */
  stopCause?: StopCause | null;
  errorText?: string | null;
};
export type ExecutionPatch = Partial<
  Pick<
    Execution,
    | 'stage'
    | 'resumeAfter'
    | 'errorText'
    | 'startedAt'
    | 'finishedAt'
    | 'cancelRequested'
    | 'estimate'
    | 'snapshot'
    | 'browserWindowEnd'
    | 'stopCause'
    | 'flightLists'
  >
>;
/** One discovery tile's write (spec §7 atomic unit). `discards` is validated and reported by the engine, not stored. */
export interface TileWrite {
  tileIndex: number;
  cells: CellKey[];
  prices: CalendarPriceInsert[];
  outcomes: Array<
    Pick<
      CellOutcome,
      | 'origin'
      | 'destination'
      | 'departureDate'
      | 'returnDate'
      | 'status'
      | 'reason'
      | 'lastError'
      | 'fetchedAt'
      | 'minPence'
      | 'cabin'
      | 'pointOfSale'
      | 'sourceKind'
    >
  >;
  discards: number;
}
/** A calendar price to write; `maxAgeHours: null` means unknown and is written explicitly (spec §7). */
export interface CalendarPriceInsert {
  providerId: ProviderId;
  sourceKind: SourceKind;
  cabin: Cabin;
  cell: CellKey;
  pricePence: number;
  priceNativeMinor: number;
  currencyNative: string;
  fx: FxInfo;
  pointOfSale: PointOfSale;
  fetchedAt: IsoDateTime;
  providerObservedAt: IsoDateTime | null;
  maxAgeHours: number | null;
  vendorLink: string | null;
  reusedFromExecutionId: string | null;
  /** Spec §7 rev 34: where the return date came from; stated on every insert (no default). */
  returnDateSource: ReturnDateSource;
  /** The vendor's own price mark, null where the vendor states no marks. */
  vendorPriceMark: VendorPriceMark | null;
}
export interface CalendarPriceRow extends CalendarPriceInsert {
  id: number;
  executionId: string;
  provenance: Provenance;
}
/**
 * WP19 §5: the marks a calendar price is read with. `sourceLastError` is the `last_error` of the discovery outcome that
 * fetched it (through `reused_from_execution_id` for a reused copy), for truncation (decisions 36, 47);
 * `searchedEmptyLater` is true when the newest searched, non-reused discovery outcome of a parent execution for that
 * (provider, cell) is newer than the price's execution and found the cell empty or no_data (decision 54).
 */
export type CalendarMarks = { sourceLastError: string | null; searchedEmptyLater: boolean };
/** One verified cell's write (spec §7 atomic unit). best_observation_id becomes the cheapest observation written (ruling 13). */
export interface VerifiedCellWrite {
  cell: CellKey;
  outcome: TileWrite['outcomes'][number];
  itineraries: Array<{
    itinerary: NormalisedItinerary;
    offers: Array<{
      offer: Offer;
      observation: ObservationFields & {
        provenance: Provenance;
        suppliedFields: SuppliedField[];
        partialExpansion: boolean;
      };
    }>;
  }>;
}
/** A reuse source for one cell (spec §8.1 reuse). `price` is null for empty and no_data outcomes. */
/** The spec §8.1 reuse criteria the engine passes to reuseCandidates, re-checked by copyReused (prov-M3); cabin comes from the snapshot. */
export interface ReuseCriteria {
  pointOfSale: PointOfSale;
  sourceKind: SourceKind;
  newerThan: IsoDateTime;
}
export interface ReusedCopy {
  cell: CellKey;
  outcome: CellOutcome;
  price: CalendarPriceRow | null;
}
export interface ObservationRow extends Observation {
  offer: Offer & { id: number };
  itinerary: NormalisedItinerary;
  cell: Cell;
  seller: string;
}
/**
 * One `offerHistory` point: the stored history point plus the observation's supplied fields (plan decision 42) and the
 * execution that wrote it (decision 52: History joins only consecutive runs).
 */
export interface OfferHistoryPoint extends HistoryPoint {
  suppliedFields: SuppliedField[];
  executionId: string;
}

/**
 * Spec revision 55 §7 `flight_lists`: one flight-list page to store. `providerId` and `sourceKind` are carried so the
 * repository can refuse a fixture or synthetic list by name (data-002); only `camoufox` / `scraped-self` is written. A
 * `read` list has a `listed` word and no reason; a `failed` one has a `reason` and neither a `listed` word nor flights.
 */
export interface FlightListInsert {
  definitionId: string;
  /** NULL for an on-demand read (spec §8.1). */
  executionId: string | null;
  providerId: ProviderId;
  sourceKind: SourceKind;
  cabin: Cabin;
  origin: Iata;
  destination: Iata;
  departureDate: IsoDate;
  returnDate: IsoDate;
  fetchedAt: IsoDateTime;
  pointOfSale: PointOfSale;
  status: 'read' | 'failed';
  reason: StopDetail | null;
  listed: Listed | null;
  minMinor: number | null;
  tabMinor: number | null;
  cheapestView: 'cheapest' | 'best-fallback' | null;
  optionsUnparsed: number;
  optionsOtherCell: number;
  resultsStated: number | null;
  /** In page order; at most `FLIGHT_LIST_MAX_FLIGHTS`. */
  flights: ListedFlight[];
  /**
   * Spec revision 56 §5.1, §7: the return read the worker answered with (its attempts, returns and the booking read of
   * the shown pairing, with its offers), parsed through core's `returnReadSchema` on insert; null (or absent) for a
   * list read without a return phase, and always for a `failed` list. Optional until Task 21.6 (the engine's flight
   * step and the on-demand read, its last producers), so every consumer builds alone (R-order).
   */
  returns?: ReturnRead | null;
}

/**
 * A stored flight list with its flights in page order (spec rev 55 §7) and its return read (spec rev 56 §7; null for a
 * list read without one, and for every list stored before migration 0012); the API adds the age, stale mark and
 * provenance.
 */
export interface StoredFlightList extends FlightListInsert {
  id: number;
  returns: ReturnRead | null;
}

/**
 * Spec revision 56 §7, §8.1 (R-retry): how many of a cell's two newest lists ended with a transient return or booking
 * status (core's `RETURN_TRANSIENT`, `BOOKING_TRANSIENT`), newest first, stopping at the first that did not: 2 means
 * the pair was read again once and ended transient again, so the step reuses it as finished until its refresh.
 */
export type TransientStreak = 0 | 1 | 2;

/** The newest list of a cell as the reads return it (spec rev 56 §7; preflight A25): the list and its streak. */
export type NewestFlightList = StoredFlightList & { transientStreak: TransientStreak };
