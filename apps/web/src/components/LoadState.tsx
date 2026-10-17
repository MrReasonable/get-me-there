import { COPY } from '../copy.js';

/** A query in flight: announced politely (review UI-13). */
export function Loading() {
  return <p role="status">{COPY.loading}</p>;
}

/** A query that failed: the reason and a retry, never stale numbers (review UI-13, tsr-011). */
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-red-700 p-2 text-sm">
      <span>{COPY.loadFailed(error.message)}</span>
      <button type="button" className="min-h-11 rounded border border-slate-500 px-3" onClick={retry}>
        {COPY.retryLoad}
      </button>
    </div>
  );
}
