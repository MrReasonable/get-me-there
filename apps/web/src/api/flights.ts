import { apiContract as c } from '@gmt/core';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { call } from './client.js';
import { POLL_MS } from './queries.js';
import type { FlightListsResponse } from './types.js';

// Spec rev 55 §10 and §11 (WP20 Task 20.10): a search's page's flight lists. `GET /definitions/:id/flight-lists?pairs=`
// answers the date pairs the board shows (one request per page of rows, each at most MAX_FLIGHT_LIST_PAIRS), and
// `POST /definitions/:id/flight-lists` reads one date pair's list now; its outcome comes back through the GET, which
// is polled every POLL_MS only while a read is going (§6 library note).

/** The two routes, each through the ROUTES entry's own schemas. */
export const flightListsApi = {
  get: (id: string, pairs: readonly string[]) =>
    call(c.flightListsResponseSchema, 'GET', '/api/definitions/:id/flight-lists', {
      params: { id },
      query: { pairs: pairs.join(',') },
    }),
  read: (id: string, pair: { departureDate: string; returnDate: string }) =>
    call(c.readFlightListResponseSchema, 'POST', '/api/definitions/:id/flight-lists', {
      params: { id },
      body: pair,
    }),
};

/** The flight-lists query key prefix of one search; a read on demand invalidates it. */
export const flightListsKey = (id: string) => ['flight-lists', id] as const;

/**
 * One query per page of asked date pairs (`pages`, from `requestPages`), so "Show 10 more" adds one request and keeps
 * the earlier answers. A page is re-read every POLL_MS while `polling` says so (a read on demand is going), and never
 * otherwise. Returns every page's answer that has arrived, in page order.
 */
export function useFlightLists(
  id: string,
  pages: readonly (readonly string[])[],
  polling: boolean,
): { answers: FlightListsResponse[]; fetchedAt: number } {
  return useQueries({
    queries: pages
      .filter((p) => p.length > 0)
      .map((p) => ({
        queryKey: [...flightListsKey(id), p.join(',')] as const,
        queryFn: () => flightListsApi.get(id, p),
        refetchInterval: polling ? POLL_MS : (false as const),
      })),
    combine: (results) => ({
      answers: results.flatMap((r) => (r.data === undefined ? [] : [r.data])),
      // why: the newest answer's time, so a read on demand knows when an answer came after its press
      fetchedAt: Math.max(0, ...results.map((r) => r.dataUpdatedAt)),
    }),
  });
}

/**
 * Spec rev 55 §8.1 "Reading one date pair's flights": the press of "Read flights for this date". On success the
 * search's flight-lists answers are read again at once (the answer then says the pair is being read).
 */
export function useFlightRead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pair: { departureDate: string; returnDate: string }) => flightListsApi.read(id, pair),
    onSuccess: () => qc.invalidateQueries({ queryKey: flightListsKey(id) }),
  });
}
