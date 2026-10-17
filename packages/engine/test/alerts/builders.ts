/** Hand-built digest items for template and notifier tests (no database). Worked example only. */
import {
  type AlertDigest,
  type AlertRule,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type DigestItem,
} from '@gmt/core';
import type { DigestRenderInput } from '../../src/alerts/templates.js';

export const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
export const HASH = 'a'.repeat(64);
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const CELL = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2027-03-14'),
  returnDate: asIsoDate('2027-03-28'),
  nights: 14,
};
const SEARCH = {
  url: 'https://www.google.com/travel/flights?q=LHR+JFK+2027-03-14+2027-03-28',
  host: 'www.google.com',
  label: 'search link, not a fare link',
};

/** A SearchApi itinerary-search item: maxAgeHours 'unknown' (spec rev 15, decision 24), one constraint unverified. */
export function verifiedItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 41200,
    cell: CELL,
    verdictClass: 'partially-verified',
    itineraryHash: HASH,
    seller: 'British Airways',
    unverified: ['checkedBagRequired'],
    provenance: {
      providerId: 'searchapi',
      sourceKind: 'scraped-search',
      fetchedAt: asIsoDateTime('2026-10-14T10:00:00.000Z'),
      maxAgeHours: 'unknown',
      fx: { converted: false },
      pointOfSale: 'GB',
      cabin: 'economy',
    },
    previousPricePence: null,
    fetchGapHours: null,
    isNew: false,
    firingReason: '£412 is at or below the £450 threshold',
    booking: { kind: 'get', url: 'https://www.google.com/travel/clk?tfs=abc', host: 'www.google.com' },
    searchLink: SEARCH,
    bookingExpiresAt: asIsoDateTime('2026-10-14T18:00:00.000Z'),
    rowKey: HASH,
    outbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: 117,
        from: LHR,
        to: JFK,
        departLocal: '2027-03-14T08:25',
        arriveLocal: '2027-03-14T11:20',
        durationMinutes: 475,
      },
    ],
    inbound: [
      {
        marketingCarrier: 'BA',
        flightNumber: 112,
        from: JFK,
        to: LHR,
        departLocal: '2027-03-28T18:30',
        arriveLocal: '2027-03-29T06:35',
        durationMinutes: 425,
      },
    ],
    ...over,
  };
}

// why: maxAgeHours 168 reproduces the spec §8.3 example text "(≤7d before that)"; Travelpayouts itself declares 48 (spec §2).
export function calendarItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    pricePence: 38900,
    cell: CELL,
    verdictClass: 'unchecked',
    itineraryHash: null,
    seller: null,
    unverified: [],
    provenance: {
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
      maxAgeHours: 168,
      fx: { converted: false },
      pointOfSale: 'unknown',
      cabin: 'economy',
    },
    previousPricePence: null,
    fetchGapHours: null,
    isNew: false,
    firingReason: '£389 is at or below the £450 threshold',
    booking: { kind: 'none' },
    searchLink: {
      url: 'https://www.aviasales.com/search/LON1403NYC28031',
      host: 'www.aviasales.com',
      label: 'search link, not a fare link',
    },
    bookingExpiresAt: null,
    outbound: null,
    inbound: null,
    rowKey: 'calendar:5',
    ...over,
  };
}

export const RULE: AlertRule = {
  id: 'rule-1',
  definitionId: 'def-1',
  type: 'absolute',
  thresholdPence: 45000,
  pct: null,
  basis: 'verified',
  requireAllVerified: false,
  cooldownHours: 336,
  enabled: true,
};

export function digestOf(items: DigestItem[], over: Partial<AlertDigest> = {}): AlertDigest {
  return {
    ruleId: RULE.id,
    definitionId: 'def-1',
    executionId: 'ex-1',
    basis: 'verified',
    items,
    restCount: 0,
    newItems: [],
    newRestCount: 0,
    coverageCaveat: { itinerarySearched: 3, selected: 10, expandTop: 2 },
    rule: RULE,
    ...over,
  };
}

export function renderInput(over: Partial<DigestRenderInput> = {}): DigestRenderInput {
  return {
    digest: digestOf([verifiedItem()]),
    definitionName: 'London to New York (worked example)',
    appBaseUrl: null,
    now: NOW,
    ...over,
  };
}
