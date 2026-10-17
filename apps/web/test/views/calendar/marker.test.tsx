import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { DayMarker, ReusedNote } from '../../../src/views/Calendar/DayMarker.js';
import {
  bucketTotal,
  countsConsistent,
  coverageOf,
  formatDiscoveryMarker,
  formatVerificationMarker,
  providersNotSearched,
  sliceOf,
  totalReused,
} from '../../../src/views/Calendar/marker.js';
import { BOTH, buckets, cellAt, day, disc, priceAt, provCalendarAt, slice } from '../../fixtures.wp10.js';
import { renderWithProviders } from '../../render.js';

describe('six-bucket day counts (spec §11 View B, §3)', () => {
  const partial = buckets({ priced: 3, empty: 1, no_data: 2, error: 1, skipped: 0, not_run: 5, reused: 2 });

  it('M is the sum of the six buckets; reused is a subset, not a seventh bucket', () => {
    expect(bucketTotal(partial)).toBe(12);
  });

  it('formats the discovery marker with the api total M', () => {
    expect(formatDiscoveryMarker(disc('travelpayouts', partial))).toBe(
      '3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
    );
  });

  it('a total that disagrees with the sum of its buckets says "counts inconsistent" (plan decision 38)', () => {
    const wrong = disc('travelpayouts', partial, 14);
    expect(countsConsistent(wrong)).toBe(false);
    expect(formatDiscoveryMarker(wrong)).toBe(
      '3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 14 · counts inconsistent',
    );
    expect(coverageOf(slice({ discovery: [wrong] }))).toEqual({ kind: 'inconsistent' });
  });

  it('formats the itinerary-search line separately, and says when no verification provider exists', () => {
    expect(
      formatVerificationMarker({ selected: 10, itinerarySearched: 1, onDemand: 2, unconfirmedCells: 0 }),
    ).toBe('itinerary-searched 1 of 10 selected +2 on demand');
    expect(formatVerificationMarker(null)).toBe('itinerary search: no verification provider configured');
  });

  it('the coverage cue names the best-covered source: searched = priced + no fares + no cached data', () => {
    const s = slice({
      discovery: [
        disc('travelpayouts', { priced: 4, no_data: 2, not_run: 42 }),
        disc('searchapi', { priced: 12, empty: 3, error: 33 }),
      ],
    });
    expect(coverageOf(s)).toMatchObject({
      kind: 'fraction',
      searched: 15,
      total: 48,
      providerId: 'searchapi',
    });
    expect(coverageOf(s)).toMatchObject({ buckets: { priced: 12, empty: 3, error: 33 } }); // the face's breakdown (ruling 4)
    expect(coverageOf(slice({ discovery: [] }))).toEqual({ kind: 'none' });
  });

  it('renders one line per provider named by its source from GET /api/providers, then the itinerary-search line', async () => {
    const { findAllByRole, getByTestId } = renderWithProviders(
      <DayMarker
        slice={slice({
          discovery: [disc('travelpayouts', partial), disc('searchapi', { priced: 12 })],
          discoveryProviders: ['travelpayouts', 'searchapi'],
          verification: { selected: 10, itinerarySearched: 1, onDemand: 2, unconfirmedCells: 0 },
        })}
      />,
    );
    const lines = await findAllByRole('listitem');
    expect(lines).toHaveLength(2);
    await expect
      .poll(() => lines[0]?.textContent)
      .toBe(
        'Aviasales cache: 3 priced · 1 no fares · 2 no cached data · 1 error · 0 skipped · 5 not searched of 12',
      );
    expect(lines[1]).toHaveTextContent(
      'Google date grid via SearchApi: 12 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 12',
    );
    expect(getByTestId('day-marker')).toHaveTextContent('itinerary-searched 1 of 10 selected +2 on demand');
  });

  it('a definition without a discovery provider says so; a configured one with no outcome rows says not searched yet', () => {
    const none = renderWithProviders(<DayMarker slice={slice({ discoveryProviders: [] })} />);
    expect(none.getByTestId('day-marker')).toHaveTextContent('no discovery provider configured');
    none.unmount();
    const noRun = renderWithProviders(<DayMarker slice={slice({ discovery: [] })} />);
    expect(noRun.getByTestId('day-marker')).toHaveTextContent('not searched yet: no run covers this day');
    expect(noRun.getByTestId('day-marker')).not.toHaveTextContent('no discovery provider configured');
  });

  it('a configured provider with no counts for the day gets its own "not searched yet" line (prov-r2-009)', async () => {
    const s = slice({
      discovery: [disc('travelpayouts', { priced: 48 })],
      discoveryProviders: ['travelpayouts', 'searchapi'],
    });
    expect(providersNotSearched(s)).toEqual(['searchapi']);
    const { findAllByRole } = renderWithProviders(<DayMarker slice={s} />);
    const lines = await findAllByRole('listitem');
    expect(lines).toHaveLength(2);
    await expect
      .poll(() => lines[1]?.textContent)
      .toBe('Google date grid via SearchApi: not searched yet for this day');
  });

  it("the unconfirmed line counts the slice's own cells, naming the destination under a filter (decision 51)", () => {
    const all = renderWithProviders(<DayMarker slice={slice({ unconfirmedCells: 2 })} />);
    expect(all.getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 2 itinerary-searched cells priced nothing the final step confirmed',
    );
    all.unmount();
    const jfk = renderWithProviders(
      <DayMarker slice={slice({ unconfirmedCells: 1, destination: asIata('JFK') })} />,
    );
    expect(jfk.getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 1 itinerary-searched JFK cell priced nothing the final step confirmed',
    );
  });

  it('a day is taken as the api computed it for the filter; the destination only names it (decision 53)', () => {
    const jfkCell = cellAt('2027-03-14', 12);
    const d = day('2027-03-14', {
      discovery: [disc('travelpayouts', { priced: 4, not_run: 20 })],
      verification: { selected: 4, itinerarySearched: 4, onDemand: 0, unconfirmedCells: 1 },
      cheapestCalendar: priceAt(41200, provCalendarAt(2), false, jfkCell),
    });
    const jfk = sliceOf(d, BOTH, asIata('JFK'));
    expect(jfk.destination).toBe('JFK');
    expect(jfk.cheapestCalendar?.cell).toEqual(jfkCell);
    expect(jfk.unconfirmedCells).toBe(1);
    expect(coverageOf(jfk)).toMatchObject({
      kind: 'fraction',
      searched: 4,
      total: 24,
      providerId: 'travelpayouts',
    });
    const off = sliceOf(d, { ...BOTH, verificationConfigured: false }, null);
    expect(off.verification).toBeNull();
    expect(off.unconfirmedCells).toBe(0);
    const { getByTestId } = renderWithProviders(<DayMarker slice={jfk} />);
    expect(getByTestId('day-marker')).toHaveTextContent('4 priced · 0 no fares');
    expect(getByTestId('day-marker')).not.toHaveTextContent('all destinations');
  });

  it('the header shows the reused count summed over days and providers, and nothing when it is zero', () => {
    const days = [
      slice({ discovery: [disc('travelpayouts', partial)] }),
      slice({
        discovery: [
          disc('travelpayouts', { priced: 4, reused: 3 }),
          disc('searchapi', { priced: 4, reused: 1 }),
        ],
      }),
    ];
    expect(totalReused(days)).toBe(6);
    const shown = renderWithProviders(<ReusedNote count={totalReused(days)} />);
    expect(shown.getByText('(6 reused from earlier runs)')).toBeInTheDocument();
    shown.unmount();
    const { container } = renderWithProviders(<ReusedNote count={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
