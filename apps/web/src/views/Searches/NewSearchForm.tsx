import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { CreateAndStartBody, CreateAndStartResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { newRequestKey } from '../../lib/requestKey.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { updateSearchParams } from '../../state/urlState.js';
import { type Draft, defaultDraft, EMPTY_ABSOLUTE } from '../Definitions/draft.js';
import { SearchFields } from '../Definitions/SearchFields.js';
import { useSearchForm } from '../Definitions/useSearchForm.js';
import { SentenceButton, SentenceRegion, sentenceIds, sentenceOf } from './EstimateSentence.js';

const IDS = sentenceIds('new-search');

/**
 * A new search's draft (spec rev 55 §8.2 presets, design §4.1–§4.2): the plan preset's sources, policy and budget, no
 * schedule, no arrival window, and fixed dates the operator enters in Leave between (rolling dates are a switch under
 * More options, filled in with the 7-day start and 182-day length).
 */
export function newSearchDraft(presets: ProvidersResponse['presets']): Draft {
  return { ...defaultDraft(presets), window: EMPTY_ABSOLUTE, scheduleCron: null, enabled: false };
}

/**
 * Spec rev 55 §11 "The new-search form and Search now" (WP20 Task 20.5; design §4): From, To, Leave between and Stay,
 * everything else filled in under More options; the estimate is asked for `ESTIMATE_DEBOUNCE_MS` after the last change
 * (no Show estimate step) and shown beside the button as one sentence. **The press is the confirmation** of exactly the
 * figures beside it, for that run only: `POST /definitions/create-and-start` with the form, the sentence's shown
 * runnable totals, a fresh request key and no schedule. The new search's page then opens (`?view=dates&def=<id>`); a
 * refused start keeps the saved search and opens its page with `refused=<code>`, where the refusal is worded (the
 * refusal itself is left in the query cache for the page's "it resets on <date>"). A 422 keeps the form with its
 * field errors; any other failure says "Couldn't save the search" beside the button.
 */
export function NewSearchForm({
  providers,
  debounceMs,
}: {
  providers: ProvidersResponse;
  /** The estimate's debounce; tests that are not about it inject 0 (the debounce test steps the real value). */
  debounceMs?: number;
}) {
  const qc = useQueryClient();
  const [initial] = useState(() => newSearchDraft(providers.presets));
  const form = useSearchForm(initial, { nameTouched: false, debounceMs });
  const est = form.estimate;
  const sentence = sentenceOf(est.estimate, null, COPY.searchAgain.searchNow);

  const [failure, setFailure] = useState<string | null>(null);
  // why: fix round 1, finding 5 — a second press in the same tick lands before the re-render that disables the button,
  // so the request in flight is held here, synchronously, and released when it settles
  const sending = useRef(false);
  const create = useMutation({
    mutationFn: (b: CreateAndStartBody) => api.createAndStart(b),
    onSuccess: (r: CreateAndStartResponse) => {
      const id = r.definition.id;
      form.setSaveErrors([]);
      if (r.refusal !== null) qc.setQueryData(qk.refusal(id), r.refusal);
      void Promise.all(
        [['cards'], ['definitions'], ['execution']].map((queryKey) => qc.invalidateQueries({ queryKey })),
      );
      writeLastSearch(id);
      updateSearchParams(
        { view: 'dates', def: id, refused: r.refusal === null ? null : r.refusal.code, edit: null },
        'push',
      );
    },
    onSettled: () => {
      sending.current = false;
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.status === 422) {
        form.setSaveErrors(e.fieldErrors());
        setFailure(null);
      } else setFailure(COPY.newSearch.saveFailed(e.message));
    },
  });

  const wait = form.wait;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="plate plate-pad def-form text-[15px]">
      <div className="def-main">
        <SearchFields
          form={form}
          providers={providers}
          edit={false}
          budgetFit={est.estimate?.budgetFit ?? null}
        />
      </div>
      <div className="def-side space-y-3">
        <SentenceRegion sentence={sentence} wait={wait} ids={IDS} />
        <SentenceButton
          verb={COPY.searchAgain.searchNow}
          sentence={sentence}
          wait={wait}
          pending={create.isPending}
          ids={IDS}
          onPress={(covers) => {
            if (form.body === null || sending.current) return;
            sending.current = true;
            setFailure(null);
            create.mutate({
              ...form.body,
              scheduleCron: null,
              enabled: false,
              confirmCostPence: covers.pence,
              confirmCalls: covers.calls,
              // why: a fresh key a press, so a retry of this very request (a double send) creates nothing more
              requestKey: newRequestKey(),
            });
          }}
        />
        {failure !== null ? (
          <p role="alert" className="bad-text">
            {failure}
          </p>
        ) : null}
      </div>
    </form>
  );
}
