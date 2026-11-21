import { failureOf } from '../api/statusQuery.js';
import { COPY } from '../copy.js';

/** The words of a failed status read with no report to show: silence, a refused sign-in or an error answer (V11). */
export function failureWords(error: Error): string {
  return {
    'not-answering': COPY.statusView.notAnswering,
    'sign-in-refused': COPY.statusView.signInRefused,
    'report-failed': COPY.statusView.reportFailed,
  }[failureOf(error)];
}

/**
 * The age line shared by the Status view and Settings › System: "checked 40 s ago" as plain text, and after a failed
 * refresh the kept report marked "stale, checked …", also plain text. The polite live region holds one fixed sentence
 * while the report is stale and is empty otherwise, so only the change of state is announced, never the ticking age
 * (V11 ui-b1-001; CodeRabbit, PR #64).
 */
export function CheckedLine({ checked, refetchError }: { checked: string | null; refetchError: boolean }) {
  const stale = refetchError && checked !== null;
  return (
    <>
      <p className="lede">{refetchError ? null : checked}</p>
      <p className="warn-text">{stale ? COPY.statusView.stale(checked) : null}</p>
      <p role="status" className="sr-only">
        {stale ? COPY.statusView.staleAnnounced : null}
      </p>
    </>
  );
}
