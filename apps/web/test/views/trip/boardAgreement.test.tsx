import { asIsoDate, type DatePairFigure, decodeDatePairs } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { TripResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import type { TripUiState } from '../../../src/state/tripState.js';
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
  provGrid,
  provSearched,
  verifiedFig,
} from '../../fixtures.dates.js';
import { API, definition } from '../../fixtures.js';
import { trip, tripBody } from '../../fixtures.trip.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { boardRows, findBoard, renderDates } from '../dates/render.js';

// Design 2026-11-08 §6.5, goal 4 (trip-page plan Task 7): for every figure basis, the search page's row for a pair of
// dates (from the decoded date-pairs payload) and the Trip page's card (from a trip read carrying the same figure, as
// the api's `datePairFigureOf` composes both) show the same price, the same label and the same seller.

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
function tripOf(figure: TripResponse['figure']): TripResponse {
  return trip({
    departureDate: asIsoDate(DEPART),
    returnDate: asIsoDate(RETURN),
    nights: NIGHTS,
    figure,
    searchLink: null,
    figureSearchLink: null,
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

describe('the board row and the Trip card agree, figure by figure (design §6.5)', () => {
  it.each(FIGURES)('%s', async (_name, figure) => {
    const body: DatesOptions = {
      discoveryProviders: ['camoufox'],
      pairs: { [at(DEPART, NIGHTS)]: pricedPair(figure) },
    };
    // the board's row, from the date-pairs payload the board decodes
    const board = renderDates({ body });
    const [row] = boardRows(await findBoard());
    if (row === undefined) throw new Error('no board row');
    const boardPrice = amountIn(row.querySelector('[data-testid="price-cell"]'));
    const boardSeller = sellerIn(row.querySelector('[data-testid="pairing-seller"]'));
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
    expect(sellerIn(card.querySelector('[data-testid="trip-seller"]'))).toBe(boardSeller);
    // why: the oracle: a seller is named exactly where the figure is a seller's price
    expect(boardSeller).toBe(
      figure.basis === 'pairing' && figure.pairing?.isFrom === false ? figure.pairing.seller : null,
    );
    // why: the oracle for the label: a verified price with booking options is a seller's on both surfaces
    if (figure.basis === 'verified')
      expect(boardLabel?.startsWith(figure.hasBookingOptions ? COPY.trip.label.seller : 'Google price')).toBe(
        true,
      );
  });
});
