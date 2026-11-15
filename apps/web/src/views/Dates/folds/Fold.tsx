import { type ReactNode, useEffect, useRef } from 'react';

/**
 * One row of the folds' group (Ruling 19): a native `details`, closed until asked, its summary the name and then the
 * one-line state in muted text. `requested` is a link asking for it open (the run line's, a status card's, a
 * `?view=coverage` landing): the row opens, scrolls into view and takes focus on its summary, then calls `onHandled`
 * once, so the same link asks again next time. The row's own toggling is the browser's, never set from here.
 */
export function Fold({
  id,
  title,
  state,
  requested,
  onHandled,
  children,
}: {
  id: string;
  title: string;
  /** The one-line state after the name; null leaves the name alone. */
  state: ReactNode;
  requested: boolean;
  onHandled: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const row = ref.current;
    if (!requested || row === null) return;
    row.open = true;
    row.scrollIntoView();
    row.querySelector('summary')?.focus();
    onHandled();
  }, [requested, onHandled]);
  return (
    <details ref={ref} id={id} className="sfold">
      <summary>
        <span className="sfold-name">{title}</span>
        {state === null ? null : <span className="sfold-state"> · {state}</span>}
      </summary>
      <div className="sfold-body">{children}</div>
    </details>
  );
}
