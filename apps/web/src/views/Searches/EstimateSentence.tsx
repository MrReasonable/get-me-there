import type { EstimateResponse } from '../../api/types.js';
import { ESTIMATE_COPY } from '../../copy/estimate.js';
import { COPY } from '../../copy.js';
import { estimateMoney } from '../Definitions/EstimatePanel.js';
import { type EstimateSentence, estimateSentence, type SentenceSchedule } from './estimateLine.js';

/**
 * The estimate sentence for a press (spec rev 55 §11), money formatted through the estimate panel's one cost formatter:
 * the one call of `estimateSentence` the views make, so every sentence, note and label formats alike
 * (`sourceGuard.test.ts`). Null without an estimate.
 */
export function sentenceOf(
  e: EstimateResponse | null,
  schedule: SentenceSchedule | null,
  press: string,
): EstimateSentence | null {
  return e === null ? null : estimateSentence(e, schedule, ESTIMATE_COPY, estimateMoney, press);
}

/** The ids a press and its region share: the reason it waits and the sentence it confirms. */
export interface SentenceIds {
  reason: string;
  line: string;
}

/** The ids for a press, from a prefix unique on the page. */
export const sentenceIds = (prefix: string): SentenceIds => ({
  reason: `${prefix}-reason`,
  line: `${prefix}-line`,
});

/**
 * Spec rev 55 §11: the estimate sentence beside its button, in a polite live region named "Estimate", the notes under
 * it; or, while the press is not ready, why in words (the form is incomplete, or the estimate for the current form is
 * still being worked out). Never an older form's figures: the caller passes a sentence only for the current one.
 */
export function SentenceRegion({
  sentence,
  wait,
  ids,
}: {
  sentence: EstimateSentence | null;
  /** Why the press is not ready, or null when it is. */
  wait: string | null;
  ids: SentenceIds;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={COPY.newSearch.estimateRegion}
      data-cost=""
      className="estimate-line space-y-1 text-[15px]"
    >
      {wait !== null ? (
        <p id={ids.reason} className="text-fg-2">
          {wait}
        </p>
      ) : sentence !== null ? (
        <>
          <p id={ids.line} className="font-bold">
            {sentence.line}
          </p>
          {sentence.notes.length > 0 ? (
            <ul className="space-y-0.5 text-sm">
              {sentence.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The press beside the sentence: it carries the sentence's cost ("Search now · about £1.20") and is the confirmation of
 * exactly those figures. While `wait` is set it stays focusable but `aria-disabled`, described by the reason, and a
 * press sends nothing; while its request is pending it is disabled and says "Working…".
 */
export function SentenceButton({
  verb,
  sentence,
  wait,
  pending,
  ids,
  onPress,
  primary = true,
  onBlocked,
}: {
  verb: string;
  sentence: EstimateSentence | null;
  wait: string | null;
  pending: boolean;
  ids: SentenceIds;
  onPress: (covers: EstimateSentence['covers']) => void;
  /** Told when the press is tried while it waits (the form judges what it has not yet, fix round 1 finding 9). */
  onBlocked?: () => void;
  primary?: boolean;
}) {
  const ready = wait === null && sentence !== null;
  const label = sentence !== null && sentence.tag !== null ? ESTIMATE_COPY.withTag(verb, sentence.tag) : verb;
  return (
    <button
      type="button"
      data-cost=""
      className={`btn ${primary ? 'btn-primary' : ''} min-h-11`}
      disabled={pending}
      aria-busy={pending ? true : undefined}
      aria-disabled={ready || pending ? undefined : true}
      aria-describedby={pending ? undefined : ready ? ids.line : wait === null ? undefined : ids.reason}
      onClick={() => {
        if (ready && sentence !== null) onPress(sentence.covers);
        else if (!pending) onBlocked?.();
      }}
    >
      {pending ? COPY.working : label}
    </button>
  );
}
