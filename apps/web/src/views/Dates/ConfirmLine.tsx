import { COPY } from '../../copy.js';
import { type ConfirmLineInput, confirmLineText } from './confirmWords.js';

/**
 * Design 2026-11-08 §5.5: how checking flights ended, in one line under the board (not a live region: its counts move
 * while the step runs, as the page's other state lines do). Nothing for a run with no summary.
 */
export function ConfirmLine(props: ConfirmLineInput) {
  const text = confirmLineText(props, COPY);
  if (text === null) return null;
  return (
    <p data-testid="confirm-line" className="confirm-line text-sm text-fg-2">
      {text}
    </p>
  );
}
