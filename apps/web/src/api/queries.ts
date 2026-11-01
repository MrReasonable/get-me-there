import {
  type Cabin,
  type CellKey,
  cellKeyString,
  decodeDatePairs,
  type Iata,
  IN_FLIGHT_STATUSES,
} from '@gmt/core';
import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from './endpoints.js';
import type {
  Basis,
  DatePairsScope,
  DefinitionBody,
  EstimateResponse,
  ResultsScope,
  StartRefusal,
  VerifyCellBody,
} from './types.js';

/** Query keys; prefixes are what mutations invalidate. */
export const qk = {
  providers: ['providers'] as const,
  definitions: ['definitions'] as const,
  cards: ['cards'] as const,
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
  // WP20 Task 20.5: an unsaved form's estimate, keyed by the very body it was asked for; a saved search's estimate; and
  // a refused Search now's answer, handed from the form to the page it opens (never fetched: see useRefusal)
  estimateDraft: (definitionId: string | null, bodyKey: string) =>
    ['estimate', 'draft', definitionId ?? '', bodyKey] as const,
  refusal: (id: string) => ['refusal', id] as const,
  // WP10
  cell: (id: string, key: string | null) => ['cell', id, key] as const,
  itineraryHistory: (hash: string | null) => ['history', 'itinerary', hash] as const,
  routeHistory: (origin: string, destination: string, cabin: string) =>
    ['history', 'route', origin, destination, cabin] as const,
};

/** Spec rev 55 §11: the estimate is asked for this long after the last change of the form, and never before. */
export const ESTIMATE_DEBOUNCE_MS = 400;

/** What the form knows of its estimate: the one asked for its current body, or why there is none to show. */
export interface DraftEstimate {
  /** The estimate of exactly the current body; null while it is being asked for, or when there is no body. */
  estimate: EstimateResponse | null;
  /** The request for the current body failed (a 422 names its fields). */
  error: Error | null;
}

/**
 * Spec rev 55 §11 (WP20 Task 20.5): the estimate of a form's body, asked for `debounceMs` after the body last changed
 * and never before, and keyed by the body it was fetched for, so an estimate is shown only beside the form it
 * describes: from the first change until the current body's answer arrives, `estimate` is null. That includes coming
 * back to a body asked before: its cached answer is re-read and shown only once the re-read lands (fix round 1,
 * finding 8), so no older figure ever sits beside the press. A null body (the form is incomplete) asks nothing.
 * `immediate` asks for the first body at once (Repeat weekly opens on a whole search). With `definitionId` the body is
 * a saved search's draft and is estimated as that search (`POST /definitions/:id/estimate`, ruling R2), else as an
 * unsaved form (`POST /definitions/estimate`). The debounce is a `setTimeout` cleared on change; tests step it on
 * Vitest's fake clock.
 */
export function useEstimateDraft(
  body: DefinitionBody | null,
  opts: { debounceMs?: number; immediate?: boolean; definitionId?: string | null } = {},
): DraftEstimate & { refetch: () => void } {
  const { debounceMs = ESTIMATE_DEBOUNCE_MS, immediate = false, definitionId = null } = opts;
  const key = body === null ? null : JSON.stringify(body);
  const [asked, setAsked] = useState<{ key: string; body: DefinitionBody } | null>(() =>
    immediate && body !== null && key !== null ? { key, body } : null,
  );
  // why: the timer reads the body of the key it settles, never an older render's
  const latest = useRef(body);
  latest.current = body;
  useEffect(() => {
    if (key === null) return;
    const t = setTimeout(() => {
      const b = latest.current;
      if (b !== null) setAsked((a) => (a?.key === key ? a : { key, body: b }));
    }, debounceMs);
    return () => clearTimeout(t);
  }, [key, debounceMs]);
  const q = useQuery({
    queryKey: qk.estimateDraft(definitionId, asked?.key ?? ''),
    queryFn:
      asked === null
        ? skipToken
        : () =>
            definitionId === null
              ? api.estimateDraft(asked.body)
              : api.estimateDefinition(definitionId, asked.body),
    // why: a refused body (422) is the form's to fix, never retried; the estimate depends on this month's usage, so a
    // cached answer for the same body is always re-read before it is shown again
    retry: false,
    staleTime: 0,
  });
  const current = key !== null && asked?.key === key && !q.isFetching;
  return {
    estimate: current ? (q.data ?? null) : null,
    error: current ? q.error : null,
    refetch: () => void q.refetch(),
  };
}

/**
 * A saved search's estimate as it stands (`POST /definitions/:id/estimate` with its own fields as the body, ruling
 * R2), asked while `body` is known and `enabled`: Search again's second look and a refused Search now's page (spec rev
 * 55 §11). Re-asked on every mount, never retried; `data` is undefined while a read is in flight, so a cached older
 * answer never shows.
 */
export function useDefinitionEstimate(id: string, body: DefinitionBody | null, enabled: boolean) {
  const q = useQuery({
    queryKey: qk.estimateDraft(id, body === null ? '' : JSON.stringify(body)),
    queryFn: body === null ? skipToken : () => api.estimateDefinition(id, body),
    enabled: enabled && body !== null,
    retry: false,
    staleTime: 0,
  });
  // why: follow-up 3 — the rule `useEstimateDraft` keeps: a cached answer is not current while it is read again (a
  // remount, a refetch after a refusal), so no older figure is shown beside the press
  return {
    data: q.isFetching ? undefined : q.data,
    error: q.isFetching ? null : q.error,
    isFetching: q.isFetching,
    refetch: q.refetch,
  };
}

/**
 * The refusal a Search now press answered, as the form left it for the page it opened (spec rev 55 §11: "it resets on
 * <date>" needs the refusal's `resetsAt`, which the URL does not carry). An observer only: it never fetches, so after a
 * reload it is undefined and the page words the code alone.
 */
export function useRefusal(id: string) {
  return useQuery<StartRefusal>({ queryKey: qk.refusal(id), queryFn: skipToken, enabled: false });
}

/** Polling interval while a run is moving (spec §10 "updates during run"). */
export const POLL_MS = 2_000;
const POLLING: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);

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

/** The month's spend (GET /budget): read by the status bar on every view, re-read every minute. */
export function useBudget() {
  return useQuery({ queryKey: ['budget'] as const, queryFn: () => api.budget(), refetchInterval: 60_000 });
}

export function useDefinitions() {
  return useQuery({ queryKey: qk.definitions, queryFn: () => api.definitions() });
}

/**
 * The first screen's read (spec rev 55 §10, §11): the cards in the served order. It re-reads at the status bar's poll
 * interval only while a card's latest run is pending or running, and idles otherwise; `poll: false` never re-reads by
 * itself.
 */
export function useCards(opts: { poll?: boolean } = {}) {
  const { poll = true } = opts;
  return useQuery({
    queryKey: qk.cards,
    queryFn: () => api.cards(),
    // why: WP20 Task 20.6 and the final review — a search's page reads its card for the api's `spaceChangedSince` and
    // the whole search's counts: once while its run is idle (and again when an action refreshes the cards), and at the
    // poll interval while its own run is pending or running (`poll: runActive`), as the first screen and the bar do
    refetchInterval: (query) =>
      poll && query.state.data?.cards.some((c) => c.latestRun !== null && POLLING.has(c.latestRun.status))
        ? POLL_MS
        : false,
  });
}

/**
 * Remove and Undo (spec rev 55 §10, §11). Neither refreshes anything by itself: the Searches view keeps its served order
 * while one of them is pending and puts the "Removed" line in place before it asks for a re-read, so it calls `refresh`
 * itself once the line is up (a removed card then never vanishes for a frame before its line appears).
 */
export function useSearchRemoval() {
  const qc = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [['cards'], ['definitions'], ['execution'], ['results'], ['coverage'], ['date-pairs']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
  };
  return {
    remove: useMutation({ mutationFn: (id: string) => api.removeDefinition(id) }),
    restore: useMutation({ mutationFn: (id: string) => api.restoreDefinition(id) }),
    refresh,
  };
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
 * Spec rev 55 §11 (WP20 Task 20.6; rulings B7, R-coupling): a search's page observes its latest parent run with a poll
 * of its own every POLL_MS while the run is pending or running. When the status bar polls the same run the two are one
 * query (the same key), so the library asks once per read; the page never needs to know which run the bar shows.
 */
export function useLatestRun(id: string | null) {
  return useExecution(id);
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
        ['date-pairs'],
        ['calendar-gap'],
        ['cell'],
        ['history'],
        ['cards'],
      ].map((queryKey) => qc.invalidateQueries({ queryKey })),
    );
  };
  return {
    cancel: useMutation({ mutationFn: (id: string) => api.cancel(id), onSuccess: refresh }),
    resume: useMutation({ mutationFn: (id: string) => api.resume(id), onSuccess: refresh }),
    start: useMutation({
      // why: decision 43: a confirmation covers a run only with both its pence and its calls, so both are sent when stored.
      // Search again adds `requireCovered` (refuse a start the sent figures do not cover) and `replaceStopped` (a fresh
      // start over a stopped run), spec rev 55 §8.1.
      mutationFn: (v: {
        id: string;
        confirmCostPence: number | null;
        confirmCalls: number | null;
        requireCovered?: boolean;
        replaceStopped?: boolean;
      }) =>
        api.startExecution(v.id, {
          ...(v.confirmCostPence === null ? {} : { confirmCostPence: v.confirmCostPence }),
          ...(v.confirmCalls === null ? {} : { confirmCalls: v.confirmCalls }),
          ...(v.requireCovered === undefined ? {} : { requireCovered: v.requireCovered }),
          ...(v.replaceStopped === undefined ? {} : { replaceStopped: v.replaceStopped }),
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
