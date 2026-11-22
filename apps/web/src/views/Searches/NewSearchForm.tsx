import { monthlyCapsMissed } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Ref, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type {
  BudgetFit,
  CreateAndStartBody,
  CreateAndStartResponse,
  ProvidersResponse,
} from '../../api/types.js';
import { COPY } from '../../copy.js';
import { newRequestKey } from '../../lib/requestKey.js';
import { useSearchApiCredits } from '../../lib/searchApiCreditsLine.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { updateSearchParams } from '../../state/urlState.js';
import { type Draft, defaultDraft } from '../Definitions/draft.js';
import { BudgetFitPanel } from '../Definitions/EstimatePanel.js';
import { SearchFields } from '../Definitions/SearchFields.js';
import { useSearchForm } from '../Definitions/useSearchForm.js';
import { SentenceButton, SentenceRegion, sentenceIds, sentenceOf } from './EstimateSentence.js';

const IDS = sentenceIds('new-search');
const N = COPY.newSearch;

/**
 * A new search's draft (spec rev 55 §8.2 presets, design 2026-11-08 Ruling 13): the api's presets (`/providers`), whose
 * sources are the ones its single rule gives (`newSearchSourcesFor`: the Settings page's lists, or today's draft:
 * every configured free source, SearchApi unticked, the test source only when nothing real is left), so this page
 * decides none of that; no schedule (Repeat: Never), no arrival window, and When to leave on Next 6 months (the core
 * default), which the operator changes to another span or to Set date range.
 */
export function newSearchDraft(presets: ProvidersResponse['presets']): Draft {
  return {
    ...defaultDraft(presets),
    scheduleCron: null,
    enabled: false,
  };
}

/**
 * The new-search panel's form (spec rev 55 §11 "The new-search form and Search now"; design 2026-11-08 Rulings 13–14):
 * From, To, Leave from and Leave by, Stay and Where to look, the rest under More options; the estimate is asked for
 * `ESTIMATE_DEBOUNCE_MS` after the last change and shown as one sentence above the press. **The press is the
 * confirmation** of exactly the figures beside it: `POST /definitions/create-and-start` with the form (its schedule
 * when Repeat says Weekly, in the install's time zone), the sentence's shown runnable totals and a fresh request key. A
 * search set to repeat that would go over a monthly limit is refused with Repeat weekly's words and the monthly figure,
 * and nothing is sent, by core's `monthlyCapsMissed`, the rule the api refuses it by too (`schedule_over_budget`). The
 * new search's page then opens (`?view=dates&def=<id>`); a refused start keeps the saved search and opens its page with
 * `refused=<code>`, where the refusal is worded (the refusal itself is left in the query cache for the page's "it resets
 * on <date>"). A 422 keeps the form with its field errors; any other failure says "Couldn't save the search" beside the
 * button.
 */
export function NewSearchForm({
  providers,
  debounceMs,
  fromRef,
}: {
  providers: ProvidersResponse;
  /** From's text box, for "+ New search" to move focus to (Ruling 13). */
  fromRef?: Ref<HTMLInputElement>;
  /** The estimate's debounce; tests that are not about it inject 0 (the debounce test steps the real value). */
  debounceMs?: number;
}) {
  const qc = useQueryClient();
  const [initial] = useState(() => newSearchDraft(providers.presets));
  const form = useSearchForm(initial, { nameTouched: false, debounceMs });
  // why: Ruling 13 — the panel's "M left" is the top bar's figure, from the one helper
  const credits = useSearchApiCredits(providers);
  const est = form.estimate;
  const { draft } = form;
  const repeats = draft.enabled && draft.scheduleCron !== null;
  const sentence = sentenceOf(
    est.estimate,
    repeats ? { cron: draft.scheduleCron, tz: draft.scheduleTz } : null,
    N.search,
  );

  // why: fix round 2 — a refusal (and the monthly figure an over-limit one shows) belongs to the form it was said of:
  // it is kept with that form's body and shown only while the form is unchanged; one the api answers later keys to the
  // body as it was pressed (Task 7 minor), never the form as it stands when the answer lands
  const bodyKey = JSON.stringify(form.body);
  const [said, setSaid] = useState<{ key: string; words: string; fit: BudgetFit | null } | null>(null);
  const failure = said !== null && said.key === bodyKey ? said : null;
  const setFailure = (words: string | null, fit: BudgetFit | null = null, key: string = bodyKey) =>
    setSaid(words === null ? null : { key, words, fit });
  // why: fix round 1, finding 5 — a second press in the same tick lands before the re-render that disables the button,
  // so the request in flight is held here, synchronously, and released when it settles
  const sending = useRef(false);
  const create = useMutation({
    mutationFn: ({ body }: { body: CreateAndStartBody; key: string }) => api.createAndStart(body),
    onSuccess: (r: CreateAndStartResponse) => {
      const id = r.definition.id;
      form.setSaveErrors([]);
      if (r.refusal !== null) qc.setQueryData(qk.refusal(id), r.refusal);
      // why: the shell judges def= against this list, so the new search is in it before its page opens; otherwise the
      // page says "The search in this link no longer exists" until the reload below lands (Ian, 2026-11-22)
      qc.setQueryData(qk.definitions, (old: CreateAndStartResponse['definition'][] | undefined) =>
        old === undefined || old.some((d) => d.id === id) ? old : [...old, r.definition],
      );
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
    onError: (e: Error, { key }) => {
      // why: Ruling 14 — the api's monthly-fit refusal in Repeat weekly's words, never the server's
      if (e instanceof ApiError && e.code === 'schedule_over_budget')
        setFailure(COPY.repeatWeekly.overBudget, null, key);
      else if (e instanceof ApiError && e.status === 422) {
        form.setSaveErrors(e.fieldErrors());
        setFailure(null);
      } else setFailure(N.saveFailed(e.message), null, key);
    },
  });

  const wait = form.wait;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="new-search-form">
      <SearchFields
        form={form}
        providers={providers}
        credits={credits}
        edit={false}
        budgetFit={null}
        {...(fromRef === undefined ? {} : { fromRef })}
      />
      <SentenceRegion sentence={sentence} wait={wait} ids={IDS} quiet />
      <SentenceButton
        verb={N.search}
        sentence={sentence}
        wait={wait}
        pending={create.isPending}
        ids={IDS}
        onPress={(covers) => {
          if (form.body === null || sending.current) return;
          // why: Ruling 14 — core's one rule, the api's refusal too: a repeating search over a monthly cap is not sent
          const fit = est.estimate?.budgetFit;
          const ids = providers.providers.map((p) => p.providerId);
          if (repeats && fit !== undefined && monthlyCapsMissed(fit.perScope, ids).length > 0) {
            setFailure(COPY.repeatWeekly.overBudget, fit);
            return;
          }
          sending.current = true;
          setFailure(null);
          create.mutate({
            body: {
              ...form.body,
              confirmCostPence: covers.pence,
              confirmCalls: covers.calls,
              // why: a fresh key a press, so a retry of this very request (a double send) creates nothing more
              requestKey: newRequestKey(),
            },
            key: bodyKey,
          });
        }}
      />
      {failure !== null ? (
        <div role="alert" className="new-search-refused">
          <p className="bad-text">{failure.words}</p>
          {failure.fit !== null ? <BudgetFitPanel fit={failure.fit} /> : null}
        </div>
      ) : null}
    </form>
  );
}
