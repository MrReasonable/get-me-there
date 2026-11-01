import { IN_FLIGHT_STATUSES, isScheduled } from '@gmt/core';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.js';
import {
  useDefinitionEstimate,
  useDefinitions,
  useExecution,
  useExecutionActions,
} from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { definitionToDraft, draftToRequest } from '../Definitions/draft.js';
import { SentenceButton, SentenceRegion, sentenceOf } from '../Searches/EstimateSentence.js';

/**
 * Spec rev 55 §8.1, §11 Search again (WP20 Tasks 20.3 and 20.5): the one button that starts a run of a saved search, on
 * its card, on its page and in the never-searched state ("Search now" there).
 *
 * **The first press** is the confirmation, for that run only, of the figures the search stored (ruling A10: the
 * definition's confirmed values, set by Search now or by Repeat weekly's Save): it posts them (when both are stored),
 * `requireCovered` (the server refuses a start those figures do not cover, so a press never spends beyond what the
 * operator saw) and `replaceStopped` (a stopped latest run is superseded by the fresh start). A free search within its
 * stored confirmation therefore starts on the first press.
 *
 * **The second press**: when the server refuses `confirm` (nothing stored, or today's estimate above it), nothing has
 * started. The search's estimate is asked again and its sentence appears inline beside the button, now labelled with
 * the cost ("Search again · about £1.20", the "the rest …" clause following the schedule); the second press confirms
 * and starts that run with the shown figures, `requireCovered` and `replaceStopped`, and stores nothing (Ian's ruling
 * 3: a confirmation covers that run only). `confirmFirst` opens straight on the sentence (a refused Search now's page).
 *
 * The button is disabled while the start is pending, "Searching…" says it started (the cards and date pairs are then
 * re-read), and any other refusal is said in plain words beside it ("Already searching" for a 409 `active`).
 */
export function SearchAgainButton({
  definitionId,
  label = COPY.searchAgain.label,
  accessibleName,
  confirmFirst = false,
}: {
  definitionId: string;
  /** The visible words: "Search again" by default, "Search now" in the never-searched state. */
  label?: string;
  /** The name a screen reader hears when several cards each carry the button ("Search again: Birmingham → Frankfurt"). */
  accessibleName?: string;
  /** Start on the second look: the sentence and the labelled press, with nothing sent until it is pressed. */
  confirmFirst?: boolean;
}) {
  const definitions = useDefinitions();
  const { start } = useExecutionActions();
  const definition = definitions.data?.find((d) => d.id === definitionId);
  const [confirming, setConfirming] = useState(confirmFirst);
  // why: ruling R2 — the search is estimated as itself, its own fields as the body
  const estimate = useDefinitionEstimate(
    definitionId,
    definition === undefined ? null : draftToRequest(definitionToDraft(definition)),
    confirming,
  );
  const prefix = useId();
  const ids = { reason: `${prefix}-reason`, line: `${prefix}-line` };
  // why: "Searching…" says the press took effect only while its run is going: it clears once that run is read as no
  // longer pending or running (the run is polled here, so the cards and the Dates page both see it end)
  const started = useExecution(start.data?.executionId ?? null);
  // why: when that read keeps failing the button says so, with a retry, instead of a permanent "Searching…"
  const unread = start.isSuccess && started.isError ? started.error : null;
  const searching =
    start.isSuccess &&
    !started.isError &&
    (started.data === undefined || IN_FLIGHT_STATUSES.includes(started.data.status));
  const needsConfirm = start.error instanceof ApiError && start.error.code === 'confirm';
  const refusal = start.error === null || needsConfirm ? null : refusalText(start.error);

  /** Starts a run with these figures; a `confirm` refusal opens (or refreshes) the second look. */
  const press = (figures: { pence: number | null; calls: number | null }) => {
    if (definition === undefined) return;
    start.mutate(
      {
        id: definition.id,
        confirmCostPence: figures.pence,
        confirmCalls: figures.calls,
        requireCovered: true,
        replaceStopped: true,
      },
      {
        onSuccess: () => setConfirming(false),
        onError: (e) => {
          if (!(e instanceof ApiError && e.code === 'confirm')) return;
          // why: the figures shown were refused (the estimate rose meanwhile): the sentence is asked again
          if (confirming) void estimate.refetch();
          else setConfirming(true);
        },
      },
    );
  };

  const status = (
    <>
      {searching ? (
        <span role="status" className="text-sm">
          {COPY.searchAgain.working}
        </span>
      ) : null}
      {unread !== null ? (
        <span role="alert" className="bad-text text-sm">
          {COPY.searchAgain.startedUnread(unread.message)}{' '}
          <button type="button" className="btn btn-sm min-h-11" onClick={() => void started.refetch()}>
            {COPY.retryLoad}
          </button>
        </span>
      ) : null}
      {refusal !== null ? (
        <span role="alert" className="bad-text text-sm">
          {refusal}
        </span>
      ) : null}
    </>
  );

  if (confirming) {
    const schedule =
      definition !== undefined && isScheduled(definition)
        ? { cron: definition.scheduleCron, tz: definition.scheduleTz }
        : null;
    const sentence = sentenceOf(estimate.data ?? null, schedule, label);
    const wait =
      estimate.error !== null
        ? COPY.newSearch.estimateFailed(estimate.error.message)
        : sentence === null || estimate.isFetching || definition === undefined
          ? COPY.newSearch.working
          : null;
    return (
      <span className="search-again-confirm flex flex-col gap-2">
        <SentenceRegion sentence={sentence} wait={wait} ids={ids} />
        <span className="flex flex-wrap items-center gap-2">
          <SentenceButton
            verb={label}
            sentence={sentence}
            wait={wait}
            pending={start.isPending}
            ids={ids}
            onPress={(covers) => press({ pence: covers.pence, calls: covers.calls })}
          />
          {estimate.error !== null ? (
            <button type="button" className="btn btn-sm min-h-11" onClick={() => void estimate.refetch()}>
              {COPY.retryLoad}
            </button>
          ) : null}
          {status}
        </span>
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm min-h-11"
        disabled={definition === undefined || start.isPending}
        aria-busy={start.isPending ? true : undefined}
        // why: while pending the visible "Searching…" is the name, so the busy state is what a screen reader hears
        aria-label={start.isPending ? undefined : accessibleName}
        onClick={() =>
          press({ pence: definition?.confirmedCostPence ?? null, calls: definition?.confirmedCalls ?? null })
        }
      >
        {start.isPending ? COPY.searchAgain.working : label}
      </button>
      {status}
    </>
  );
}

/** A refused or failed start in words: the refusal codes the api sends, else the error's own message. */
function refusalText(e: Error): string {
  if (e instanceof ApiError) {
    const refused: Readonly<Record<string, string | undefined>> = COPY.searchAgain.refused;
    const words = refused[e.code];
    if (words !== undefined) return words;
  }
  return COPY.actionFailed(e.message);
}
