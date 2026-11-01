import { londonDateOf, type StartRefusalCode } from '@gmt/core';
import { useExecutionActions, useRefusal } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { StopSentence, type StopWords } from '../../components/StopWords.js';
import { REFUSED_COPY } from '../../copy/refused.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { CLEARED_FILTERS, datesPatch } from '../../state/datesState.js';
import { hrefWith, navigateTo, updateSearchParams } from '../../state/urlState.js';
import { SearchAgainButton } from './SearchAgainButton.js';

// Spec §11 Dates "States", each in words, never colour alone. The view composes them; the board, the overview and
// the coverage line carry the rest of each state.

const D = COPY.datesView;

/** No definition at all: "No search yet" with a link to Searches. */
export function NoSearch() {
  return (
    <p className="plate notice text-[17px]">
      {D.noSearch}{' '}
      <a
        href={hrefWith({ view: 'searches' })}
        onClick={navigateTo({ view: 'searches' })}
        className="font-bold underline"
      >
        {D.noSearchLink}
      </a>
    </p>
  );
}

/**
 * Never run: "Not run yet: nothing has been searched" and Search now, the one start button (spec rev 55 §11; WP20 Task
 * 20.3). Its refusals are said beside it by the button itself.
 */
export function NeverRun({ definition }: { definition: DefinitionResponse }) {
  return (
    <div className="plate notice flex flex-wrap items-center gap-3">
      <p className="font-bold">{D.neverRun}</p>
      <SearchAgainButton definitionId={definition.id} label={COPY.searchAgain.searchNow} />
    </div>
  );
}

/**
 * A stopped run: the stop's sentence as-is with its fix, and Resume when the fix names it, as the status bar gives
 * them, and what the board then shows.
 */
export function Paused({
  executionId,
  stop,
  notSearched,
  canResume,
}: {
  executionId: string;
  stop: StopWords;
  notSearched: number;
  canResume: boolean;
}) {
  const { resume } = useExecutionActions();
  return (
    <div className="plate notice flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
      <span aria-hidden="true" className="tag tag-warn">
        ▲
      </span>
      <StopSentence stop={stop} className="font-bold" />
      <span>{D.pausedNote}</span>
      <span>{D.notSearchedCount(notSearched)}</span>
      {canResume ? (
        <button
          type="button"
          className="btn btn-primary min-h-11"
          disabled={resume.isPending}
          onClick={() => resume.mutate(executionId)}
        >
          {resume.isPending ? COPY.working : COPY.resume}
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

/**
 * No date pair in the filtered scope has a figure: the board's line, never "no date pair exists" or "no flights";
 * the coverage line over the filtered scope (the header's, passed in) keeps its not searched and error counts in view.
 */
export function NoPriceInFilters({ coverageLine }: { coverageLine: string }) {
  return (
    <div className="plate notice space-y-2">
      <p className="font-bold">{D.noPriceInFilters}</p>
      <p className="text-sm text-fg-2">{coverageLine}</p>
      <button
        type="button"
        className="btn min-h-11"
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
    <p role="alert" className="plate notice font-semibold text-bad">
      {D.tooManyCells(cells, bound)}
    </p>
  );
}

/**
 * A refused Search now on the new search's page (`refused=<code>`; spec rev 55 §11, Review Focus 1, ruling A24), in
 * words from the code alone, never the engine's: `disabled` with the fix "Set up a price source (Providers)"; `confirm`
 * with the estimate asked again and its sentence inline beside "Search again · about £X"; `cap` with the day the month's
 * limit resets when the press's answer named one (a reload has only the code); `window` with Edit; `shutting-down`;
 * `failed` with Search again.
 */
export function Refused({ definitionId, code }: { definitionId: string; code: StartRefusalCode }) {
  const R = REFUSED_COPY;
  const answered = useRefusal(definitionId).data;
  const edit = { view: 'definitions', edit: definitionId, def: null, refused: null };
  if (code === 'confirm')
    return (
      <div className="plate notice space-y-2">
        <p className="font-bold">{R.confirm}</p>
        <SearchAgainButton definitionId={definitionId} confirmFirst />
      </div>
    );
  const resetsAt = code === 'cap' ? (answered?.resetsAt ?? null) : null;
  return (
    <div role="alert" className="plate notice flex flex-wrap items-center gap-3 text-[15px]">
      <p className="font-bold">
        {code === 'cap'
          ? resetsAt === null
            ? R.cap
            : R.capResets(formatIsoDate(londonDateOf(resetsAt)))
          : R[code]}
      </p>
      {code === 'disabled' ? (
        <a
          href={hrefWith({ view: 'providers', def: null, refused: null })}
          onClick={navigateTo({ view: 'providers', def: null, refused: null })}
          className="font-bold underline"
        >
          {R.disabledFix}
        </a>
      ) : null}
      {(code === 'cap' && resetsAt === null) || code === 'window' ? (
        <a href={hrefWith(edit)} onClick={navigateTo(edit)} className="font-bold underline">
          {R.edit}
        </a>
      ) : null}
      {code === 'failed' || code === 'shutting-down' ? (
        <SearchAgainButton definitionId={definitionId} />
      ) : null}
    </div>
  );
}
