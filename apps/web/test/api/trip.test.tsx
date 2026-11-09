import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useFlightRead } from '../../src/api/flights.js';
import { qk, useTrip } from '../../src/api/queries.js';
import { API } from '../fixtures.js';
import { server } from '../msw/server.js';

// Design 2026-11-08 §6.1 (plan Task 6): the trip read and the flight read the Trip page and the board share.

const BODY = {
  departureDate: '2027-03-14',
  returnDate: '2027-03-24',
  nights: 10,
  inWindow: true,
  figure: null,
  journeyLeftOut: 0,
  listFailure: null,
  cells: [],
  flightList: null,
  bookingUrl: null,
  searchLink: null,
  booking: null,
  calendar: null,
  cached: null,
  log: [],
  reading: false,
  read: {
    available: true,
    unavailableReason: null,
    wouldGo: true,
    pagesPlanned: 1,
    origin: null,
    destination: null,
  },
  verificationConfigured: true,
  refreshHours: 168,
  limits: { maxJourneyMinutes: null, maxStops: null, departureWindowLocal: null, arrivalWindowLocal: null },
};

function wrapperOf(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('useTrip', () => {
  it('asks the trip route under the scope names and returns the parsed trip', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(`${API}/definitions/:id/trip`, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(BODY);
      }),
    );
    const query = {
      departureDate: '2027-03-14',
      returnDate: '2027-03-24',
      origins: 'LGW',
      maxJourneyMinutes: '1500',
    };
    const { result } = renderHook(() => useTrip('def-1', query), { wrapper: wrapperOf(newClient()) });
    await waitFor(() => expect(result.current.data?.nights).toBe(10));
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual(query);
  });

  it('asks nothing with no query', () => {
    const { result } = renderHook(() => useTrip('def-1', null), { wrapper: wrapperOf(newClient()) });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useFlightRead', () => {
  it('sends the dates and the named airport pair, and re-reads the search’s trips and flight lists', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/:id/flight-lists`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ accepted: true });
      }),
    );
    const client = newClient();
    const tripKey = qk.trip('def-1', { departureDate: '2027-03-14', returnDate: '2027-03-24' });
    client.setQueryData(tripKey, BODY);
    const { result } = renderHook(() => useFlightRead('def-1'), { wrapper: wrapperOf(client) });
    await act(() =>
      result.current.mutateAsync({
        departureDate: '2027-03-14',
        returnDate: '2027-03-24',
        origin: 'LGW',
        destination: 'JFK',
      }),
    );
    expect(bodies).toEqual([
      { departureDate: '2027-03-14', returnDate: '2027-03-24', origin: 'LGW', destination: 'JFK' },
    ]);
    expect(client.getQueryState(tripKey)?.isInvalidated).toBe(true);
  });

  it('the board names the dates alone', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${API}/definitions/:id/flight-lists`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ accepted: true });
      }),
    );
    const { result } = renderHook(() => useFlightRead('def-1'), { wrapper: wrapperOf(newClient()) });
    await act(() => result.current.mutateAsync({ departureDate: '2027-03-14', returnDate: '2027-03-24' }));
    expect(bodies).toEqual([{ departureDate: '2027-03-14', returnDate: '2027-03-24' }]);
  });
});
