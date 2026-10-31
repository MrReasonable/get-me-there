import { useEffect, useRef } from 'react';
import { COPY } from '../../copy.js';

const S = COPY.searchesView;

/**
 * Spec rev 55 §11 "Searches": the line that replaces a removed card, "Removed <name>. Undo", in a polite status region,
 * with focus on Undo (the card it replaced is gone, so focus would otherwise fall to the page). It expires after `ms`
 * (the view's `UNDO_MS`) and survives every re-read of the cards, because the view, not the cards, owns it. A failed undo
 * is said in words beside the button.
 */
export function RemovedLine({
  name,
  undoing,
  undoError,
  onUndo,
  onExpire,
  ms,
}: {
  name: string;
  undoing: boolean;
  undoError: Error | null;
  onUndo: () => void;
  onExpire: () => void;
  ms: number;
}) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    undoRef.current?.focus();
    const timer = setTimeout(() => expire.current(), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return (
    <li className="plate plate-pad search-removed">
      <div role="status" className="flex flex-wrap items-center gap-3">
        <span>{S.removed(name)}</span>
        <button
          ref={undoRef}
          type="button"
          className="btn btn-sm min-h-11"
          disabled={undoing}
          aria-busy={undoing ? true : undefined}
          aria-label={S.undoOf(name)}
          onClick={onUndo}
        >
          {undoing ? COPY.working : S.undo}
        </button>
        {undoError !== null ? (
          <span className="bad-text text-sm">{S.restoreFailedLine(undoError.message)}</span>
        ) : null}
      </div>
    </li>
  );
}
