import { z } from 'zod';
import { type Iata, type IsoDate, type IsoDateTime, iataSchema, isoDateSchema } from './ids.js';
import type { Cabin, ProviderId } from './provenance.js';

/** Spec §6.1: absolute `{ from, to }` or relative `{ startOffsetDays ≥ 1, lengthDays }` windows. */
export type WindowSpec =
  | { kind: 'absolute'; from: IsoDate; to: IsoDate }
  | { kind: 'relative'; startOffsetDays: number; lengthDays: number };

/** The resolved space an execution runs over; frozen into the snapshot. */
export interface ResolvedSpace {
  origins: Iata[];
  destinations: Iata[];
  departureFrom: IsoDate;
  departureTo: IsoDate;
  minNights: number;
  maxNights: number;
}

/** Spec §3: the atomic unit of coverage. The ONLY definition; ports/provider.ts imports it. */
export interface CellKey {
  origin: Iata;
  destination: Iata;
  departureDate: IsoDate;
  returnDate: IsoDate;
}
export interface Cell extends CellKey {
  nights: number;
}

const cellKeyTuple = z.tuple([iataSchema, iataSchema, isoDateSchema, isoDateSchema]);

/** `O|D|dep|ret`, shared by core, db and engine so every map is keyed the same way. */
export function cellKeyString(c: CellKey): string {
  return `${c.origin}|${c.destination}|${c.departureDate}|${c.returnDate}`;
}

/** Inverse of cellKeyString; throws on a malformed string. */
export function parseCellKeyString(s: string): CellKey {
  const r = cellKeyTuple.safeParse(s.split('|'));
  if (!r.success) throw new Error(`not a cell key: ${s}`);
  const [origin, destination, departureDate, returnDate] = r.data;
  return { origin, destination, departureDate, returnDate };
}

/** HH:mm, inclusive, local to the airport. */
export type LocalTimeWindow = { from: string; to: string };

/** Spec §6.2: every constraint is optional; absent input makes its verdict `unverified`, never `pass`. */
export interface Constraints {
  maxStops?: number;
  maxJourneyMinutes?: number;
  minLayoverMinutes?: number;
  maxLayoverMinutes?: number;
  noOvernightLayover?: boolean;
  departureWindowLocal?: LocalTimeWindow;
  arrivalWindowLocal?: LocalTimeWindow;
  noSelfTransfer?: boolean;
  noAirportChange?: boolean;
  includeAirlines?: string[];
  excludeAirlines?: string[];
  cabinBagRequired?: boolean;
  checkedBagRequired?: boolean;
  minCheckedBags?: number;
  maxPricePence?: number;
}

/** Spec §6.7 policy plus the itinerary-search knobs of spec §5.4. */
export interface VerificationPolicy {
  maxCells: number;
  topN: number;
  priceCeilingPence?: number;
  perDepartureDateBest?: number;
  alwaysInclude: CellKey[];
  expandTop: number;
  bookingLinks: boolean;
  maxStops?: number;
}

/** Spec §7 `budget_json`; the per-execution caps, frozen into each execution's snapshot. */
export interface ExecutionBudget {
  maxCalls: number;
  maxFreeCalls: number;
  maxCostMicroGbp: number;
  /**
   * A provider's own page cap for this execution (camoufox, decision 69), set by the engine when the execution is
   * created and read by the budget guard from the snapshot, never from config at reserve time. Absent: no such cap.
   */
  providerMaxCalls?: Partial<Record<ProviderId, number>>;
}

export interface ProvidersConfig {
  discovery: ProviderId[];
  verification: ProviderId[];
  discoveryRefreshHours: Partial<Record<ProviderId, number>>;
}

/** Spec §3 "Search definition" and §7 `search_definitions`. */
export interface SearchDefinition {
  id: string;
  name: string;
  origins: Iata[];
  destinations: Iata[];
  window: WindowSpec;
  minNights: number;
  maxNights: number;
  cabin: Cabin;
  constraints: Constraints;
  verification: VerificationPolicy;
  budget: ExecutionBudget;
  providers: ProvidersConfig;
  destinationNotes: Partial<Record<Iata, string>>;
  onwardCostPence: Partial<Record<Iata, number>>;
  scheduleCron: string | null;
  scheduleTz: string;
  confirmedCostPence: number | null;
  /** Decision 37: the calls of the confirmed estimate, beside its pence; set only from an explicit confirmation. */
  confirmedCalls: number | null;
  enabled: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
}

/**
 * Spec revision 55 §8.1 and §8.2: a search is scheduled exactly when it is enabled, has a cron and is not deleted. The
 * engine's one schedule predicate: the tick, the scheduler's registration, boot, `finish` (read live, for the automatic
 * resume rule) and `autoResume` all ask this, so `enabled` means "scheduled runs happen" and nothing else. A type
 * guard, so a caller reads the cron of a scheduled search with no second check.
 */
export function isScheduled<T extends Pick<SearchDefinition, 'enabled' | 'scheduleCron' | 'deletedAt'>>(
  d: T,
): d is T & { scheduleCron: string } {
  return d.enabled && d.scheduleCron !== null && d.deletedAt === null;
}

export type DefinitionInput = Omit<
  SearchDefinition,
  'id' | 'confirmedCostPence' | 'confirmedCalls' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** The definition as frozen at execution start, with the resolved window. Spec §8.1. */
export type DefinitionSnapshot = SearchDefinition & {
  resolved: ResolvedSpace;
  resolvedAt: IsoDateTime;
  windowClamped: boolean;
  droppedAlwaysInclude: CellKey[];
};
