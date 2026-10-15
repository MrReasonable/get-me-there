// Synthetic SearchApi shapes for cases the recordings do not contain. Every test using them says "(synthetic)"
// in its name; nothing here is written under fixtures/ or passed through the recorder. The drift test in
// recorded.test.ts checks these shapes' keys against the recorded bodies.
import { asIata, asIsoDate, type ItineraryQuery } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { SEARCHAPI_ENDPOINT } from '../../../src/searchapi/params.js';

export const ECHO = { search_parameters: { currency: 'GBP', gl: 'gb', hl: 'en' } };
export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
export const ok = (body: unknown): Reply => ({ status: 200, body });

/** One handler answering every SearchApi request through `respond`, as replay does: a JSON text body. */
export function syntheticHandler(respond: (p: URLSearchParams) => Reply) {
  return http.get(SEARCHAPI_ENDPOINT, ({ request }) => {
    const r = respond(new URL(request.url).searchParams);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new HttpResponse(text, {
      status: r.status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  });
}

/** One vendor segment; carriers are clearly synthetic, airports the worked example's. */
export function seg(
  from: string,
  to: string,
  date: string,
  time: string,
  flightNumber: string,
  airline?: string,
  travelClass = 'Economy',
) {
  return {
    departure_airport: { id: from, date, time },
    arrival_airport: { id: to, date, time: '23:00' },
    ...(airline === undefined ? {} : { airline }),
    flight_number: flightNumber,
    travel_class: travelClass,
    duration: 420,
    airplane: 'Synthetic 787',
  };
}

export const OUT_A = [seg('LHR', 'JFK', '2026-11-02', '09:00', 'X1 100', 'Synthetic Air One')];
export const OUT_B = [seg('LHR', 'JFK', '2026-11-02', '13:00', 'Y2 200', 'Synthetic Air Two')];
export const IN_1 = [seg('JFK', 'LHR', '2026-11-14', '18:00', 'X1 101', 'Synthetic Air One')];
export const IN_2 = [seg('JFK', 'LHR', '2026-11-14', '20:00', 'X1 103', 'Synthetic Air One')];
export const IN_3 = [seg('JFK', 'LHR', '2026-11-14', '22:00', 'X1 105', 'Synthetic Air One')];

export function option(
  flights: unknown[],
  price: number | undefined,
  token: { departure_token: string } | { booking_token: string },
) {
  return { flights, ...(price === undefined ? {} : { price }), ...token };
}
export const flightsBody = (options: unknown[], extra: object = {}) => ({
  ...ECHO,
  best_flights: options,
  ...extra,
});
export const bookingBody = (options: unknown[]) => ({ ...ECHO, booking_options: options });
export const POST = { url: 'https://www.google.com/travel/clk/f', post_data: 'u=synthetic' };
export const agent = (price: number, bookWith = 'Synthetic Travel Agent') => ({
  book_with: bookWith,
  price,
  booking_request: POST,
});

/** The worked-example cell (spec §1). */
export const CELL_QUERY: ItineraryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-14'),
  cabin: 'economy',
  adults: 1,
  currency: 'GBP',
  expandTop: 2,
  bookingLinks: true,
};
