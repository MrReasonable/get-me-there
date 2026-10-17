import { useMemo, useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const getSnapshot = () => window.location.search;

/** The current search params; re-renders on every updateSearchParams and on back/forward. */
export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSnapshot);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** The href for the current URL with `patch` applied (null deletes); every other parameter is kept. */
export function hrefWith(patch: Record<string, string | null>): string {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  return `${window.location.pathname}?${p.toString()}`;
}

/** Applies `patch` to the URL: `push` for navigation, `replace` for filter edits. */
export function updateSearchParams(
  patch: Record<string, string | null>,
  mode: 'push' | 'replace' = 'replace',
): void {
  const url = hrefWith(patch);
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
  for (const l of listeners) l();
}

/** The parts of a click navigateTo reads; React's MouseEvent has them. */
export interface NavClick {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button: number;
  preventDefault(): void;
}

/** onClick for an <a href={hrefWith(patch)}>: client-side navigation that keeps the link a real link. */
export function navigateTo(patch: Record<string, string | null>) {
  return (e: NavClick) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    updateSearchParams(patch, 'push');
  };
}
