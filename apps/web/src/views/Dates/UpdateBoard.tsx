import { COPY } from '../../copy.js';

/**
 * Revision 50 (Ian ruled 2026-10-26): while a run is in progress and the pointer is over the board or focus is inside
 * it, a read that changes the board is held, and this button applies it. It sits in the board's region, after the
 * rows and "Show 10 more", so it is reachable by Tab from the board; the view announces it once per read.
 */
export function UpdateBoard({ changes, onApply }: { changes: number; onApply: () => void }) {
  return (
    // why: a board button whose lamp is lit amber while changes wait; the count and the words say the same
    <button type="button" className="btn btn-primary update-board min-h-11" onClick={onApply}>
      <span aria-hidden="true" className="lamp-dot" data-lamp="amber" />
      {COPY.datesView.updateBoard(changes)}
    </button>
  );
}
