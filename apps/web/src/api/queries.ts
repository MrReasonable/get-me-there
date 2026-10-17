import { type Cabin, type CellKey, cellKeyString, type Iata } from '@gmt/core';
import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';
import type { Basis, VerifyCellBody } from './types.js';

/** Query keys; prefixes are what mutations invalidate. */
export const qk = {
  providers: ['providers'] as const,
  definitions: ['definitions'] as const,
  results: (id: string, basis: Basis | null) => ['results', id, basis ?? 'default'] as const,
  execution: (id: string) => ['execution', id] as const,
  coverage: (id: string) => ['coverage', id] as const,
  calendarGap: (id: string) => ['calendar-gap', id] as const,
  airports: (q: string) => ['airports', q] as const,
  // WP10
  calendar: (id: string, destination: Iata | null) => ['calendar', id, destination ?? 'all'] as const,
  duration: (id: string) => ['duration', id] as const,
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

export function useDefinitions() {
  return useQuery({ queryKey: qk.definitions, queryFn: () => api.definitions() });
}

/** One fetch per (definition, basis); every sort and filter is client-side (spec §6.5). */
export function useResults(definitionId: string | null, basis: Basis | null) {
  return useQuery({
    queryKey: qk.results(definitionId ?? '', basis),
    // why: skipToken idles the query (the pattern from WP10 on, review arch M10), with no rejecting queryFn
    queryFn: definitionId === null ? skipToken : () => api.results(definitionId, basis),
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
      [
        ['results'],
        ['execution'],
        ['coverage'],
        ['calendar-gap'],
        ['calendar'],
        ['duration'],
        ['cell'],
        ['history'],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
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

/**
 * Refetch every POLL_MS while the newest run a response names is pending or running, the status bar's cadence, so
 * the heatmap and the duration chart fill in during a run (spec §10 "updates during run").
 */
export function whileRunning(
  data: { executions: ReadonlyArray<{ status: string }> } | undefined,
): number | false {
  const latest = data?.executions[0];
  return latest !== undefined && POLLING.has(latest.status) ? POLL_MS : false;
}

/** View B data (spec §10 calendar route), for one destination or all (plan decision 53: the api computes the filter). */
export function useCalendar(definitionId: string, destination: Iata | null) {
  return useQuery({
    queryKey: qk.calendar(definitionId, destination),
    queryFn: () => api.calendar(definitionId, destination),
    refetchInterval: (query) => whileRunning(query.state.data),
  });
}

/** View C data (spec §10 duration-analysis route). */
export function useDurationAnalysis(definitionId: string) {
  return useQuery({
    queryKey: qk.duration(definitionId),
    queryFn: () => api.durationAnalysis(definitionId),
    refetchInterval: (query) => whileRunning(query.state.data),
  });
}

/** One cell's outcomes and prices for the View B side panel; idle until a cell is chosen. */
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
