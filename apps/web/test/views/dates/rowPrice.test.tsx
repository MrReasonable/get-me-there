import { asIsoDate } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL } from '@gmt/core/testing';
import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { rowBookingTarget } from '../../../src/views/Dates/board.js';
import {
  at,
  calendarFig,
  figurePairing,
  pairingFig,
  pricedPair,
  provGrid,
  provSynthetic,
  verifiedFig,
} from '../../fixtures.dates.js';
import { setViewportWidth } from '../../viewport.js';
import { boardRows, findBoard, renderDates } from './render.js';

// Design 2026-11-08 §5.1, §5.3, Ruling 10 (trip-page plan Task 8): on a board row a pairing's price is its booking link
// (the group's booking page, else the Google Flights search), a calendar price is plain text, and every row's price
// carries its one label.

const DEPART = '2027-03-14';
const NIGHTS = 10;

/** The board's one row for `figure`. */
async function rowOf(figure: ReturnType<typeof pairingFig>, width = 1280) {
  setViewportWidth(width);
  const view = renderDates({ body: { pairs: { [at(DEPART, NIGHTS)]: pricedPair(figure) } } });
  const row = boardRows(await findBoard())[0];
  if (row === undefined) throw new Error('no board row');
  return { ...view, row };
}

/** The links out of the app in `el`: the ones that open a new tab. */
const outLinks = (el: HTMLElement) =>
  within(el)
    .queryAllByRole('link')
    .filter((a) => a.getAttribute('target') === '_blank');

describe.each([
  ['the table', 1280],
  ['the phone cards', 375],
] as const)('a pairing row on %s', (_name, width) => {
  it('has one "Book on Google Flights ↗" link to its booking page, and a click on it leaves the row closed', async () => {
    const { user, row } = await rowOf(
      pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) }),
      width,
    );
    const links = outLinks(row);
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/^£1,180 · Book on Google Flights ↗/);
    expect(links[0]).toHaveAttribute('href', SYNTHETIC_BOOKING_URL);
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    const before = window.location.search;
    const history = window.history.length;
    await user.click(links[0] ?? row);
    // why: the row's own click opens its trip; the price link stops that
    expect([window.location.search, window.history.length]).toEqual([before, history]);
  });

  it('says "Find on Google Flights ↗" with no booking page of its own', async () => {
    const { row } = await rowOf(pairingFig(), width);
    const links = outLinks(row);
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName(/Find on Google Flights ↗/);
    expect(links[0]?.getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\//);
  });

  it('shows a calendar price as plain text, labelled "Calendar · 3h"', async () => {
    const f = calendarFig({ price: { ...calendarFig().price, provenance: provGrid(), ageHours: 3 } });
    const { row } = await rowOf(f, width);
    expect(outLinks(row)).toEqual([]);
    expect(within(row).getByTestId('price-label').querySelector('summary')).toHaveTextContent(
      'Calendar · 3h',
    );
  });

  it('carries one label on a pairing row, its detail in the row, and opening it leaves the row where it is', async () => {
    const { user, row } = await rowOf(pairingFig(), width);
    const labels = within(row).getAllByTestId('price-label');
    expect(labels).toHaveLength(1);
    const summary = labels[0]?.querySelector('summary');
    expect(summary).toHaveTextContent(`${COPY.trip.label.seller} · 4h`);
    // why: the detail is part of the row (it opens in the flow beneath the label), so the row's height is its own
    expect(labels[0]).toHaveTextContent(/QQ Travel/);
    const before = [window.location.search, window.history.length];
    await user.click(summary ?? row);
    // why: the row's own click opens its trip; a tap on the label only opens the label
    expect([window.location.search, window.history.length]).toEqual(before);
    expect(outLinks(row)).toHaveLength(1);
  });
});

describe("rowBookingTarget (core's one rule over a board row)", () => {
  const pair = { departureDate: asIsoDate(DEPART), returnDate: asIsoDate('2027-03-24') };
  it("is the booking page when the group has one, else the Google Flights search for the row's airports", () => {
    expect(
      rowBookingTarget(
        pair,
        pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) }),
        'economy',
      ),
    ).toMatchObject({ kind: 'booking-page', url: SYNTHETIC_BOOKING_URL });
    const search = rowBookingTarget(pair, pairingFig(), 'economy');
    expect(search).toMatchObject({ kind: 'search', host: 'www.google.com' });
    expect(search.kind === 'search' ? search.url : '').toContain('LHR');
  });
  it('is none for a synthetic price, a calendar price and a verified price', () => {
    const f = pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) });
    expect(
      rowBookingTarget(pair, { ...f, price: { ...f.price, provenance: provSynthetic() } }, 'economy'),
    ).toEqual({ kind: 'none' });
    // why: the contract only lets a flight list's provenance on a pairing; the rule is defensive, so build one by hand
    expect(
      rowBookingTarget(
        pair,
        { ...f, pairing: { ...figurePairing(), provenance: provSynthetic() } },
        'economy',
      ),
    ).toEqual({ kind: 'none' });
    expect(rowBookingTarget(pair, calendarFig(), 'economy')).toEqual({ kind: 'none' });
    expect(rowBookingTarget(pair, verifiedFig(), 'economy')).toEqual({ kind: 'none' });
  });
  it('is none when the search link is not for a cabin the browser reads', () => {
    expect(rowBookingTarget(pair, pairingFig(), 'business')).toEqual({ kind: 'none' });
  });
});
