import { type Cabin, type CellKey, cellKeyString, decodeDatePairs, type Iata } from '@gmt/core';
import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
import type { Basis, DatePairsScope, ResultsScope, VerifyCellBody } from './types.js';

/** Query keys; prefixes are what mutations invalidate. */
export const qk = {
  providers: ['providers'] as const,
  definitions: ['definitions'] as const,
  // why: a scoped read (WP19 Task 19.6) holds every scope value in its key; the 'results' prefix still invalidates both
  results: (id: string, basis: Basis | null, scope?: ResultsScope) =>
    scope === undefined
      ? (['results', id, basis ?? 'default'] as const)
      : ([
          'results',
          id,
          basis ?? 'default',
          scope.departureDate,
          scope.returnDate,
          scope.origins ?? '',
          scope.destinations ?? '',
          scope.maxJourneyMinutes ?? '',
        ] as const),
  execution: (id: string) => ['execution', id] as const,
  coverage: (id: string) => ['coverage', id] as const,
  // WP19 §6: the key holds every route parameter, so a filtered read is never answered from an unfiltered one
  datePairs: (id: string, s: DatePairsScope) =>
    ['date-pairs', id, s.origins ?? '', s.destinations ?? '', s.maxJourneyMinutes ?? ''] as const,
  calendarGap: (id: string) => ['calendar-gap', id] as const,
  airports: (q: string) => ['airports', q] as const,
  // WP10
  cell: (id: string, key: string | null) => ['cell', id, key] as const,
  itineraryHistory: (hash: string | null) => ['history', 'itinerary', hash] as const,
  routeHistory: (origin: string, destination: string, cabin: string) =>
    ['history', 'route', origin, destination, cabin] as const,
};

/** Polling interval while a run is moving (spec §10 "updates during run"). */
export const POLL_MS = 2_000;
const POLLING: ReadonlySet<string> = new Set(['pending', 'running']);

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: () => api.providers() });
}

/**
 * The shell's /providers read as an observer only (WP19 Task 19.7), for a view that asks whether the shell already
 * shows the synthetic banner. why: the views render only once /providers has answered or failed; a second active
 * observer mounting on a failed query (it has no data) refetches it and reads as pending again, which unmounted the view
 * and looped. A disabled observer never fetches and still follows every update of the shell's query.
 */
export function useProvidersWatch() {
  return useQuery({ queryKey: qk.providers, queryFn: () => api.providers(), enabled: false });
}

export function useDefinitions() {
  return useQuery({ queryKey: qk.definitions, queryFn: () => api.definitions() });
}

/**
 * One fetch per (definition, basis, scope); every sort and filter is client-side (spec §6.5). With a scope it is the
 * date pair detail's read (spec §11, WP19 Task 19.6); without one, the whole space.
 */
export function useResults(definitionId: string | null, basis: Basis | null, scope?: ResultsScope) {
  return useQuery({
    queryKey: qk.results(definitionId ?? '', basis, scope),
    // why: skipToken idles the query (the pattern from WP10 on, review arch M10), with no rejecting queryFn
    queryFn: definitionId === null ? skipToken : () => api.results(definitionId, basis, scope),
  });
}

/** A run, polled every POLL_MS while pending or running. */
export function useExecution(id: string | null) {
  return useQuery({
    queryKey: qk.execution(id ?? ''),
    queryFn: id === null ? skipToken : () => api.execution(id),
    refetchInterval: (query) =>
      query.state.data !== undefined && POLLING.has(query.state.data.status) ? POLL_MS : false,
  });
}

/**
 * The Dates view's read (spec §10, §11), decoded once by core's `decodeDatePairs`, with the User Timing mark the
 * performance test measures from (WP19 §6). why: no `placeholderData: keepPreviousData` (WP19 §6): it would show the
 * previous key's unfiltered figures while a filtered read loads, and §9 forbids that.
 */
export function useDatePairs(definitionId: string, scope: DatePairsScope) {
  return useQuery({
    queryKey: qk.datePairs(definitionId, scope),
    // why: WP19 Task 19.9: each read is decoded afresh, so sharing structure with the last one only costs a deep walk
    // of up to 36,400 date pairs (about 70 ms) on every re-read; the view compares reads by identity
    structuralSharing: false,
    queryFn: async () => {
      const decoded = decodeDatePairs(await api.datePairs(definitionId, scope));
      performance.mark(DATES_RESPONSE_MARK);
      return decoded;
    },
  });
}

/** The User Timing marks of WP19 §6: the body parsed and decoded, and the board and overview committed. */
export const DATES_RESPONSE_MARK = 'gmt:dates-response';
export const DATES_DRAWN_MARK = 'gmt:dates-drawn';

/**
 * The status bar's execution query as an observer only (WP19 Task 19.4: "same key, no second poll"): the Dates view
 * reads the run's status and progress from it to time its re-reads, and leaves the polling to the status bar.
 */
export function useExecutionWatch(id: string | null) {
  return useQuery({
    queryKey: qk.execution(id ?? ''),
    queryFn: id === null ? skipToken : () => api.execution(id),
  });
}

/** View D and the status bar's "schedule blocked since" (coverage.scheduleBlockedSince). */
export function useCoverage(definitionId: string | null) {
  return useQuery({
    queryKey: qk.coverage(definitionId ?? ''),
    queryFn: definitionId === null ? skipToken : () => api.coverage(definitionId),
  });
}

/** Spec §6.9: only fetched when a verification provider is configured. */
export function useCalendarGap(definitionId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.calendarGap(definitionId),
    queryFn: () => api.calendarGap(definitionId),
    enabled,
  });
}

/** Airport autocomplete (GET /api/airports?q=); two characters minimum. */
export function useAirportSearch(q: string) {
  return useQuery({
    queryKey: qk.airports(q),
    queryFn: () => api.airports(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

/** Cancel, resume, start and single-cell verify, each refreshing every run-dependent query. */
export function useExecutionActions() {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [['results'], ['execution'], ['coverage'], ['date-pairs'], ['calendar-gap'], ['cell'], ['history']].map(
        (queryKey) => qc.invalidateQueries({ queryKey }),
      ),
    );
  };
  return {
    cancel: useMutation({ mutationFn: (id: string) => api.cancel(id), onSuccess: refresh }),
    resume: useMutation({ mutationFn: (id: string) => api.resume(id), onSuccess: refresh }),
    start: useMutation({
      // why: decision 43: a confirmation covers a run only with both its pence and its calls, so both are sent when stored.
      mutationFn: (v: { id: string; confirmCostPence: number | null; confirmCalls: number | null }) =>
        api.startExecution(v.id, {
          ...(v.confirmCostPence === null ? {} : { confirmCostPence: v.confirmCostPence }),
          ...(v.confirmCalls === null ? {} : { confirmCalls: v.confirmCalls }),
        }),
      onSuccess: refresh,
    }),
    verify: useMutation({ mutationFn: (v: VerifyCellBody) => api.verifyCell(v), onSuccess: refresh }),
  };
}

// --- WP10 queries ---

/** One cell's outcomes and prices for the date pair detail's airport-pair panels; idle until a cell is chosen. */
export function useCellDetail(definitionId: string, cell: CellKey | null) {
  return useQuery({
    queryKey: qk.cell(definitionId, cell === null ? null : cellKeyString(cell)),
    // why: TanStack Query 5's skipToken idles the query without a sentinel key or a rejecting queryFn (arch2-013).
    queryFn: cell === null ? skipToken : () => api.cellDetail(definitionId, cell),
  });
}

/** Route history for each origin-destination pair given (one pair, or every pair for the overlay). */
export function useRouteHistories(
  pairs: ReadonlyArray<{ origin: Iata; destination: Iata }>,
  cabin: Cabin,
  enabled: boolean,
) {
  return useQueries({
    queries: pairs.map((p) => ({
      queryKey: qk.routeHistory(p.origin, p.destination, cabin),
      queryFn: () => api.routeHistory(p.origin, p.destination, cabin),
      enabled,
    })),
  });
}

/** One itinerary's offer history; idle without a hash. */
export function useItineraryHistory(hash: string | null) {
  return useQuery({
    queryKey: qk.itineraryHistory(hash),
    queryFn: hash === null ? skipToken : () => api.itineraryHistory(hash),
  });
}
