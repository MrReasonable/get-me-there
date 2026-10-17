import { type CellKey, daysBetween } from '@gmt/core';
import { useExecutionActions } from '../api/queries.js';
import { COPY } from '../copy.js';
import { formatIsoDate } from '../format.js';

/**
 * The name of one cell's itinerary search ("LHR → JFK 14 Mar 2027–28 Mar 2027 (14n)"), the one wording Coverage, Results
 * and the Calendar panel share so the same cell is never called two things (review arch M1).
 */
export function verifyCellName(cell: CellKey): string {
  return `${COPY.coverageCheckPair(cell.origin, cell.destination)} ${COPY.dateRange(
    formatIsoDate(cell.departureDate),
    formatIsoDate(cell.returnDate),
    daysBetween(cell.departureDate, cell.returnDate),
  )}`;
}

/**
 * Per-cell itinerary search (spec §8.1; billed calls). One instance per cell: its name says which cell it
 * searches, it is disabled while its request is in flight (so a double tap cannot spend twice), and its own
 * status line names the cell it started (UI-5).
 */
export function VerifyCellButton({ definitionId, cell }: { definitionId: string; cell: CellKey }) {
  const { verify } = useExecutionActions();
  const name = verifyCellName(cell);
  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3"
        disabled={verify.isPending}
        aria-busy={verify.isPending ? true : undefined}
        onClick={() => verify.mutate({ definitionId, cell })}
      >
        {verify.isPending ? COPY.working : COPY.verifyCellFor(name)}
      </button>
      {verify.isSuccess ? <p role="status">{COPY.verifyStartedFor(name)}</p> : null}
      {verify.error ? <p role="alert">{COPY.actionFailed(verify.error.message)}</p> : null}
    </span>
  );
}
