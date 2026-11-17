import { asIata, asIsoDate } from '@gmt/core';
import { SYNTHETIC_BOOKING_URL, SYNTHETIC_SELLER_BOOKING } from '@gmt/core/testing';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BookLink } from '../../src/components/BookLink.js';
import { rowBookingTarget, verifiedBookingOf } from '../../src/lib/bookingTarget.js';
import {
  airportPairIndex,
  calendarFig,
  figurePairing,
  pairingFig,
  provSearched,
  provSynthetic,
  verifiedFig,
} from '../fixtures.dates.js';

// Ruling 2 (Trips and Search plan): one booking target for a date pair's figure, the same on the card, the Search
// section, the day panel and the Trip page; a verified trip links its own seller's booking.

const DEPART = '2027-03-14';
const RETURN = '2027-03-24';
const pair = { departureDate: asIsoDate(DEPART), returnDate: asIsoDate(RETURN) };
const real = { ...verifiedFig().price, provenance: provSearched() };

/**
 * Final review C1: a stale verified £600 on LGW→JFK with the older trip read three days ago in the date pair's best
 * calendar cell (LHR→JFK) beneath it (`within-older`), that trip's booking page recorded.
 */
function staleVerifiedWithOlderTrip() {
  return verifiedFig({
    price: {
      pricePence: 60_000,
      provenance: provSearched(),
      stale: 'setting',
      ageHours: 80,
      truncated: false,
    },
    origin: asIata('LGW'),
    destination: asIata('JFK'),
    airportPair: airportPairIndex('LGW', 'JFK'),
    pairing: figurePairing({ stale: 'refresh', ageHours: 72, bookingUrl: SYNTHETIC_BOOKING_URL }),
    pairingRead: 'within-older',
  });
}

type Args = Parameters<typeof rowBookingTarget>;
/** `rowBookingTarget` in the fixtures' market, GB. */
const inGb = (p: Args[0], f: Args[1], cabin: Args[2], booking: Args[3]) =>
  rowBookingTarget(p, f, cabin, booking, 'GB');

describe("rowBookingTarget (core's one rule over a date pair's figure)", () => {
  it("is the booking page when the group has one, else the Google Flights search for the row's airports", () => {
    expect(
      inGb(
        pair,
        pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) }),
        'economy',
        null,
      ),
    ).toMatchObject({ kind: 'booking-page', url: SYNTHETIC_BOOKING_URL });
    const search = inGb(pair, pairingFig(), 'economy', null);
    expect(search).toMatchObject({ kind: 'search', host: 'www.google.com' });
    expect(search.kind === 'search' ? search.url : '').toContain('LHR');
  });
  it('is none for a synthetic price and a calendar price', () => {
    const f = pairingFig({ pairing: figurePairing({ bookingUrl: SYNTHETIC_BOOKING_URL }) });
    expect(inGb(pair, { ...f, price: { ...f.price, provenance: provSynthetic() } }, 'economy', null)).toEqual(
      { kind: 'none' },
    );
    // why: the contract only lets a flight list's provenance on a pairing; the rule is defensive, so build one by hand
    expect(
      inGb(pair, { ...f, pairing: { ...figurePairing(), provenance: provSynthetic() } }, 'economy', null),
    ).toEqual({ kind: 'none' });
    expect(inGb(pair, calendarFig(), 'economy', SYNTHETIC_SELLER_BOOKING)).toEqual({
      kind: 'none',
    });
  });
  it("gives a current verified trip's seller booking: Book on <host>", () => {
    const target = inGb(pair, verifiedFig({ price: real }), 'economy', SYNTHETIC_SELLER_BOOKING);
    expect(target).toEqual({ kind: 'seller', booking: SYNTHETIC_SELLER_BOOKING });
    // why: the words are BookLink's, the one place a target is worded
    render(createElement(BookLink, { target }));
    expect(screen.getByRole('link').textContent).toContain('Book on www.google.com');
  });
  it("links a verified row without a seller to its own cell's search, never to the booking page beneath it", () => {
    const v = verifiedFig({ price: real });
    expect(inGb(pair, v, 'economy', null)).toMatchObject({
      kind: 'search',
      host: 'www.google.com',
    });
    expect(inGb(pair, v, 'economy', { kind: 'none' })).toMatchObject({ kind: 'search' });
    // why: final review C1: a stale verified figure carries the pairing read in its date pair's best calendar cell,
    // another trip (maybe another airport pair), so that pairing's booking page is never the verified price's
    const target = inGb(pair, staleVerifiedWithOlderTrip(), 'economy', null);
    expect(target).toMatchObject({ kind: 'search', host: 'www.google.com' });
    expect(target.kind === 'search' ? target.url : '').toContain('LGW');
  });
  // why: fix round 1: the calendar candidate a read trip replaced being superseded does not age the trip
  it('links a pairing figure whose calendar price was superseded', () => {
    expect(inGb(pair, pairingFig({ superseded: true }), 'economy', null)).toMatchObject({ kind: 'search' });
  });
  it('is none for a verified figure the latest search did not see again, whatever its booking', () => {
    const gone = verifiedFig({ price: real, notSeenInLatest: { ageHours: 30 } });
    expect(inGb(pair, gone, 'economy', SYNTHETIC_SELLER_BOOKING)).toEqual({ kind: 'none' });
    expect(inGb(pair, gone, 'economy', null)).toEqual({ kind: 'none' });
  });
  // why: CodeRabbit CR4: a verified figure's pairing is another trip (maybe another airport pair's), so its
  // provenance never suppresses the verified price's own link; the verified price's own provenance still does
  it("keeps a real verified trip's seller booking when the pairing beneath it is synthetic", () => {
    const v = staleVerifiedWithOlderTrip();
    const beneath = v.pairing === null ? figurePairing() : v.pairing;
    const withSynthetic = { ...v, pairing: { ...beneath, provenance: provSynthetic() } };
    expect(inGb(pair, withSynthetic, 'economy', SYNTHETIC_SELLER_BOOKING)).toEqual({
      kind: 'seller',
      booking: SYNTHETIC_SELLER_BOOKING,
    });
  });
  it('is none for a synthetic verified price, whatever its booking', () => {
    expect(inGb(pair, verifiedFig(), 'economy', SYNTHETIC_SELLER_BOOKING)).toEqual({
      kind: 'none',
    });
  });
  it('never gives a pairing figure a seller booking handed to it', () => {
    expect(inGb(pair, pairingFig(), 'economy', SYNTHETIC_SELLER_BOOKING)).toMatchObject({
      kind: 'search',
    });
  });
  // why: fix round 1: the search a trip falls back to is in the install's market, never a default
  it("builds the search in the install's point of sale", () => {
    const us = rowBookingTarget(pair, pairingFig(), 'economy', null, 'US');
    expect(us.kind === 'search' ? us.url : '').toContain('gl=US');
    const gb = inGb(pair, pairingFig(), 'economy', null);
    expect(gb.kind === 'search' ? gb.url : '').toContain('gl=GB');
  });
  it('is none when the search link is not for a cabin the browser reads', () => {
    expect(inGb(pair, pairingFig(), 'business', null)).toEqual({ kind: 'none' });
  });
});

describe("verifiedBookingOf (Ruling 2: a verified figure's booking from its details)", () => {
  const detail = (over: Partial<Parameters<typeof verifiedBookingOf>[0][number]> = {}) => ({
    departureDate: asIsoDate(DEPART),
    returnDate: asIsoDate(RETURN),
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    legs: { out: { durationMinutes: 640, stops: 1 }, back: { durationMinutes: 415, stops: 0 } },
    booking: SYNTHETIC_SELLER_BOOKING,
    ...over,
  });
  it("is the booking of the details naming the figure's dates and airports", () => {
    expect(verifiedBookingOf([detail()], pair, verifiedFig())).toEqual(SYNTHETIC_SELLER_BOOKING);
  });
  it('is null for other dates or airports, and for a figure that is not verified', () => {
    for (const over of [
      { departureDate: asIsoDate('2027-03-15') },
      { returnDate: asIsoDate('2027-03-25') },
      { origin: asIata('LGW') },
      { destination: asIata('EWR') },
    ])
      expect(verifiedBookingOf([detail(over)], pair, verifiedFig()), JSON.stringify(over)).toBeNull();
    expect(verifiedBookingOf([detail()], pair, pairingFig())).toBeNull();
    expect(verifiedBookingOf([], pair, verifiedFig())).toBeNull();
  });
  it('picks the one for its airport pair among several on the same dates', () => {
    const lgw = detail({ origin: asIata('LGW'), booking: { kind: 'none' } });
    expect(verifiedBookingOf([lgw, detail()], pair, verifiedFig())).toEqual(SYNTHETIC_SELLER_BOOKING);
  });
});
