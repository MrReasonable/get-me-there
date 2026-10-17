import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
    queryFn: () => api.results(definitionId ?? '', basis),
    enabled: definitionId !== null,
  });
}

/** A run, polled every POLL_MS while pending or running. */
export function useExecution(id: string | null) {
  return useQuery({
    queryKey: qk.execution(id ?? ''),
    queryFn: () => api.execution(id ?? ''),
    enabled: id !== null,
    refetchInterval: (query) =>
      query.state.data !== undefined && POLLING.has(query.state.data.status) ? POLL_MS : false,
  });
}

/** View D and the status bar's "schedule blocked since" (coverage.scheduleBlockedSince). */
export function useCoverage(definitionId: string | null) {
  return useQuery({
    queryKey: qk.coverage(definitionId ?? ''),
    queryFn: () => api.coverage(definitionId ?? ''),
    enabled: definitionId !== null,
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
      [['results'], ['execution'], ['coverage'], ['calendar-gap']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
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
