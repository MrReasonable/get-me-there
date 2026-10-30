import { COPY } from '../copy.js';

/** A query in flight: announced politely (review UI-13). */
export function Loading() {
  return (
    <p role="status" className="loading-line">
      {COPY.loading}
    </p>
  );
}

/** A query that failed: the reason and a retry, never stale numbers (review UI-13, tsr-011). */
export function LoadError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="plate notice flex flex-wrap items-center gap-3 text-sm">
      <span aria-hidden="true" className="tag tag-bad">
        ✕
      </span>
      <span>{COPY.loadFailed(error.message)}</span>
      <button type="button" className="btn btn-sm min-h-11" onClick={retry}>
        {COPY.retryLoad}
      </button>
    </div>
  );
}
