import type { CellKey } from '@gmt/core';
import { useVerifyCell } from '../api/queries.js';
import { COPY } from '../copy.js';

/**
 * Design 2026-11-08 §6.1: "Check with SearchApi · 1 credit", the per-cell check (spec §8.1) the Trip page offers only
 * where it can run. Disabled while its request is in flight, so a double tap cannot spend twice; its own status line
 * says the check started (UI-5), and the page reads its trip again once the check's run has settled.
 */
export function VerifyCellButton({ definitionId, cell }: { definitionId: string; cell: CellKey }) {
  // why: the trip read is read again once the check's run settles, not only when it starts (CodeRabbit PR #58 finding 6)
  const verify = useVerifyCell(definitionId);
  return (
    <span className="trip-action">
      <button
        type="button"
        className="trip-btn"
        disabled={verify.isPending}
        aria-busy={verify.isPending ? true : undefined}
        onClick={() => verify.mutate({ definitionId, cell })}
      >
        {verify.isPending ? COPY.working : COPY.trip.checkWithSearchApi}
      </button>
      {verify.isSuccess ? <span role="status">{COPY.trip.checkStarted}</span> : null}
      {verify.error ? <span role="alert">{COPY.actionFailed(verify.error.message)}</span> : null}
    </span>
  );
}
