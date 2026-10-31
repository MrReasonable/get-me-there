import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../copy.js';

const S = COPY.searchesView;

/**
 * Spec rev 55 §11 "Searches", Remove: it asks inline, with no modal ("Remove <name>? Remove · Keep", focus on Remove; on
 * a pending or running search "Cancel and remove <name>?", which cancels its run). Keep puts the actions back and
 * returns focus to the Remove button that was pressed. The remove itself, the "Removed … Undo" line and the re-read belong
 * to the view (`onRemove`), so they outlast this card. A failed remove is said in words beside the action.
 */
export function RemoveSearch({
  name,
  active,
  pending,
  error,
  onRemove,
}: {
  name: string;
  /** The search is pending or running: removing it cancels its run first. */
  active: boolean;
  /** The remove is in flight. */
  pending: boolean;
  /** The last remove of this search failed. */
  error: Error | null;
  onRemove: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // why: focus follows the state change, not the click: the button it moves to does not exist until the render
  const returnFocus = useRef(false);
  useEffect(() => {
    if (asking) confirmRef.current?.focus();
    else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);
  return (
    <span className="search-remove">
      {asking ? (
        <span className="search-remove-ask">
          <span className="font-semibold">{active ? S.cancelAndRemoveAsk(name) : S.removeAsk(name)}</span>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-danger btn-sm min-h-11"
            disabled={pending}
            aria-busy={pending ? true : undefined}
            onClick={() => {
              setAsking(false);
              onRemove();
            }}
          >
            {pending ? COPY.working : S.removeConfirm}
          </button>
          <button
            type="button"
            className="btn btn-sm min-h-11"
            onClick={() => {
              returnFocus.current = true;
              setAsking(false);
            }}
          >
            {S.keep}
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="btn btn-quiet btn-sm min-h-11"
          disabled={pending}
          aria-label={S.removeOf(name)}
          aria-busy={pending ? true : undefined}
          onClick={() => setAsking(true)}
        >
          {pending ? COPY.working : S.remove}
        </button>
      )}
      {error !== null ? (
        <span role="alert" className="bad-text text-sm">
          {S.removeFailedLine(error.message)}
        </span>
      ) : null}
    </span>
  );
}
