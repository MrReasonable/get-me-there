import { ApiError } from '../../api/client.js';
import { useDefinitions, useExecutionActions } from '../../api/queries.js';
import { COPY } from '../../copy.js';

/**
 * Spec rev 55 §8.1, §11 (WP20 Task 20.3, the first press): the one button that starts a run of a saved search, on its
 * card, on its page and in the never-searched state ("Search now" there). A press is the confirmation, for that run only,
 * of the figures the search stored: it posts the stored pence and calls (when both are stored), `requireCovered` (the
 * server refuses a start those figures do not cover, so a press never spends beyond what the operator saw) and
 * `replaceStopped` (a stopped latest run is superseded by the fresh start). A free search within its stored confirmation
 * therefore starts on the first press.
 *
 * The button is disabled while the start is pending, "Searching…" says it started (the cards and date pairs are then
 * re-read), and a refusal is said in plain words beside it ("Already searching" for a 409 `active`). The second press,
 * for a search with nothing stored, is Task 20.5's.
 */
export function SearchAgainButton({
  definitionId,
  label = COPY.searchAgain.label,
  accessibleName,
}: {
  definitionId: string;
  /** The visible words: "Search again" by default, "Search now" in the never-searched state. */
  label?: string;
  /** The name a screen reader hears when several cards each carry the button ("Search again: Birmingham → Frankfurt"). */
  accessibleName?: string;
}) {
  const definitions = useDefinitions();
  const { start } = useExecutionActions();
  const definition = definitions.data?.find((d) => d.id === definitionId);
  const refusal = start.error === null ? null : refusalText(start.error);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-sm min-h-11"
        disabled={definition === undefined || start.isPending}
        aria-busy={start.isPending ? true : undefined}
        // why: while pending the visible "Searching…" is the name, so the busy state is what a screen reader hears
        aria-label={start.isPending ? undefined : accessibleName}
        onClick={() => {
          if (definition === undefined) return;
          start.mutate({
            id: definition.id,
            confirmCostPence: definition.confirmedCostPence,
            confirmCalls: definition.confirmedCalls,
            requireCovered: true,
            replaceStopped: true,
          });
        }}
      >
        {start.isPending ? COPY.searchAgain.working : label}
      </button>
      {start.isSuccess ? (
        <span role="status" className="text-sm">
          {COPY.searchAgain.working}
        </span>
      ) : null}
      {refusal !== null ? (
        <span role="alert" className="bad-text text-sm">
          {refusal}
        </span>
      ) : null}
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
