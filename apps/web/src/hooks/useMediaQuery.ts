import { useSyncExternalStore } from 'react';

/** Spec §11 Phone: below 900 px the board is stacked cards, the overview one month at a time and the nav one row. */
export const PHONE_QUERY = '(max-width: 899px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}
