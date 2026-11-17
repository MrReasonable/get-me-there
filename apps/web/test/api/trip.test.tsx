import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flightListsKey, useFlightRead } from '../../src/api/flights.js';
import { POLL_MS, qk, useTrip, useVerifyCell } from '../../src/api/queries.js';
import { API, execution } from '../fixtures.js';
import { server } from '../msw/server.js';
import { NOW } from '../render.js';

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
  pointOfSale: 'GB',
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

  // deferred minor 18: the card leaves "reading" only by this re-read, so it polls exactly while a read is in flight
  describe('polling', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('asks again every POLL_MS while a read is in flight, and stops once it is not', async () => {
      // why: the poll (the query's setInterval) is driven by fake timers stepped explicitly, never by the wall clock
      // (CodeRabbit PR #58 finding 11: `shouldAdvanceTime` let real elapsed time fire a poll early); only the interval
      // is faked, so each request and answer settles on its own, and each is awaited as the hook's own data
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      let hits = 0;
      server.use(
        http.get(`${API}/definitions/:id/trip`, () => {
          hits += 1;
          return HttpResponse.json({ ...BODY, reading: hits < 3 });
        }),
      );
      const query = { departureDate: '2027-03-14', returnDate: '2027-03-24' };
      const { result } = renderHook(() => useTrip('def-1', query), { wrapper: wrapperOf(newClient()) });
      // why: vitest's own waitFor runs on the real timers it keeps aside, so it is not held by the faked interval
      await vi.waitFor(() => expect(result.current.data?.reading).toBe(true));
      expect(hits).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      await vi.waitFor(() => expect(hits).toBe(2));
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
      await vi.waitFor(() => expect(result.current.data?.reading).toBe(false));
      expect(hits).toBe(3);
      await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 5));
      expect(hits).toBe(3);
    });
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
    // why: CodeRabbit PR #58 finding 10: the board's flight-list pages are read again too, so one is seeded and checked
    const listsKey = [...flightListsKey('def-1'), '2027-03-14_2027-03-24'];
    client.setQueryData(listsKey, { pairs: [] });
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
    expect(client.getQueryState(listsKey)?.isInvalidated).toBe(true);
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

// why: CodeRabbit PR #58 finding 6: a SearchApi check goes on after its request answers, so the trip read is read again
// once that run settles, never only when the check starts
describe('useVerifyCell', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the search’s trips again once the check’s run leaves its in-flight status', async () => {
    // why: only the run's poll interval is faked, stepped explicitly; requests settle on their own
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let status: 'running' | 'completed' = 'running';
    let polls = 0;
    server.use(
      http.post(`${API}/cells/verify`, () => HttpResponse.json({ executionId: 'exec-0002' })),
      http.get(`${API}/executions/:id`, () => {
        polls += 1;
        return HttpResponse.json(
          execution({
            id: 'exec-0002',
            isChild: true,
            status,
            finishedAt: status === 'running' ? null : NOW,
          }),
        );
      }),
    );
    const client = newClient();
    const tripKey = qk.trip('def-1', { departureDate: '2027-03-14', returnDate: '2027-03-24' });
    const { result } = renderHook(() => useVerifyCell('def-1'), { wrapper: wrapperOf(client) });
    await act(() =>
      result.current.mutateAsync({
        definitionId: 'def-1',
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-14', returnDate: '2027-03-24' },
      }),
    );
    await vi.waitFor(() => expect(polls).toBe(1));
    // the trip answered while the run is in flight is kept: nothing new to read yet
    client.setQueryData(tripKey, BODY);
    expect(client.getQueryState(tripKey)?.isInvalidated).toBe(false);
    status = 'completed';
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await vi.waitFor(() => expect(client.getQueryState(tripKey)?.isInvalidated).toBe(true));
    expect(polls).toBe(2);
  });
});
