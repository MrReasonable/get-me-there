import { beforeEach, describe, expect, it } from 'vitest';
import { bookingTargetOf } from '../../src/results/bookingTarget.js';
import { SYNTHETIC_BOOKING_URL } from '../../src/testing/booking.js';
import type { Booking } from '../../src/types/itinerary.js';

beforeEach(() => {
  expect.hasAssertions();
});

const GET: Booking = { kind: 'get', url: 'https://seller.example/book', host: 'seller.example' };
const POST: Booking = {
  kind: 'post',
  url: 'https://seller.example/book',
  postData: 'a=1',
  host: 'seller.example',
};
const GOOGLE_SEARCH = {
  url: 'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK',
  host: 'www.google.com',
};
const base = { synthetic: false, booking: null, bookingUrl: null, searchLink: null };

describe('bookingTargetOf', () => {
  it('a get booking is the seller', () => {
    expect(
      bookingTargetOf({
        ...base,
        booking: GET,
        bookingUrl: SYNTHETIC_BOOKING_URL,
        searchLink: GOOGLE_SEARCH,
      }),
    ).toEqual({
      kind: 'seller',
      booking: GET,
    });
  });

  it('a post booking is the seller', () => {
    expect(bookingTargetOf({ ...base, booking: POST })).toEqual({ kind: 'seller', booking: POST });
  });

  it('a none booking falls through to the booking page', () => {
    expect(
      bookingTargetOf({ ...base, booking: { kind: 'none' }, bookingUrl: SYNTHETIC_BOOKING_URL }),
    ).toEqual({
      kind: 'booking-page',
      url: SYNTHETIC_BOOKING_URL,
      host: 'www.google.com',
    });
  });

  it('the booking page beats a search link', () => {
    expect(
      bookingTargetOf({ ...base, bookingUrl: SYNTHETIC_BOOKING_URL, searchLink: GOOGLE_SEARCH }).kind,
    ).toBe('booking-page');
  });

  it('an address off the booking path falls to the search link', () => {
    expect(
      bookingTargetOf({
        ...base,
        bookingUrl: 'https://www.google.com/travel/flights?q=x',
        searchLink: GOOGLE_SEARCH,
      }),
    ).toEqual({ kind: 'search', url: GOOGLE_SEARCH.url, host: 'www.google.com' });
  });

  it('a Google search link is the search', () => {
    expect(bookingTargetOf({ ...base, searchLink: GOOGLE_SEARCH })).toEqual({
      kind: 'search',
      url: GOOGLE_SEARCH.url,
      host: 'www.google.com',
    });
  });

  it('a search link on another host is none', () => {
    expect(
      bookingTargetOf({
        ...base,
        searchLink: { url: 'https://search.aviasales.com/?x=1', host: 'search.aviasales.com' },
      }),
    ).toEqual({ kind: 'none' });
  });

  it('nothing is none', () => {
    expect(bookingTargetOf(base)).toEqual({ kind: 'none' });
  });

  it('synthetic beats every other input', () => {
    expect(
      bookingTargetOf({
        synthetic: true,
        booking: GET,
        bookingUrl: SYNTHETIC_BOOKING_URL,
        searchLink: GOOGLE_SEARCH,
      }),
    ).toEqual({ kind: 'none' });
  });
});
