import { asIsoDate, type DatePairFigure, decodeDatePairs, isTrip } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL, SYNTHETIC_SELLER_BOOKING } from '@gmt/core/testing';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { TripResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import type { TripUiState } from '../../../src/state/tripState.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { TripView } from '../../../src/views/Trip/TripView.js';
import {
  at,
  calendarFig,
  type DatesOptions,
  datesResponse,
  figurePairing,
  pairingFig,
  pricedPair,
  provCached,
  provFlightList,
  provGrid,
  provSearched,
  verifiedFig,
} from '../../fixtures.dates.js';
import { API, definition } from '../../fixtures.js';
import { searchCard } from '../../fixtures.searches.js';
import { trip, tripBody } from '../../fixtures.trip.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { dayButton, findCalendar, findDayPanel, renderDates } from '../dates/render.js';
import { renderInShell } from '../searches/support.js';

// Design 2026-11-08 §6.5, goal 4 (trip-page plan Task 7; Review Focus 5): for every figure basis, the Search page's row
// for a pair of dates (a trip row in Cheapest trips, or a calendar row in Lower on the calendar, from the decoded
// date-pairs payload), the same pair's row in its day's panel (Task 9) and the Trip page's card (from a trip read
// carrying the same figure, as the api's `datePairFigureOf` composes both) show the same price, the same label and the
// same seller. A calendar figure a later search did not see again is in neither section (Ruling 3): the day panel and
// the Trip page show it. For a trip, the Trips page's card shows it too, linking the same booking target.

const DEPART = '2027-03-14';
const NIGHTS = 10;
const RETURN = '2027-03-24';
const STATE: TripUiState = {
  departureDate: asIsoDate(DEPART),
  returnDate: asIsoDate(RETURN),
  from: [],
  to: [],
  journey: null,
};

/** A seller's booking SearchApi's booking options gave (a GET link), as the api re-validates it. */
const SELLER_BOOKING = {
  kind: 'get',
  url: 'https://www.google.com/travel/clk/f?id=1',
  host: 'www.google.com',
} as const;

/**
 * A trip read of these dates whose figure is `figure`, everything else as the trip fixture's; a verified figure with
 * booking options carries its seller's booking, as the api sends both from the figure's own row.
 */
function tripOf(figure: TripResponse['figure'], pointOfSale = 'GB'): TripResponse {
  return trip({
    pointOfSale,
    departureDate: asIsoDate(DEPART),
    returnDate: asIsoDate(RETURN),
    nights: NIGHTS,
    figure,
    searchLink: null,
    booking:
      figure?.basis === 'verified' ? (figure.hasBookingOptions ? SELLER_BOOKING : { kind: 'none' }) : null,
  });
}

const FIGURES: ReadonlyArray<readonly [string, DatePairFigure]> = [
  ['a pairing figure, a seller’s price', pairingFig()],
  [
    'a pairing figure, Google’s price with no seller read',
    pairingFig({
      pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }),
    }),
  ],
  [
    'a calendar figure from the browser worker’s date grid',
    calendarFig({ price: { ...calendarFig().price, provenance: provGrid() } }),
  ],
  [
    'a calendar figure from the Aviasales cache',
    calendarFig({ price: { ...calendarFig().price, provenance: provCached() } }),
  ],
  // why: Task 8 dropped this case (no Search-page row showed it); the day panel does (Ruling 4, Review Focus 5)
  ['a calendar figure a later search did not see again', calendarFig({ superseded: true })],
  ['a verified figure', verifiedFig()],
  // why: final review I1: where SearchApi read booking options, both surfaces say "Seller"
  [
    'a verified figure SearchApi read booking options for',
    verifiedFig({ price: { ...verifiedFig().price, provenance: provSearched() }, hasBookingOptions: true }),
  ],
];

/** The amount a price shows ("£1,180"), the first in the element. */
const amountIn = (el: Element | null): string | null => /£[\d,]+/.exec(el?.textContent ?? '')?.[0] ?? null;

/** A seller line's seller ("QQ Travel" of "QQ Travel · cheapest of 3 …"), or null where none is shown. */
const sellerIn = (el: Element | null): string | null => el?.textContent?.split(' · ')[0] ?? null;
/** The label's detail, as the reader opens it (its words name the seller where the price is one). */
const detailIn = (el: Element | null): string | null =>
  el?.querySelector('[data-testid="price-label"] .price-label-pop p')?.textContent ?? null;
/** A section's row for the one pair of dates (its trip row, or its calendar row), or null when no section shows it. */
const sectionRowOf = async (): Promise<HTMLElement | null> => {
  await findCalendar();
  return screen.queryByTestId(/^(trip|calendar)-row$/);
};
/** The pair's row in its day's panel (14 Mar), opened by a click on the day: the day's one stay with a price leads. */
async function panelRowOf(user: { click: (el: Element) => Promise<void> }): Promise<HTMLElement> {
  await user.click(dayButton(DEPART));
  const panel = await findDayPanel(/^Sun 14 Mar: \d+ stays$/);
  const row = within(panel).getAllByRole('listitem')[0];
  if (row === undefined) throw new Error('the day panel lists no stay');
  return row;
}
/** What a row shows of its price: the amount, the label as the eye reads it, the label's detail, the link out. */
const shownBy = (row: Element) => ({
  amount: amountIn(row.querySelector('[data-testid="price-cell"]')),
  label: row.querySelector('[data-testid="price-label"] summary')?.textContent ?? null,
  detail: detailIn(row),
  href: row.querySelector('a[target="_blank"]')?.getAttribute('href') ?? null,
});

describe("the Search page's row, the day panel's and the Trip card agree, figure by figure (design §6.5)", () => {
  it.each(FIGURES)('%s', async (_name, figure) => {
    const body: DatesOptions = {
      discoveryProviders: ['camoufox'],
      pairs: { [at(DEPART, NIGHTS)]: pricedPair(figure) },
    };
    // the board's row, from the date-pairs payload the board decodes: a section's, where one shows it (a trip, or a
    // current calendar price), and the day panel's always
    const board = renderDates({ body });
    const section = await sectionRowOf();
    expect(section === null).toBe(figure.superseded && figure.basis === 'calendar');
    const row = await panelRowOf(board.user);
    if (section !== null) expect(shownBy(row)).toEqual(shownBy(section));
    const boardPrice = amountIn(row.querySelector('[data-testid="price-cell"]'));
    // why: CodeRabbit PR #58 finding 18: both surfaces showing no amount, or the same wrong one, must fail: the board
    // shows the figure's own price, in whole pounds with thousands commas, written out here independently
    expect(boardPrice).toBe(`£${Math.round(figure.price.pricePence / 100).toLocaleString('en-GB')}`);
    const boardDetail = detailIn(row);
    // why: both surfaces drawing no detail must fail, not agree
    expect(boardDetail).not.toBeNull();
    const decoded = decodeDatePairs(datesResponse(body)).pairs.find(
      (p) => p.departureDate === DEPART && p.nights === NIGHTS,
    )?.figure;
    if (decoded === undefined || decoded === null) throw new Error('no decoded figure');
    // why: the label as the user sees it on the board's row, not recomputed from the rule (so a row that drew a
    // different label than the card fails here)
    const boardLabel = row.querySelector('[data-testid="price-label"] summary')?.textContent;
    board.unmount();

    // the card, from a trip read carrying the same figure (the wire's figure is the board's less its index)
    const { airportPair: _index, ...wire } = decoded;
    server.use(http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(tripOf(wire)))));
    renderWithProviders(<TripView definition={definition()} state={STATE} />, {
      search: `?view=trip&def=def-0001&depart=${DEPART}&return=${RETURN}`,
    });
    const card = await screen.findByRole('region', { name: COPY.trip.cardLabel });
    const label = within(card).getByTestId('price-label').querySelector('summary');
    expect(amountIn(card.querySelector('[data-testid="price-cell"]'))).toBe(boardPrice);
    expect(label?.textContent).toBe(boardLabel);
    expect(detailIn(card)).toBe(boardDetail);
    // why: the oracle: a seller is named exactly where the figure is a seller's price, on the card's seller line and
    // in the row's label alike
    const seller =
      figure.basis === 'pairing' && figure.pairing?.isFrom === false ? figure.pairing.seller : null;
    expect(sellerIn(card.querySelector('[data-testid="trip-seller"]'))).toBe(seller);
    if (seller !== null) expect(boardDetail).toContain(seller);
    // why: the oracle for the label: a verified price with booking options is a seller's on both surfaces
    if (figure.basis === 'verified')
      expect(boardLabel?.startsWith(figure.hasBookingOptions ? COPY.trip.label.seller : 'Google price')).toBe(
        true,
      );
  });
});

// Fix round 1 (Ruling 2): a trip without a booking falls back to the Google Flights search for its own airports and
// dates in the install's market (POINT_OF_SALE), the same link on the board row and on the Trip card.
describe("the Search page's row and the Trip card link the same search, in the install's point of sale", () => {
  it.each([
    ['a pairing figure with no booking page', pairingFig()],
    // why: fix round 1: a read trip whose calendar candidate was superseded is still a trip, linked out on both
    ['a pairing figure whose calendar price was superseded', pairingFig({ superseded: true })],
    [
      'a verified figure with no seller',
      verifiedFig({ price: { ...verifiedFig().price, provenance: provSearched() } }),
    ],
  ])('%s', async (_name, figure) => {
    const body: DatesOptions = {
      discoveryProviders: ['camoufox'],
      pointOfSale: 'US',
      pairs: { [at(DEPART, NIGHTS)]: pricedPair(figure) },
    };
    const board = renderDates({ body });
    const section = await sectionRowOf();
    const boardHref = section?.querySelector('a[target="_blank"]')?.getAttribute('href') ?? null;
    expect(boardHref).toContain('gl=US');
    // the day panel's row links the same search
    expect(shownBy(await panelRowOf(board.user)).href).toBe(boardHref);
    board.unmount();

    const decoded = decodeDatePairs(datesResponse(body)).pairs.find(
      (p) => p.departureDate === DEPART && p.nights === NIGHTS,
    )?.figure;
    if (decoded == null) throw new Error('no decoded figure');
    const { airportPair: _index, ...wire } = decoded;
    server.use(
      http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(tripOf(wire, 'US')))),
    );
    renderWithProviders(<TripView definition={definition()} state={STATE} />, {
      search: `?view=trip&def=def-0001&depart=${DEPART}&return=${RETURN}`,
    });
    const card = await screen.findByRole('region', { name: COPY.trip.cardLabel });
    expect(within(card).getByRole('link').getAttribute('href')).toBe(boardHref);
  });
});

// Review Focus 5 (Task 9): the same pair of dates on the Trips page's card, the Search page's section, its day panel and
// the Trip page shows the same price, label and booking target: a current verified trip with a seller's booking, a read
// trip with its own booking page, and a verified price the latest search did not see again (only the day panel and the
// Trip page show it, "Not seen again", linked nowhere).
describe('the card, the section, the day panel and the Trip page agree (Review Focus 5)', () => {
  const CASES: ReadonlyArray<readonly [string, DatePairFigure]> = [
    [
      'a current verified trip with a seller’s booking',
      verifiedFig({ price: { ...verifiedFig().price, provenance: provSearched() }, hasBookingOptions: true }),
    ],
    [
      'a read trip with its own booking page',
      pairingFig({
        pairing: figurePairing({ provenance: provFlightList(), bookingUrl: SYNTHETIC_BOOKING_URL }),
      }),
    ],
    [
      'a verified price the latest search did not see again',
      verifiedFig({
        price: { ...verifiedFig().price, provenance: provSearched() },
        hasBookingOptions: true,
        notSeenInLatest: { ageHours: 30 },
      }),
    ],
  ];

  it.each(CASES)('%s', async (_name, figure) => {
    const body: DatesOptions = {
      origins: ['LHR'],
      destinations: ['JFK'],
      discoveryProviders: ['camoufox', 'searchapi'],
      pairs: { [at(DEPART, NIGHTS)]: pricedPair(figure, {}, 1) },
    };
    const def = definition({ origins: ['LHR'], destinations: ['JFK'] });
    const data = decodeDatePairs(datesResponse(body));
    const decoded = data.pairs.find((p) => p.departureDate === DEPART && p.nights === NIGHTS)?.figure;
    if (decoded == null) throw new Error('no decoded figure');
    const { airportPair: _index, ...wire } = decoded;
    const details = data.verifiedDetails.find((x) => x.departureDate === DEPART && x.returnDate === RETURN);
    const booking = figure.basis === 'verified' ? (details?.booking ?? { kind: 'none' as const }) : null;
    const trip = isTrip(figure);

    // the Search page: its section's row (a trip only) and the day panel's
    const page = renderDates({ body, def });
    const section = await sectionRowOf();
    expect(section !== null).toBe(trip);
    const panel = shownBy(await panelRowOf(page.user));
    if (section !== null) expect(shownBy(section)).toEqual(panel);
    expect(panel.href === null).toBe(!trip);
    // why: the oracle, written out: the seller's booking the details carry, and the read trip's own booking page
    if (figure.basis === 'verified' && trip) expect(panel.href).toBe(SYNTHETIC_SELLER_BOOKING.url);
    if (figure.basis === 'pairing') expect(panel.href).toBe(SYNTHETIC_BOOKING_URL);
    if (!trip) expect(panel.label).toMatch(/^Not seen again/);
    page.unmount();

    // the Trips page's card, from a cards read carrying the same trip and details (trips only: Ruling 7)
    if (trip) {
      server.use(
        serveCards([
          searchCard({
            name: 'Agreement',
            origins: ['LHR'],
            destinations: ['JFK'],
            trips: [{ figure: wire, departureDate: DEPART, returnDate: RETURN, nights: NIGHTS }],
            verifiedDetails: data.verifiedDetails,
          }),
        ]),
      );
      const cards = renderInShell(<SearchesView />);
      const heading = await screen.findByRole('heading', { level: 2, name: 'Agreement' });
      const card = heading.closest('li');
      if (card === null) throw new Error('no card');
      expect(shownBy(within(card).getByTestId('trip-row'))).toEqual(panel);
      cards.unmount();
    }

    // the Trip page, from a trip read carrying the same figure and booking
    server.use(
      http.get(`${API}/definitions/:id/trip`, () =>
        HttpResponse.json(tripBody({ ...tripOf(wire), booking })),
      ),
    );
    renderWithProviders(<TripView definition={def} state={STATE} />, {
      search: `?view=trip&def=def-0001&depart=${DEPART}&return=${RETURN}`,
    });
    const card = await screen.findByRole('region', { name: COPY.trip.cardLabel });
    const shown = shownBy(card);
    expect([shown.amount, shown.label, shown.href]).toEqual([panel.amount, panel.label, panel.href]);
  });
});
