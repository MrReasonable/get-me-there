import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../example.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { updateSearchParams } from '../../state/urlState.js';
import { SentenceButton, SentenceRegion, sentenceIds, sentenceOf } from '../Searches/EstimateSentence.js';
import type { EstimateSentence } from '../Searches/estimateLine.js';
import { Reconfirmation } from './Confirmation.js';
import { CoverageCheck } from './CoverageCheck.js';
import { applyExample, type Draft, definitionToDraft } from './draft.js';
import { SearchFields } from './SearchFields.js';
import { useSearchForm } from './useSearchForm.js';

const IDS = sentenceIds('edit-search');
const E = COPY.editSearch;

/** True when a save changes what the search asks: its airports, dates, stay or cabin (spec rev 55 §11 Edit's Save). */
function spaceChanged(before: Pick<Draft, SpaceKey>, after: Pick<Draft, SpaceKey>): boolean {
  return SPACE_KEYS.some((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
type SpaceKey = 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'cabin';
const SPACE_KEYS: readonly SpaceKey[] = [
  'origins',
  'destinations',
  'window',
  'minNights',
  'maxNights',
  'cabin',
];

/** Opens the search's page, as a navigation (the page writes it as the search last opened too). */
function openPage(id: string): void {
  writeLastSearch(id);
  updateSearchParams({ view: 'dates', def: id, edit: null, refused: null }, 'push');
}

/**
 * Spec rev 55 §11 Edit (`?view=definitions&edit=<id>`; WP20 Task 20.5): the search's fields as the new-search form
 * shows them, with More options, the note and onward cost per destination, the schedule fields, the coverage check and
 * "import example"; the same estimate sentence, asked for automatically. It ends with two presses, both acting on the
 * search being edited and never on another:
 *
 * - **Save and search again**, carrying the cost as Search now does ("Save and search again · about £1.20"): it saves
 *   (a `PUT` storing no confirmation: a confirmation covers that run only, Ian's ruling 3), then starts **that** search
 *   with the sentence's figures, `requireCovered` and `replaceStopped`, and opens its page. A refused start is said
 *   beside the press, as Search again says it, and opens nothing (ruling R1).
 * - **Save**: it saves; when the change altered the search's space (airports, dates, stay, cabin) it opens the page,
 *   which then reads that the dates changed and offers Search again; otherwise it says "Saved." here.
 *
 * A save that raises the estimate past a scheduled search's stored confirmation asks again (`needsConfirmation`), as
 * WP8's PUT path keeps doing for scheduled runs.
 */
export function DefinitionForm({
  existing,
  providers,
  debounceMs,
}: {
  existing: DefinitionResponse;
  providers: ProvidersResponse;
  /** The estimate's debounce; tests that are not about it inject 0. */
  debounceMs?: number;
}) {
  const qc = useQueryClient();
  const [initial] = useState(() => definitionToDraft(existing));
  const form = useSearchForm(initial, { nameTouched: true, debounceMs, definitionId: existing.id });
  const { draft } = form;
  const [saved, setSaved] = useState<DefinitionResponse>(existing);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const scheduled = draft.enabled && draft.scheduleCron !== null;
  const sentence = sentenceOf(
    form.estimate.estimate,
    scheduled ? { cron: draft.scheduleCron, tz: draft.scheduleTz } : null,
    E.saveAndSearch,
  );
  const travelpayouts = providers.providers.some((p) => p.providerId === 'travelpayouts' && p.enabled);

  // why: the first screen's cards read the same searches, so a save refreshes them too
  const refresh = () =>
    Promise.all(
      [['definitions'], ['cards'], ['execution'], ['date-pairs']].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
  const failed = (e: Error) => {
    if (e instanceof ApiError && e.status === 422) form.setSaveErrors(e.fieldErrors());
    else setFailure(COPY.actionFailed(e.message));
  };
  const accept = (d: DefinitionResponse) => {
    setSaved(d);
    form.setSaveErrors([]);
    setFailure(null);
    void refresh();
  };

  const save = useMutation({
    mutationFn: (body: Draft) => api.updateDefinition(saved.id, body),
    onSuccess: (d) => {
      accept(d);
      // why: a changed space is read on the search's page ("Dates changed … · Search again"); a confirmation asked
      // for keeps the operator here, beside it
      if (spaceChanged(definitionToDraft(saved), definitionToDraft(d)) && d.needsConfirmation === null)
        openPage(d.id);
      else setNotice(E.saved);
    },
    onError: failed,
  });
  // why: fix round 1, finding 5 — a second press in the same tick lands before the re-render that disables the button
  const sending = useRef(false);
  const saveAndSearch = useMutation({
    mutationFn: async (v: { body: Draft; covers: EstimateSentence['covers'] }) => {
      const d = await api.updateDefinition(saved.id, v.body);
      accept(d);
      try {
        await api.startExecution(d.id, {
          confirmCostPence: v.covers.pence,
          confirmCalls: v.covers.calls,
          requireCovered: true,
          replaceStopped: true,
        });
        return d.id;
      } catch (e) {
        throw new StartRefused(e instanceof Error ? e : new Error(String(e)));
      }
    },
    onSettled: () => {
      sending.current = false;
    },
    onSuccess: (id) => openPage(id),
    onError: (e: Error) => {
      if (!(e instanceof StartRefused)) return failed(e);
      // why: ruling R1 — a refused start is worded where it happened, beside this press, and opens nothing; a
      // `confirm` means the estimate rose since it was shown, so it is asked again and the press shows the new figures
      if (e.cause instanceof ApiError && e.cause.code === 'confirm') {
        form.estimate.refetch();
        setFailure(E.estimateChanged);
      } else setFailure(startRefusalText(e.cause));
    },
  });
  const confirm = useMutation({
    mutationFn: (v: { pence: number; calls: number }) =>
      api.updateDefinition(saved.id, { confirmedCostPence: v.pence, confirmedCalls: v.calls }),
    onSuccess: (d) => {
      accept(d);
      setNotice(E.saved);
    },
    onError: failed,
  });

  const pending = save.isPending || saveAndSearch.isPending;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="plate plate-pad def-form text-[15px]">
      <div className="def-main">
        {saved.notices.length > 0 ? (
          <ul aria-label={COPY.definitionNotices} className="def-notices">
            {saved.notices.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-text min-h-11 text-fg-2"
            onClick={() => {
              form.setDraft(applyExample(draft, EXAMPLE_DEFINITION));
              form.setNameTouched(true);
            }}
          >
            {COPY.importExample(EXAMPLE_LABEL)}
          </button>
        </div>
        <SearchFields
          form={form}
          providers={providers}
          edit
          budgetFit={form.estimate.estimate?.budgetFit ?? null}
          extra={<CoverageCheck draft={draft} available={travelpayouts} />}
        />
      </div>
      <div className="def-side space-y-3">
        <SentenceRegion sentence={sentence} wait={form.wait} ids={IDS} />
        <SentenceButton
          verb={E.saveAndSearch}
          sentence={sentence}
          wait={form.wait}
          pending={saveAndSearch.isPending}
          ids={IDS}
          onBlocked={form.judgeDates}
          onPress={(covers) => {
            if (form.body === null || pending || sending.current) return;
            sending.current = true;
            setNotice(null);
            saveAndSearch.mutate({ body: form.body, covers });
          }}
        />
        <button
          type="button"
          className="btn min-h-11"
          disabled={save.isPending}
          aria-busy={save.isPending ? true : undefined}
          aria-disabled={form.reason === null ? undefined : true}
          aria-describedby={form.reason === null ? undefined : IDS.reason}
          onClick={() => {
            if (form.body === null) form.judgeDates();
            if (form.body === null || pending) return;
            setNotice(null);
            save.mutate(form.body);
          }}
        >
          {save.isPending ? COPY.working : E.save}
        </button>
        {failure !== null ? (
          <p role="alert" className="bad-text">
            {failure}
          </p>
        ) : null}
        <Reconfirmation definition={saved} pending={confirm.isPending} onConfirm={(v) => confirm.mutate(v)} />
        {notice !== null ? (
          <p role="status" className="font-semibold">
            {notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** A save that worked followed by a start that was refused or failed: the start's own error is its cause. */
class StartRefused extends Error {
  override readonly cause: Error;
  constructor(cause: Error) {
    super(cause.message);
    this.cause = cause;
  }
}

/** A refused start in plain words, as Search again says it (spec rev 55 §11), else that it did not start and why. */
function startRefusalText(e: Error): string {
  const refused: Readonly<Record<string, string | undefined>> = COPY.searchAgain.refused;
  const words = e instanceof ApiError ? refused[e.code] : undefined;
  return words ?? E.startFailed(e.message);
}
