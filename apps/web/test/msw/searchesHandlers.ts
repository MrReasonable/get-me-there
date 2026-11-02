import { HttpResponse, http, type JsonBodyType } from 'msw';
import type { SearchCard } from '../../src/api/types.js';
import { API, definition } from '../fixtures.js';
import { cardsResponse, flightListsResponse, flightPair, searchCard } from '../fixtures.searches.js';

// msw handlers for the Searches view (WP20 Task 20.3): `GET /api/definitions/cards`, Remove and Undo; and a search's
// page's flight lists (Task 20.10): `GET` and `POST /api/definitions/:id/flight-lists`.

export const CARDS_URL = `${API}/definitions/cards`;

/** The requests a handler answered, oldest first. */
export type CardRequests = URL[];

/** Serves `cards` (or a ready body) for every cards read, recording each URL. */
export function serveCards(cards: readonly SearchCard[] | JsonBodyType, requests: CardRequests = []) {
  return http.get(CARDS_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(Array.isArray(cards) ? cardsResponse(cards) : cards);
  });
}

/** Serves the body chosen by `next()` on each read, so a test changes what the next read answers. */
export function serveCardsBy(next: () => readonly SearchCard[], requests: CardRequests = []) {
  return http.get(CARDS_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(cardsResponse(next()));
  });
}

export const FLIGHT_LISTS_URL = `${API}/definitions/:id/flight-lists`;

/** The date pairs one flight-lists read asked for, as `departure_return` keys, in the order asked. */
export const askedPairs = (url: URL): string[] => (url.searchParams.get('pairs') ?? '').split(',');

/** Each asked pair as the entry `entry(departure, return)` gives (the pairs of `askedPairs`, in order). */
type FlightPairOf = (departureDate: string, returnDate: string) => ReturnType<typeof flightPair>;

/**
 * Serves every flight-lists read: each asked pair's entry from `entry`, the rest of the answer from `over` (a function
 * of the read's number, from 0, so a test changes what a later poll answers), recording each URL.
 */
export function serveFlightLists(
  entry: FlightPairOf,
  over:
    | Parameters<typeof flightListsResponse>[1]
    | ((n: number) => Parameters<typeof flightListsResponse>[1]) = {},
  requests: URL[] = [],
) {
  return http.get(FLIGHT_LISTS_URL, ({ request }) => {
    const url = new URL(request.url);
    const n = requests.length;
    requests.push(url);
    const pairs = askedPairs(url).map((k) => {
      const [dep = '', ret = ''] = k.split('_');
      return entry(dep, ret);
    });
    return HttpResponse.json(flightListsResponse(pairs, typeof over === 'function' ? over(n) : over));
  });
}

/** The POST of one date pair's read: 202 accepted, or the error envelope given; each request's body recorded. */
export function serveFlightRead(
  answer: { status: 202 } | { status: number; code: string; details?: Record<string, unknown> } = {
    status: 202,
  },
  bodies: unknown[] = [],
) {
  return http.post(FLIGHT_LISTS_URL, async ({ request }) => {
    bodies.push(await request.json());
    return 'code' in answer
      ? HttpResponse.json(
          {
            error: {
              code: answer.code,
              message: 'refused',
              ...(answer.details === undefined ? {} : { details: answer.details }),
            },
          },
          { status: answer.status },
        )
      : HttpResponse.json({ accepted: true }, { status: 202 });
  });
}

/** The default reads of the Searches view: one card of the worked example (the default definition's id). */
export const searchesHandlers = [
  serveCards([searchCard()]),
  http.delete(`${API}/definitions/:id`, ({ params }) =>
    HttpResponse.json({ id: String(params.id), deletedAt: '2026-10-14T15:00:00.000Z' }),
  ),
  http.post(`${API}/definitions/:id/restore`, ({ params }) =>
    HttpResponse.json(definition({ id: String(params.id) })),
  ),
  // why: the worked example's searches name no browser worker and their figures are synthetic, so the api answers
  // flight lists not available (`not-named`) and no search link, as it would for them
  serveFlightLists((dep, ret) => flightPair(dep, ret, { link: null }), {
    available: false,
    unavailableReason: 'not-named',
    monthlyPagesLeft: null,
    runPages: null,
  }),
];
