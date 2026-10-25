import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './endpoints.js';

/** The one query key the Status view and the status bar's link share (spec §11), so they never disagree. */
export const STATUS_KEY = ['status'] as const;
/** The report refreshes every 60 s and on focus (spec §11 Status). */
export const STATUS_REFRESH_MS = 60_000;

export function useStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api.status(),
    refetchInterval: STATUS_REFRESH_MS,
    refetchOnWindowFocus: true,
    // why: the page's default keeps data for 30 s; this report is the one a person checks after fixing something
    staleTime: 10_000,
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
