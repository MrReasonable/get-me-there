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
  Iata,
  IsoDateTime,
  NormalisedItinerary,
  Observation,
  ObservationFields,
  Offer,
  PointOfSale,
  Provenance,
  ProviderId,
  SourceKind,
  SuppliedField,
} from '@gmt/core';

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
  source: string;
  datasetVersion: string;
}
/** The vendored airports dataset plus the attributed metro-code list (decision 11). */
export interface AirportsDataset {
  version: string;
  airports: Array<Omit<Airport, 'source' | 'datasetVersion'>>;
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
}
export interface CalendarPriceRow extends CalendarPriceInsert {
  id: number;
  executionId: string;
  provenance: Provenance;
}
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
