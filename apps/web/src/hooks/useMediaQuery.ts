import { useSyncExternalStore } from 'react';

/**
 * Spec §11: below this width the primary row keeps price, provenance, class badge, dates and stops. The wide table
 * has twelve columns, so it needs a desktop width; a tablet gets the stacked layout (UI-3).
 */
export const NARROW_QUERY = '(max-width: 1023px)';

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
