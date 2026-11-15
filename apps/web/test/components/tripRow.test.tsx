import { asIata, asIsoDate } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL, SYNTHETIC_SELLER_BOOKING } from '@gmt/core/testing';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripRow, TripRowHead, type TripRowProps } from '../../src/components/rows/TripRow.js';
import { COPY } from '../../src/copy.js';
import type { VerifiedDetails } from '../../src/lib/bookingTarget.js';
import {
  airportPairIndex,
  calendarFig,
  figurePairing,
  pairingFig,
  provCached,
  provSearched,
  verifiedFig,
} from '../fixtures.dates.js';
import { renderWithProviders } from '../render.js';

// Ruling 20 (Trips and Search plan): one trip row, on the cards, the Search section and the day panel.

const pair = { departureDate: asIsoDate('2026-11-11'), returnDate: asIsoDate('2026-11-28'), nights: 17 };
const search = {
  id: 'd1',
  cabin: 'economy',
  multiAirport: false,
  pointOfSale: 'GB',
  showCarriers: true,
} as const;
const real = (f: ReturnType<typeof verifiedFig>) => ({
  ...f.price,
  provenance: provSearched(),
});

function renderRow(over: Partial<TripRowProps> & { figure: TripRowProps['figure'] }) {
  return renderWithProviders(
    <ul>
      <TripRow details={null} search={search} pair={pair} {...over} />
    </ul>,
  );
}

/** A current verified trip LHR → JFK with its own legs and a seller's booking. */
const DETAILS: VerifiedDetails = {
  departureDate: pair.departureDate,
  returnDate: pair.returnDate,
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  legs: { out: { durationMinutes: 850, stops: 1 }, back: { durationMinutes: 725, stops: null } },
  booking: SYNTHETIC_SELLER_BOOKING,
};
const verified = verifiedFig({ price: real(verifiedFig()), hasBookingOptions: true });

describe('TripRow', () => {
  it('is a list item holding the price, label, dates, nights, both legs and a details link', () => {
    renderRow({ figure: pairingFig() });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Wed 11 Nov → Sat 28 Nov');
    expect(within(row).getByText(/Nights/)).toHaveClass('row-vh');
    expect(row).toHaveTextContent('Out 07:15 → 18:05 · 10h 40m · 1 change · Aer Lingus');
    expect(row).toHaveTextContent('Back 14:20 → 06:25 · 6h 55m · direct · Virgin Atlantic');
    expect(within(row).getByRole('link', { name: 'Details for Wed 11 Nov → Sat 28 Nov' })).toHaveAttribute(
      'href',
      expect.stringContaining('view=trip'),
    );
  });

  it('› opens the Trip page in place, at exactly its own address (no page load)', async () => {
    const { user } = renderRow({ figure: pairingFig() });
    const link = screen.getByRole('link', { name: 'Details for Wed 11 Nov → Sat 28 Nov' });
    await user.click(link);
    expect(window.location.search).toBe(link.getAttribute('href'));
  });

  // Task 9 fix round 1 (ruling): on a search's page the › carries the page's d.* filters (one helper,
  // searchPageTripHref); on a Trips card it is built from scratch as before
  it('on a search’s page › carries the page’s filters; on a card it does not', async () => {
    const page = renderWithProviders(
      <ul>
        <TripRow
          details={null}
          search={{ ...search, onSearchPage: true }}
          pair={pair}
          figure={pairingFig()}
        />
      </ul>,
      { search: '?view=dates&def=d1&d.nights=10-11&d.week=best' },
    );
    const link = screen.getByRole('link', { name: 'Details for Wed 11 Nov → Sat 28 Nov' });
    const href = new URLSearchParams(link.getAttribute('href') ?? '');
    expect([href.get('view'), href.get('d.nights'), href.get('d.week')]).toEqual(['trip', '10-11', 'best']);
    await page.user.click(link);
    expect(new URLSearchParams(window.location.search).get('d.nights')).toBe('10-11');
    page.unmount();
    // a card's row, even under a URL holding d.* (it never reads the URL)
    renderWithProviders(
      <ul>
        <TripRow details={null} search={search} pair={pair} figure={pairingFig()} />
      </ul>,
      { search: '?view=searches&d.nights=10-11' },
    );
    expect(
      new URLSearchParams(
        screen.getByRole('link', { name: 'Details for Wed 11 Nov → Sat 28 Nov' }).getAttribute('href') ?? '',
      ).get('d.nights'),
    ).toBeNull();
  });

  it("marks a pairing leg's next-day arrival and a date-line return from the list's own day offsets", () => {
    renderRow({
      figure: pairingFig({
        pairing: figurePairing({
          legs: {
            out: { durationMinutes: 640, stops: 1, carriers: ['Aer Lingus'], arrivesDayOffset: 1 },
            back: { durationMinutes: 415, stops: 0, carriers: ['Virgin Atlantic'], arrivesDayOffset: -1 },
          },
        }),
      }),
    });
    const row = screen.getByRole('listitem');
    expect(row).toHaveTextContent('Out 07:15 → 18:05 +1 · 10h 40m');
    expect(row).toHaveTextContent('Back 14:20 → 06:25 −1 · 6h 55m');
  });

  it("withholds one row's price when its provenance is not one, and keeps the rows and the page", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = pairingFig();
    renderWithProviders(
      <ul>
        <TripRow
          // why: a figure whose provenance is not one (no cast: an intersection with a bad value is still a figure)
          figure={Object.assign({}, good, { price: { ...good.price, provenance: 'not a provenance' } })}
          details={null}
          search={search}
          pair={pair}
        />
        <TripRow figure={good} details={null} search={search} pair={pair} />
      </ul>,
    );
    spy.mockRestore();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText(COPY.priceWithheld).length).toBeGreaterThan(0);
    // only the second row keeps its label
    expect(screen.getAllByTestId('price-label')).toHaveLength(1);
  });

  it('leaves the airlines off a card (showCarriers false or absent)', () => {
    renderRow({ figure: pairingFig(), search: { ...search, showCarriers: false } });
    expect(screen.getByRole('listitem')).not.toHaveTextContent('Aer Lingus');
    expect(screen.getByRole('listitem')).toHaveTextContent('1 change');
  });

  it.each([
    ['seller', verified, DETAILS],
    [
      'Google price',
      pairingFig({ pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }) }),
      null,
    ],
    ['Not seen again', verifiedFig({ price: real(verifiedFig()), notSeenInLatest: { ageHours: 30 } }), null],
  ])('says "%s" for its price', (word, figure, details) => {
    renderRow({ figure, details });
    expect(screen.getByTestId('price-label')).toHaveTextContent(word);
  });

  describe('booking targets', () => {
    it('a pairing trip with a booking page links it ("Book on Google Flights")', () => {
      renderRow({
        figure: pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) }),
      });
      const link = screen.getByRole('link', { name: /Book on Google Flights/ });
      expect(link).toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
    });
    it('a pairing trip without one links the Google Flights search for its own airports ("Find")', () => {
      renderRow({ figure: pairingFig() });
      const link = screen.getByRole('link', { name: /Find on Google Flights/ });
      expect(link.getAttribute('href')).toContain('LHR');
    });
    it('a verified trip links its seller from its details ("Book on <host>")', () => {
      renderRow({ figure: verified, details: DETAILS });
      expect(screen.getByRole('link', { name: /Book on / })).toBeInTheDocument();
    });
    it('a synthetic trip has no link out, only its details link', () => {
      renderRow({ figure: verifiedFig({ hasBookingOptions: true }), details: DETAILS });
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(screen.getByRole('link')).toHaveAccessibleName(/^Details for/);
    });
  });

  describe('a verified row', () => {
    it('shows its own times, minutes and stops from its details, no airlines, and its seller link', () => {
      renderRow({ figure: verified, details: DETAILS });
      const row = screen.getByRole('listitem');
      // the overnight outbound's day mark comes from its local date-times
      expect(row).toHaveTextContent('Out 18:30 → 06:40 +1 · 14h 10m · 1 change');
      // the return states no stops: only its times and minutes
      expect(row).toHaveTextContent('Back 09:00 → 21:05 · 12h 05m');
      expect(row).not.toHaveTextContent(/Aer Lingus|Virgin Atlantic/);
    });
    it("a stale verified figure on another airport pair shows none of its pairing's legs or airports", () => {
      const f = verifiedFig({
        price: real(verifiedFig()),
        origin: asIata('LGW'),
        destination: asIata('JFK'),
        airportPair: airportPairIndex('LGW', 'JFK'),
        notSeenInLatest: { ageHours: 80 },
        // the older trip read beneath it is LHR → JFK's, never this figure's
        pairing: figurePairing({ departOut: '07:15', bookingUrl: SYNTHETIC_BOOKING_URL }),
        pairingRead: 'within-older',
      });
      renderRow({ figure: f, details: null });
      const row = screen.getByRole('listitem');
      expect(row).not.toHaveTextContent(/Aer Lingus|Virgin Atlantic|07:15|14:20|10h 40m/);
      expect(row).not.toHaveTextContent('LHR');
      expect(screen.queryByRole('link', { name: /Book|Find/ })).toBeNull();
      expect(screen.getByTestId('price-label')).toHaveTextContent('Not seen again');
    });
  });

  describe('a search with several airports', () => {
    const multi = { ...search, multiAirport: true };
    it('prefixes the row with its pair, names its details link with it and links its own airports', () => {
      renderRow({ figure: pairingFig(), search: multi });
      expect(screen.getByTestId('row-airports')).toHaveTextContent('LHR → JFK');
      const link = screen.getByRole('link', { name: 'Details for LHR → JFK, Wed 11 Nov → Sat 28 Nov' });
      expect(link.getAttribute('href')).toContain('d.from=LHR');
      expect(link.getAttribute('href')).toContain('d.to=JFK');
    });
    it('two trips on one date with different pairs have different details and book links', () => {
      const lgw = pairingFig({ origin: asIata('LGW'), airportPair: airportPairIndex('LGW', 'JFK') });
      const lhr = pairingFig();
      renderWithProviders(
        <ul>
          <TripRow figure={lgw} details={null} search={multi} pair={pair} />
          <TripRow figure={lhr} details={null} search={multi} pair={pair} />
        </ul>,
      );
      const hrefs = (re: RegExp) =>
        screen.getAllByRole('link', { name: re }).map((a) => a.getAttribute('href'));
      const [a, b] = hrefs(/^Details for/);
      expect(a).not.toEqual(b);
      const [x, y] = hrefs(/Find on Google Flights/);
      expect(x).toContain('LGW');
      expect(y).toContain('LHR');
      expect(x).not.toEqual(y);
    });
    it('a single-airport search shows no pair', () => {
      renderRow({ figure: pairingFig() });
      expect(screen.queryByTestId('row-airports')).toBeNull();
    });
  });

  it('names each value for assistive technology: Nights, Out and Back, and the head is aria-hidden', () => {
    renderWithProviders(
      <ul>
        <TripRowHead />
        <TripRow figure={pairingFig()} details={null} search={search} pair={pair} />
      </ul>,
    );
    expect(document.querySelector('.trip-row-head')).toHaveAttribute('aria-hidden', 'true');
    const row = screen.getByTestId('trip-row');
    expect(row.querySelector('.row-nights')).toHaveTextContent('Nights 17');
    expect([...row.querySelectorAll('.row-leg-tag')].map((t) => t.textContent)).toEqual(['Out', 'Back']);
    expect(COPY.rows.head.nights).toBe('Nights');
  });

  it("stays a list item when it knows nothing of its flights, keeping the grid's columns", () => {
    renderRow({ figure: calendarFig({ price: { ...calendarFig().price, provenance: provCached() } }) });
    const row = screen.getByTestId('trip-row');
    expect(row.querySelectorAll('.row-leg')).toHaveLength(2);
    expect(row.querySelector('.row-leg-tag')).toBeNull();
  });
});
