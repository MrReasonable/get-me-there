import { londonDateOf, type StartRefusalCode } from '@gmt/core';
import { useRefusal } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { REFUSED_COPY } from '../../copy/refused.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { SearchAgainButton } from './SearchAgainButton.js';
import type { StateLine } from './stateLines.js';

// Spec §11 Dates "States", each in words, never colour alone. The page composes them; `RunProgress`, the sections and
// the calendar carry the rest of each state.

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
 * Spec rev 55 §11 "State line", *never*: "Not searched yet" with the estimate sentence and Search now (the one start
 * button, which confirms the figures beside it for that run only); a search naming no source instead says "No price
 * source is set up, so nothing was searched" with the way to set one up (Review Focus 1), from its own data, and offers
 * no press that could only be refused.
 */
export function NeverRun({
  definition,
  line,
}: {
  definition: DefinitionResponse;
  line: Extract<StateLine, { kind: 'never' }>;
}) {
  const fix = line.fix ?? null;
  return (
    <div className="plate notice flex flex-wrap items-center gap-3">
      <p className="font-bold">{line.text}</p>
      {fix !== null ? (
        <a
          href={hrefWith({ view: 'providers', def: null, refused: null })}
          onClick={navigateTo({ view: 'providers', def: null, refused: null })}
          className="font-bold underline"
        >
          {fix}
        </a>
      ) : (
        <SearchAgainButton definitionId={definition.id} label={COPY.searchAgain.searchNow} confirmFirst />
      )}
    </div>
  );
}

/**
 * The route's 422 `too_many_cells`: how many combinations of dates and airports the scope holds, the bound, and From or
 * To as the way under it, in main-path words (spec rev 55 §3: no "cells").
 */
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
 * limit resets when the press's answer named one (a reload has only the code); `window` with Edit; `shutting-down`,
 * `reload-pending` (a saved setting waits for the app to restart) and `failed` with Search again.
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
      {code === 'failed' || code === 'shutting-down' || code === 'reload-pending' ? (
        <SearchAgainButton definitionId={definitionId} />
      ) : null}
    </div>
  );
}
