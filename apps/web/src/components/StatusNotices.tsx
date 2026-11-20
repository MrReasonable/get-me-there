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
 * refresh the kept report marked "stale, checked …" in a polite live region (V11 ui-b1-001: only a change of state is
 * announced, never the ticking age).
 */
export function CheckedLine({ checked, refetchError }: { checked: string | null; refetchError: boolean }) {
  return (
    <>
      <p className="lede">{refetchError ? null : checked}</p>
      <p role="status" className="warn-text">
        {refetchError && checked !== null ? COPY.statusView.stale(checked) : null}
      </p>
    </>
  );
}
