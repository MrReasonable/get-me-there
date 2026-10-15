import { describe, expect, it } from 'vitest';
import { buildDigest } from '../../src/alerts/digest.js';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import type { Firing } from '../../src/types/alerts.js';
import { asIsoDateTime } from '../../src/types/ids.js';
import { CTX, calendar, cell, hoursAgo, rule, verified } from '../helpers/alerts.js';

const cal = rule({ basis: 'calendar', requireAllVerified: null });
const drop = rule({ basis: 'calendar', type: 'dropAbs', thresholdPence: 1_000, requireAllVerified: null });
const DCTX = {
  executionId: 'ex-2',
  definitionId: 'd1',
  coverageCaveat: { itinerarySearched: 9, selected: 10, expandTop: 2 },
};

/** A fixed permutation of 0…n-1 (multiplier coprime with 50), so input order is not price order. */
const shuffled = (n: number) => Array.from({ length: n }, (_, i) => (i * 17) % n);

describe('buildDigest (spec §6.8)', () => {
  it('50 qualifying cells in shuffled order → one digest listing the cheapest 10 ascending and counting the other 40', () => {
    const candidates = shuffled(50).map((i) =>
      calendar({
        calendarPriceId: i + 1,
        cell: cell(1 + (i % 28), 10 + Math.floor(i / 28)),
        pricePence: 30_000 + i * 100,
      }),
    );
    const firings = evaluateAlertRules([cal], candidates, [], CTX);
    expect(firings).toHaveLength(50);
    const d = buildDigest(cal, firings.toReversed(), DCTX);
    expect(d?.items.map((i) => i.pricePence)).toEqual(Array.from({ length: 10 }, (_, i) => 30_000 + i * 100));
    expect(d).toMatchObject({
      ruleId: 'r1',
      definitionId: 'd1',
      executionId: 'ex-2',
      basis: 'calendar',
      restCount: 40,
      newItems: [],
      newRestCount: 0,
      coverageCaveat: DCTX.coverageCaveat,
      rule: cal,
    });
  });

  it('more than 10 firings and more than 10 new cells: separate caps and separate rest counts (review po-002, pft-011)', () => {
    const dropping = shuffled(13).map((i) =>
      calendar({
        calendarPriceId: i + 1,
        cell: cell(1 + i),
        pricePence: 30_000 + i * 100,
        previous: { pricePence: 45_000, fetchedAt: hoursAgo(30) },
      }),
    );
    const fresh = shuffled(12).map((i) =>
      calendar({ calendarPriceId: 100 + i, cell: cell(1 + i, 20), pricePence: 31_000 + i * 100 }),
    );
    // reversed, so both lists must be sorted inside buildDigest (review test-r2-006)
    const d = buildDigest(
      drop,
      evaluateAlertRules([drop], [...fresh, ...dropping], [], CTX).toReversed(),
      DCTX,
    );
    expect(d?.items).toHaveLength(10);
    expect(d?.restCount).toBe(3);
    expect(d?.newItems).toHaveLength(10);
    expect(d?.newRestCount).toBe(2);
    expect(d?.newItems.map((i) => i.pricePence)).toEqual(
      Array.from({ length: 10 }, (_, i) => 31_000 + i * 100),
    );
  });

  it('a verified item carries the itinerary, segments, seller, unverified names, booking, expiry, row key and its provenance', () => {
    const r = rule({ requireAllVerified: false });
    const firings = evaluateAlertRules(
      [r],
      [
        verified({
          verdictClass: 'partially-verified',
          unverified: ['checkedBagRequired'],
          observation: {
            booking: { kind: 'get', url: 'https://www.google.com/b', host: 'www.google.com' },
            bookingExpiresAt: asIsoDateTime('2027-03-01T13:00:00.000Z'),
          },
        }),
      ],
      [],
      CTX,
    );
    const item = buildDigest(r, firings, DCTX)?.items[0];
    expect(item).toMatchObject({
      pricePence: 41_200,
      itineraryHash: 'h1',
      seller: 'Virgin Atlantic',
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previousPricePence: null,
      previousAgeHours: null,
      isNew: false,
      firingReason: '£412 is at or below the £450 threshold',
      booking: { kind: 'get', host: 'www.google.com' },
      bookingExpiresAt: '2027-03-01T13:00:00.000Z',
      rowKey: 'h1',
      cell: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-28',
        nights: 14,
      },
      provenance: { providerId: 'searchapi', fetchedAt: hoursAgo(5), maxAgeHours: 0 },
    });
    expect(item?.searchLink).toMatchObject({ host: 'www.google.com', label: 'search link, not a fare link' });
    expect(item?.outbound?.map((s) => `${s.marketingCarrier}${s.flightNumber}`)).toEqual(['VS938']);
    expect(item?.inbound?.map((s) => s.departLocal)).toEqual(['2027-03-28T18:30']);
  });

  it('an absolute firing does not show a previous price its reason does not state', () => {
    const c = verified({ previous: { pricePence: 50_000, fetchedAt: hoursAgo(30) } });
    const item = buildDigest(rule(), evaluateAlertRules([rule()], [c], [], CTX), DCTX)?.items[0];
    expect(item).toMatchObject({ previousPricePence: null, previousAgeHours: null });
  });

  it('a calendar drop item carries the previous price and its age at this fetch, the current provenance, no booking, an Aviasales link', () => {
    const c = calendar({
      pricePence: 38_000,
      provenance: { fetchedAt: hoursAgo(2), providerObservedAt: hoursAgo(80) },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(50) },
    });
    const item = buildDigest(drop, evaluateAlertRules([drop], [c], [], CTX), DCTX)?.items[0];
    expect(item).toMatchObject({
      verdictClass: 'unchecked',
      itineraryHash: null,
      seller: null,
      unverified: [],
      previousPricePence: 45_000,
      previousAgeHours: 48,
      firingReason: 'down £70 (15%) from £450 fetched 48h earlier',
      booking: { kind: 'none' },
      bookingExpiresAt: null,
      outbound: null,
      inbound: null,
      rowKey: 'calendar:1',
      // WP11 renders the current price's effective age from this provenance (review pft-005)
      provenance: {
        providerId: 'travelpayouts',
        fetchedAt: hoursAgo(2),
        providerObservedAt: hoursAgo(80),
        maxAgeHours: 48,
      },
    });
    expect(item?.searchLink?.host).toBe('search.aviasales.com');
  });

  it('new cells go to newItems; the previous price shows only when the reason states it; new cells alone send nothing', () => {
    expect(buildDigest(drop, evaluateAlertRules([drop], [calendar()], [], CTX), DCTX)).toBeNull();
    const mixed = evaluateAlertRules(
      [drop],
      [
        calendar({ calendarPriceId: 1 }),
        calendar({
          calendarPriceId: 2,
          cell: cell(18),
          pricePence: 42_000,
          previous: { pricePence: 50_000, fetchedAt: hoursAgo(500) },
        }),
        calendar({
          calendarPriceId: 3,
          cell: cell(20),
          pricePence: 30_000,
          previous: { pricePence: 40_000, fetchedAt: hoursAgo(10) },
        }),
      ],
      [],
      CTX,
    );
    const d = buildDigest(drop, mixed.toReversed(), DCTX);
    expect(d?.items.map((i) => i.rowKey)).toEqual(['calendar:3']);
    expect(
      d?.newItems.map((i) => [i.rowKey, i.isNew, i.previousPricePence, i.previousAgeHours, i.firingReason]),
    ).toEqual([
      ['calendar:1', true, null, null, 'first price seen for this cell'],
      [
        'calendar:2',
        true,
        50_000,
        498,
        'last price £500 was fetched 498h earlier, outside the 336h comparison window; not compared',
      ],
    ]);
    expect(d?.restCount).toBe(0);
    expect(d?.newRestCount).toBe(0);
  });

  it('suppressed firings are left out of the digest; all suppressed sends nothing', () => {
    const firings = evaluateAlertRules(
      [cal],
      [calendar(), calendar({ cell: cell(16), pricePence: 40_000 })],
      [],
      CTX,
    );
    // firings are price-ascending, so index 0 is the £400 cell
    const muted: Firing[] = firings.map((f, i) =>
      i === 0 ? { ...f, suppressed: { reason: 'cooldown' } } : f,
    );
    expect(buildDigest(cal, muted, DCTX)?.items.map((i) => i.pricePence)).toEqual([41_200]);
    expect(
      buildDigest(
        cal,
        muted.map((f) => ({ ...f, suppressed: { reason: 'cooldown' } })),
        DCTX,
      ),
    ).toBeNull();
  });

  it('only the digest rule’s own firings are used', () => {
    const r2 = rule({ id: 'r2' });
    const firings = evaluateAlertRules([rule(), r2], [verified()], [], CTX);
    expect(firings).toHaveLength(2);
    expect(buildDigest(r2, firings, DCTX)?.items).toHaveLength(1);
  });

  it('refuses synthetic rows', () => {
    const [f] = evaluateAlertRules([cal], [calendar()], [], CTX);
    expect(f).toBeDefined();
    if (f === undefined) return;
    const synthetic: Firing = {
      ...f,
      candidate: calendar({ provenance: { providerId: 'fixture', sourceKind: 'synthetic' } }),
    };
    expect(() => buildDigest(cal, [synthetic], DCTX)).toThrow(/synthetic/);
  });
});
