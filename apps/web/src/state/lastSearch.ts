import { useSyncExternalStore } from 'react';

/**
 * Spec rev 55 §11 layout (WP20 Task 20.3): the search last opened, kept in the browser as `gmt.lastSearch`. A search's
 * page writes it on mount and a card's See dates writes it before it navigates; the nav's Decide tier names the search
 * by it and is absent until one has been opened.
 *
 * It is a per-viewer convenience only: every access is wrapped, so a private window, blocked site data or a throwing
 * `localStorage` reads as "none opened" and writes nothing, and the page renders the same without it.
 */
export const LAST_SEARCH_KEY = 'gmt.lastSearch';

/** The id of the search last opened, or null when none was, when storage is empty or when it cannot be read. */
export function readLastSearch(): string | null {
  try {
    const id = window.localStorage.getItem(LAST_SEARCH_KEY);
    return id === null || id === '' ? null : id;
  } catch {
    // why: storage may be missing or throw (private window, blocked data); "none opened" is the honest reading
    return null;
  }
}

const listeners = new Set<() => void>();

/** Remembers `id` as the search last opened; a storage that refuses the write is ignored. */
export function writeLastSearch(id: string): void {
  try {
    window.localStorage.setItem(LAST_SEARCH_KEY, id);
  } catch {
    // why: nothing depends on the write having happened
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** The search last opened, following every write in this tab and in another (the `storage` event). */
export function useLastSearch(): string | null {
  return useSyncExternalStore(subscribe, () => readLastSearch());
}
