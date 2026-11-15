import { COPY } from '../../copy.js';
import { type ConfirmLineInput, confirmLineText } from './confirmWords.js';

/**
 * Design 2026-11-08 §5.5, Ruling 22: "Cheapest trips"' lead, then how reading flights ended (the stopping sentence),
 * not a live region: its counts move while the step runs, as the page's other lines do. Only the lead for a run with no
 * summary (or before the run's own read is in).
 */
export function ConfirmLine({ lead, input }: { lead: string; input: ConfirmLineInput | null }) {
  const text = input === null ? null : confirmLineText(input, COPY);
  return (
    <p className="search-section-sub">
      {lead}
      {text === null ? null : (
        <>
          {' '}
          <span data-testid="confirm-line">{text}</span>
        </>
      )}
    </p>
  );
}
