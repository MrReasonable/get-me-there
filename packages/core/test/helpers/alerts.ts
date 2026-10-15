import { normaliseOffer } from '../../src/normalise/itinerary.js';
import type { AlertRule, CalendarCandidate, PriorFiring, VerifiedCandidate } from '../../src/types/alerts.js';
import type { Cell } from '../../src/types/definition.js';
import { asIsoDateTime, type IsoDateTime, isoDateTimeOfEpochMs } from '../../src/types/ids.js';
import type { Observation } from '../../src/types/itinerary.js';
import type { Cabin, Provenance, ProviderId } from '../../src/types/provenance.js';
import { cellKey, cellOf, deps, offer } from './offers.js';

export const NOW = asIsoDateTime('2027-03-01T12:00:00.000Z');

/** `evaluateAlertRules`' context (spelled out so this helper compiles before Task 2.10 exists). */
export const CTX: {
  now: IsoDateTime;
  executionId: string;
  cabin: Cabin;
  discoveryRefreshHours: Partial<Record<ProviderId, number>>;
} = { now: NOW, executionId: 'ex-2', cabin: 'economy', discoveryRefreshHours: {} };

/** The instant `h` hours before NOW (negative = in the future). */
export const hoursAgo = (h: number): IsoDateTime => isoDateTimeOfEpochMs(Date.parse(NOW) - h * 3_600_000);

/** The instant `h` hours before `at`. */
export const hoursBefore = (at: IsoDateTime, h: number): IsoDateTime =>
  isoDateTimeOfEpochMs(Date.parse(at) - h * 3_600_000);

export function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'r1',
    definitionId: 'd1',
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'verified',
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
    ...over,
  };
}

/** LHR→JFK departing 2027-03-`day`, `nights` later. */
export function cell(day = 14, nights = 14): Cell {
  const dep = `2027-03-${String(day).padStart(2, '0')}`;
  const ret = new Date(Date.parse(dep) + nights * 86_400_000).toISOString().slice(0, 10);
  return { ...cellKey('LHR', 'JFK', dep, ret), nights };
}

const verifiedProv: Provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: hoursAgo(5),
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};
const calendarProv: Provenance = {
  providerId: 'travelpayouts',
  sourceKind: 'authorised-cached',
  fetchedAt: hoursAgo(2),
  maxAgeHours: 48,
  fx: { converted: false },
  pointOfSale: 'unknown',
  cabin: 'economy',
};

/** The worked-example itinerary from `offers.ts`, normalised once (LHR→JFK 14–28 Mar 2027). */
function normalised() {
  const raw = offer();
  const r = normaliseOffer(raw, cellOf(raw), deps());
  if (!r.ok) throw r.error;
  return r;
}
const NORMALISED = normalised();

type VOver = Partial<Omit<VerifiedCandidate, 'observation'>> & {
  observation?: Partial<Omit<Observation, 'provenance'>> & { provenance?: Partial<Provenance> };
  hash?: string;
};

export function verified(over: VOver = {}): VerifiedCandidate {
  const { observation, hash, ...rest } = over;
  const { provenance, ...obs } = observation ?? {};
  return {
    basis: 'verified',
    observation: {
      ...NORMALISED.observation,
      id: 1,
      offerId: 1,
      executionId: 'ex-2',
      suppliedFields: ['segments', 'segmentTimes', 'price', 'seller'],
      partialExpansion: false,
      ...obs,
      provenance: { ...verifiedProv, ...provenance },
    },
    itinerary: { ...NORMALISED.itinerary, hash: hash ?? 'h1' },
    verdictClass: 'verified',
    unverified: [],
    seller: 'Virgin Atlantic',
    previous: null,
    ...rest,
  };
}

type COver = Partial<Omit<CalendarCandidate, 'provenance'>> & { provenance?: Partial<Provenance> };

export function calendar(over: COver = {}): CalendarCandidate {
  const { provenance, ...rest } = over;
  return {
    basis: 'calendar',
    calendarPriceId: 1,
    fetchedByExecutionId: 'ex-2',
    cell: cell(),
    pricePence: 41_200,
    previous: null,
    ...rest,
    provenance: { ...calendarProv, ...provenance },
  };
}

export function prior(over: Partial<PriorFiring> = {}): PriorFiring {
  return { identityKey: 'r1|h1', dedupKey: 'r1|h1|412', pricePence: 41_200, firedAt: hoursAgo(24), ...over };
}
