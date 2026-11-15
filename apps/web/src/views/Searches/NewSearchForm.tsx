import { monthlyCapsMissed } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { qk, useBudget } from '../../api/queries.js';
import type {
  BudgetFit,
  CreateAndStartBody,
  CreateAndStartResponse,
  ProvidersResponse,
} from '../../api/types.js';
import { COPY } from '../../copy.js';
import { newRequestKey } from '../../lib/requestKey.js';
import { searchApiCallsLeft } from '../../lib/searchApiCallsLeft.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { updateSearchParams } from '../../state/urlState.js';
import { type Draft, defaultDraft, EMPTY_ABSOLUTE } from '../Definitions/draft.js';
import { BudgetFitPanel } from '../Definitions/EstimatePanel.js';
import { SearchFields } from '../Definitions/SearchFields.js';
import { useSearchForm } from '../Definitions/useSearchForm.js';
import { SentenceButton, SentenceRegion, sentenceIds, sentenceOf } from './EstimateSentence.js';

const IDS = sentenceIds('new-search');
const N = COPY.newSearch;

/**
 * A new search's draft (spec rev 55 §8.2 presets, design 2026-11-08 Ruling 13): the plan preset's sources, policy and
 * budget without SearchApi (design §8 question 2: it is ticked per search), no schedule (Repeat: Never), no arrival
 * window, and fixed dates the operator enters in Leave from and Leave by (rolling dates are a switch under More options,
 * filled in with the 7-day start and 182-day length).
 */
export function newSearchDraft(presets: ProvidersResponse['presets']): Draft {
  const d = defaultDraft(presets);
  const off = (ids: readonly Draft['providers']['discovery'][number][]) =>
    ids.filter((id) => id !== 'searchapi');
  return {
    ...d,
    providers: {
      ...d.providers,
      discovery: off(d.providers.discovery),
      verification: off(d.providers.verification),
    },
    window: EMPTY_ABSOLUTE,
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
}: {
  providers: ProvidersResponse;
  /** The estimate's debounce; tests that are not about it inject 0 (the debounce test steps the real value). */
  debounceMs?: number;
}) {
  const qc = useQueryClient();
  const [initial] = useState(() => newSearchDraft(providers.presets));
  const form = useSearchForm(initial, { nameTouched: false, debounceMs });
  const budget = useBudget();
  // why: Ruling 13 — the panel's "M left" is the top bar's figure, from the one helper
  const callsLeft = budget.data === undefined ? null : searchApiCallsLeft(budget.data, providers);
  const est = form.estimate;
  const { draft } = form;
  const repeats = draft.enabled && draft.scheduleCron !== null;
  const sentence = sentenceOf(
    est.estimate,
    repeats ? { cron: draft.scheduleCron, tz: draft.scheduleTz } : null,
    N.search,
  );

  const [failure, setFailure] = useState<string | null>(null);
  // why: the over-limit refusal shows the monthly figure it names ("see the monthly figure")
  const [overFit, setOverFit] = useState<BudgetFit | null>(null);
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
      // why: Ruling 14 — the api's monthly-fit refusal in Repeat weekly's words, never the server's
      if (e instanceof ApiError && e.code === 'schedule_over_budget')
        setFailure(COPY.repeatWeekly.overBudget);
      else if (e instanceof ApiError && e.status === 422) {
        form.setSaveErrors(e.fieldErrors());
        setFailure(null);
      } else setFailure(N.saveFailed(e.message));
    },
  });

  const wait = form.wait;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="new-search-form">
      <SearchFields form={form} providers={providers} callsLeft={callsLeft} edit={false} budgetFit={null} />
      <SentenceRegion sentence={sentence} wait={wait} ids={IDS} />
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
            setOverFit(fit);
            setFailure(COPY.repeatWeekly.overBudget);
            return;
          }
          sending.current = true;
          setOverFit(null);
          setFailure(null);
          create.mutate({
            ...form.body,
            confirmCostPence: covers.pence,
            confirmCalls: covers.calls,
            // why: a fresh key a press, so a retry of this very request (a double send) creates nothing more
            requestKey: newRequestKey(),
          });
        }}
      />
      {failure !== null ? (
        <div role="alert" className="new-search-refused">
          <p className="bad-text">{failure}</p>
          {overFit !== null ? <BudgetFitPanel fit={overFit} /> : null}
        </div>
      ) : null}
    </form>
  );
}
