import { useExecutionActions } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { RunNowButton } from '../../components/StatusBar.js';
import { COPY } from '../../copy.js';
import { CLEARED_FILTERS, datesPatch } from '../../state/datesState.js';
import { hrefWith, navigateTo, updateSearchParams } from '../../state/urlState.js';

// Spec §11 Dates "States", each in words, never colour alone. The view composes them; the board, the overview and
// the coverage line carry the rest of each state.

const D = COPY.datesView;

/** No definition at all: "No search yet" with a link to Definitions. */
export function NoSearch() {
  return (
    <p>
      {D.noSearch}{' '}
      <a
        href={hrefWith({ view: 'definitions' })}
        onClick={navigateTo({ view: 'definitions' })}
        className="underline"
      >
        {D.noSearchLink}
      </a>
    </p>
  );
}

/** Never run: "Not run yet: nothing has been searched", the estimate and Run now (the button states the estimate). */
export function NeverRun({ definition }: { definition: DefinitionResponse }) {
  const { start } = useExecutionActions();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-400 p-2">
      <p className="font-semibold">{D.neverRun}</p>
      <RunNowButton definition={definition} start={start} />
      {start.error ? <p role="alert">{COPY.actionFailed(start.error.message)}</p> : null}
    </div>
  );
}

/** Paused or budget-stopped: the reason and Resume as the status bar gives them, and what the board then shows. */
export function Paused({
  executionId,
  reason,
  notSearched,
  canResume,
}: {
  executionId: string;
  reason: string;
  notSearched: number;
  canResume: boolean;
}) {
  const { resume } = useExecutionActions();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-amber-700 bg-amber-50 p-2 text-sm">
      <span className="font-medium">{COPY.paused(reason)}</span>
      <span>{D.pausedNote}</span>
      <span>{D.notSearchedCount(notSearched)}</span>
      {canResume ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          disabled={resume.isPending}
          onClick={() => resume.mutate(executionId)}
        >
          {resume.isPending ? COPY.working : COPY.resume}
        </button>
      ) : null}
      {resume.error ? <p role="alert">{COPY.actionFailed(resume.error.message)}</p> : null}
    </div>
  );
}

/**
 * No date pair in the filtered scope has a figure: the board's line, never "no date pair exists" or "no flights";
 * the coverage line over the filtered scope (the header's, passed in) keeps its not searched and error counts in view.
 */
export function NoPriceInFilters({ coverageLine }: { coverageLine: string }) {
  return (
    <div className="space-y-1 rounded border border-slate-400 p-2">
      <p className="font-semibold">{D.noPriceInFilters}</p>
      <p className="text-sm">{coverageLine}</p>
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3"
        onClick={() => updateSearchParams(datesPatch(CLEARED_FILTERS))}
      >
        {COPY.clearFilters}
      </button>
    </div>
  );
}

/** The route's 422 `too_many_cells`: the scope's cell count, the bound, and the airport filter as the way under it. */
export function TooManyCells({ cells, bound }: { cells: number; bound: number }) {
  return (
    <p role="alert" className="rounded border border-red-700 p-2">
      {D.tooManyCells(cells, bound)}
    </p>
  );
}
