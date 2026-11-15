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

/**
 * The fragment policy (final review C2/I1), the one place it lives: a filter edit (`replace`) keeps the page's
 * fragment, an anchor the page was opened at; a navigation (`push`, and so every link `hrefWith` writes) drops it
 * unless the link names its own, so an anchor one page was opened at never travels to another page.
 */
const hashFor = (mode: 'push' | 'replace', hash: string | undefined): string =>
  hash ?? (mode === 'replace' ? window.location.hash : '');

/**
 * The href for the current URL with `patch` applied (null deletes); every other parameter is kept. A link navigates,
 * so the page's fragment is dropped; `hash` (with its "#") names the link's own, an anchor on the page it opens.
 */
export function hrefWith(patch: Record<string, string | null>, hash?: string): string {
  return urlWith(patch, hashFor('push', hash));
}

function urlWith(patch: Record<string, string | null>, hash: string): string {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) p.delete(k);
    else p.set(k, v);
  }
  return `${window.location.pathname}?${p.toString()}${hash}`;
}

/**
 * Applies `patch` to the URL: `push` for navigation, `replace` for filter edits. `hash` names the fragment to land at
 * ("" drops it); without one a `replace` keeps the page's and a `push` drops it (`hashFor`).
 */
export function updateSearchParams(
  patch: Record<string, string | null>,
  mode: 'push' | 'replace' = 'replace',
  hash?: string,
): void {
  const url = urlWith(patch, hashFor(mode, hash));
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

/** onClick for an <a href={hrefWith(patch, hash)}>: client-side navigation that keeps the link a real link. */
export function navigateTo(patch: Record<string, string | null>, hash?: string) {
  return (e: NavClick) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    updateSearchParams(patch, 'push', hash);
  };
}

/**
 * The click of a link whose address is built from scratch (`query`, a "?…" search part, perhaps with its own "#…"): it
 * goes to exactly that address, every parameter the URL held and the address does not name dropped, so the click and
 * the link's own address never differ (CodeRabbit PR #58 finding 9). The fragment is split off before the parameters
 * are read (`URLSearchParams` would keep it in the last value: final review C2) and is the only one the click lands at.
 */
export function navigateToQuery(query: string) {
  return (e: NavClick) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const at = query.indexOf('#');
    const patch: Record<string, string | null> = {};
    for (const k of new URLSearchParams(window.location.search).keys()) patch[k] = null;
    for (const [k, v] of new URLSearchParams(at < 0 ? query : query.slice(0, at))) patch[k] = v;
    updateSearchParams(patch, 'push', at < 0 ? '' : query.slice(at));
  };
}
