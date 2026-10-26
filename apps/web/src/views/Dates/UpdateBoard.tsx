import { COPY } from '../../copy.js';

/**
 * Revision 50 (Ian ruled 2026-10-26): while a run is in progress and the pointer is over the board or focus is inside
 * it, a read that changes the board is held, and this button applies it. It sits in the board's region, after the
 * rows and "Show 10 more", so it is reachable by Tab from the board; the view announces it once per read.
 */
export function UpdateBoard({ changes, onApply }: { changes: number; onApply: () => void }) {
  return (
    <button
      type="button"
      className="min-h-11 rounded border-2 border-slate-900 px-3 font-semibold"
      onClick={onApply}
    >
      {COPY.datesView.updateBoard(changes)}
    </button>
  );
}
