import { useExecutionActions } from '../../api/queries.js';
import { fixNamesResume, StopSentence, type StopWords } from '../../components/StopWords.js';
import { COPY } from '../../copy.js';

const P = COPY.searchPage;

/**
 * Spec rev 55 §11 "State line", *stopped* (WP20 Task 20.6): the stop's sentence as-is with its fix as a line (a `pnpm
 * gmt …` command in a code element, native mode only), Resume beside it when the fix names Resume (core's structured
 * `fix.resume`, never matched on words; a run's status must also allow it), "0 of 405 searched" when no date pair was
 * searched (never "0 error"), and what the board then shows. Search again, which every other fix offers, is the
 * header's own action beside this line, so the page has one Search again.
 */
export function StoppedLine({
  executionId,
  stop,
  noneSearched,
  resumable,
  buckets,
}: {
  executionId: string;
  stop: StopWords;
  noneSearched: string | null;
  /** The six buckets under the count (spec rev 55 §3). */
  buckets: string;
  /** The run's status is one the api resumes (paused or interrupted). */
  resumable: boolean;
}) {
  const { resume } = useExecutionActions();
  return (
    <div className="plate notice flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
      <span aria-hidden="true" className="tag tag-warn">
        ▲
      </span>
      <StopSentence stop={stop} className="font-bold" />
      {noneSearched !== null ? <span>{noneSearched}</span> : <span>{P.stoppedBoard}</span>}
      <span className="basis-full text-sm text-fg-2">{buckets}</span>
      {resumable && fixNamesResume(stop) ? (
        <button
          type="button"
          className="btn btn-primary min-h-11"
          disabled={resume.isPending}
          onClick={() => resume.mutate(executionId)}
        >
          {resume.isPending ? COPY.working : P.resume}
        </button>
      ) : null}
      {resume.error ? (
        <p role="alert" className="bad-text">
          {COPY.actionFailed(resume.error.message)}
        </p>
      ) : null}
    </div>
  );
}
