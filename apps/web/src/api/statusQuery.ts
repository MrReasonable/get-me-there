import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from './client.js';
import { api } from './endpoints.js';

/** The one query key the Status view and the status bar's link share (spec §11), so they never disagree. */
export const STATUS_KEY = ['status'] as const;
/** The report refreshes every 60 s and on focus (spec §11 Status). */
export const STATUS_REFRESH_MS = 60_000;
/** The one retry waits this long, so a dead app shows at once. */
export const STATUS_RETRY_DELAY_MS = 500;

/** How a failed status read is worded: no answer at all, a refused sign-in, or an answer that was an error (V11). */
export type StatusFailure = 'not-answering' | 'sign-in-refused' | 'report-failed';
export function failureOf(error: Error): StatusFailure {
  if (!(error instanceof ApiError) || error.code === 'network') return 'not-answering';
  return error.status === 401 ? 'sign-in-refused' : 'report-failed';
}

export function useStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api.status(),
    refetchInterval: STATUS_REFRESH_MS,
    refetchOnWindowFocus: true,
    // why: the page's default keeps data for 30 s; this report is the one a person checks after fixing something
    staleTime: 10_000,
    // why: V11 (ui-b1-003): the 60 s refetch is the retry; one more try at most, so a dead app shows at once
    retry: 1,
    retryDelay: STATUS_RETRY_DELAY_MS,
  });
}

/** "Send test" on the email card: one test message, then the report reloads so the card shows the result. */
export function useSendTestEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.testEmail(),
    onSettled: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}
