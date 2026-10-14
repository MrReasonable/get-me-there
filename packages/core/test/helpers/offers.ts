import type { NormaliseDeps } from '../../src/normalise/itinerary.js';
import type { RawOffer, RawSegment } from '../../src/ports/provider.js';
import type { CellKey } from '../../src/types/definition.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

/** Worked-example zones plus two clearly synthetic connection airports (AAA, BBB). */
const ZONES: Record<string, string> = {
  LHR: 'Europe/London',
  LGW: 'Europe/London',
  JFK: 'America/New_York',
  EWR: 'America/New_York',
  AAA: 'Atlantic/Reykjavik',
  BBB: 'Atlantic/Reykjavik',
};

/** WP0's brand mint, so a fixture cannot hold a code the real schema rejects. */
export const iata = asIata;

export function deps(over: Partial<NormaliseDeps> = {}): NormaliseDeps {
  return {
    providerId: 'searchapi',
    tzOf: (a) => ZONES[a] ?? null,
    rateFor: (c) =>
      c === 'CNY'
        ? { rateNano: 104_300_000, rateDate: asIsoDate('2027-03-01'), source: 'frankfurter' }
        : null,
    cabin: 'economy',
    ...over,
  };
}

export function seg(
  over: Partial<RawSegment> & Pick<RawSegment, 'from' | 'to' | 'depart' | 'arrive'>,
): RawSegment {
  return { marketingCarrier: 'VS', flightNumber: '938', timeKind: 'local', ...over };
}

/** LHR→JFK 14 Mar 2027 10:05–13:05 local, JFK→LHR 28 Mar 2027 18:30 → 29 Mar 06:40 local; £412 at one seller. */
export function offer(over: Partial<RawOffer> = {}): RawOffer {
  return {
    outbound: [
      seg({ from: iata('LHR'), to: iata('JFK'), depart: '2027-03-14T10:05', arrive: '2027-03-14T13:05' }),
    ],
    inbound: [
      seg({
        flightNumber: '939',
        from: iata('JFK'),
        to: iata('LHR'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ],
    seller: 'Virgin Atlantic',
    requestedCabin: 'economy',
    amountMinor: 41_200,
    currency: 'GBP',
    booking: { kind: 'none' },
    ...over,
  };
}

/** A cell from plain strings, minted through WP0's helpers. */
export function cellKey(
  origin: string,
  destination: string,
  departureDate: string,
  returnDate: string,
): CellKey {
  return {
    origin: asIata(origin),
    destination: asIata(destination),
    departureDate: asIsoDate(departureDate),
    returnDate: asIsoDate(returnDate),
  };
}

/**
 * The cell a raw offer was returned for, read from its first outbound segment, last outbound
 * segment and first inbound segment as written. Tests that check the cell guard pass a different
 * cell explicitly; the local and UTC inputs used here fall on the same calendar day in both zones.
 */
export function cellOf(raw: RawOffer): CellKey {
  const first = raw.outbound[0];
  const last = raw.outbound.at(-1);
  const back = raw.inbound[0];
  return cellKey(
    first?.from ?? 'LHR',
    last?.to ?? 'JFK',
    first?.depart.slice(0, 10) ?? '2027-03-14',
    back?.depart.slice(0, 10) ?? '2027-03-28',
  );
}
