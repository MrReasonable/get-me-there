import { HttpResponse, http, type JsonBodyType } from 'msw';
import type { SearchCard } from '../../src/api/types.js';
import { API, definition } from '../fixtures.js';
import { cardsResponse, searchCard } from '../fixtures.searches.js';

// msw handlers for the Searches view (WP20 Task 20.3): `GET /api/definitions/cards`, Remove and Undo.

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

/** The default reads of the Searches view: one card of the worked example (the default definition's id). */
export const searchesHandlers = [
  serveCards([searchCard()]),
  http.delete(`${API}/definitions/:id`, ({ params }) =>
    HttpResponse.json({ id: String(params.id), deletedAt: '2026-10-14T15:00:00.000Z' }),
  ),
  http.post(`${API}/definitions/:id/restore`, ({ params }) =>
    HttpResponse.json(definition({ id: String(params.id) })),
  ),
];
