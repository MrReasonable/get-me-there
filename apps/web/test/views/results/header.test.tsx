import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { ResultsHeader } from '../../../src/views/Results/ResultsHeader.js';
import { provFlightList, provGrid } from '../../fixtures.dates.js';
import { calendarRow, datePairFigure, resultsResponse } from '../../fixtures.js';
import { renderWithProviders } from '../../render.js';

// Spec rev 56 §6.9, §11 "Date pair detail" (arch-r3-003): the detail's header names the board's figure when it is not
// the cheapest row; a pairing figure there is calendar-styled ("constraints not checked") and named by its basis words,
// "cheapest of the sellers read, not checked with the airline", never "verified".

/** The board's pairing figure as the scoped `/results` read sends it (the contract's per-figure rules hold). */
const pairingFigure = () => {
  const list = provFlightList();
  return datePairFigure({
    price: { pricePence: 118_000, provenance: list, stale: false, ageHours: 4, truncated: false },
    basis: 'pairing',
    journeyMinutes: null,
    departOut: null,
    arriveOut: null,
    departBack: null,
    arriveBack: null,
    gridPrice: { pricePence: 56_400, provenance: provGrid(), stale: false, truncated: false },
    pairing: {
      pricePence: 118_000,
      fromPence: 118_000,
      isFrom: false,
      seller: 'QQ Travel',
      fare: null,
      offersRead: 3,
      complete: true,
      which: 'next-cheapest',
      departOut: '07:15',
      arriveOut: '18:05',
      departBack: '14:20',
      arriveBack: '06:25',
      mismatch: false,
      provenance: list,
      stale: false,
      ageHours: 4,
    },
    pairingRead: 'within',
  });
};

describe("the detail's header with a pairing board figure (spec rev 56 §6.9; arch-r3-003)", () => {
  it('renders the figure calendar-styled with "not checked" and the pairing basis words', () => {
    const data = resultsResponse({ rows: [calendarRow()], datePairFigure: pairingFigure() });
    renderWithProviders(
      <ResultsHeader data={data} filteredFirst={data.rows[0] ?? null} coveragePatch={{}} />,
    );
    const board = screen.getByTestId('board-figure');
    expect(within(board).getByTestId('price-cell')).toHaveTextContent('£1,180');
    expect(within(board).getByTestId('provenance')).toHaveTextContent('constraints not checked');
    expect(board.className).toMatch(/border-dashed/);
    // why: design 2026-11-08 §4.1: the figure's own pairing group (a complete offer here) says whose price it is
    expect(board).toHaveTextContent(`LHR → JFK · ${COPY.basisKindName.seller}`);
    expect(board).not.toHaveTextContent(/verified/i);
    // why: 21.7 prov-002: a pairing figure differs because it is a seller's offer from a flight list, never by recency
    expect(board).toHaveTextContent(
      "It is a seller's offer read from the browser worker's flight list for one outbound and one return, not one of the prices listed here.",
    );
    expect(board).not.toHaveTextContent('the board prefers a price the latest search returned');
  });
});
