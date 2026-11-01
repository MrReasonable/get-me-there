import { DEFAULT_CRON, isScheduled } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { useEstimateDraft } from '../../api/queries.js';
import type { DefinitionResponse, DefinitionUpdateBody } from '../../api/types.js';
import { DAY_PLURAL, listText, SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { definitionToDraft, draftToRequest } from '../Definitions/draft.js';
import { BudgetFitPanel } from '../Definitions/EstimatePanel.js';
import { SCHEDULE_FIELD_ID, ScheduleField } from '../Definitions/ScheduleField.js';
import { parseSchedule } from '../Definitions/schedule.js';
import { SentenceButton, SentenceRegion, sentenceOf } from '../Searches/EstimateSentence.js';

const W = COPY.repeatWeekly;

/** "Repeats Mondays 05:00", "Repeats every day 05:00", or "Repeats on a set schedule" for a cron the picker cannot word. */
export function repeatsText(cron: string | null): string {
  const s = parseSchedule(cron);
  if (s.kind === 'weekly') return W.repeats(listText(s.days.map((d) => DAY_PLURAL[d] ?? String(d))), s.time);
  if (s.kind === 'daily') return W.repeatsDaily(s.time);
  return W.repeatsOther;
}

/**
 * Spec rev 55 §8.2, §11 "Repeat weekly…" on a search's page (WP20 Task 20.5; rulings A13, 20.0 concern 6). A search has
 * no schedule until the operator gives it one here. "Repeat weekly…" opens the schedule fields with the stored cron,
 * else `DEFAULT_CRON` (Mondays 05:00), in the search's time zone (`SCHEDULER_TIMEZONE` when it was created), beside the
 * estimate sentence and the monthly figure (the budget fit at the schedule's runs a month), and sends nothing until
 * Save. Save checks the month's fit (a 422 is said in words beside the fields), registers the schedule and stores the
 * sentence's shown runnable totals as the schedule's confirmation, which scheduled runs then use: one `PUT` of
 * `{ scheduleCron, enabled: true, confirmedCostPence, confirmedCalls, confirmShown: true }` (the cron left out when it
 * is the one stored). A scheduled search reads "Repeats Mondays 05:00 · Change", and "Stop repeating" sets `enabled`
 * 0. A search whose latest run is stopped needs no warning here: its first firing supersedes that run (Task 20.2).
 */
export function RepeatWeekly({ definition }: { definition: DefinitionResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const scheduled = isScheduled(definition);
  const update = useMutation({
    mutationFn: (body: DefinitionUpdateBody) => api.updateDefinition(definition.id, body),
    onSuccess: () =>
      void Promise.all([['definitions'], ['cards']].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
  if (open)
    return (
      <ScheduleEditor
        definition={definition}
        onDone={(saved) => {
          setOpen(false);
          setNotice(saved ? W.saved : null);
        }}
      />
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      {scheduled ? (
        <>
          <span>{repeatsText(definition.scheduleCron)}</span>
          <button type="button" className="btn btn-sm min-h-11" onClick={() => setOpen(true)}>
            {W.change}
          </button>
          <button
            type="button"
            className="btn btn-sm min-h-11"
            disabled={update.isPending}
            onClick={() => update.mutate({ enabled: false }, { onSuccess: () => setNotice(W.stopped) })}
          >
            {update.isPending ? COPY.working : W.stop}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm min-h-11" onClick={() => setOpen(true)}>
          {W.open}
        </button>
      )}
      {update.error !== null ? (
        <span role="alert" className="bad-text text-sm">
          {COPY.actionFailed(update.error.message)}
        </span>
      ) : null}
      {notice !== null ? (
        <span role="status" className="text-sm">
          {notice}
        </span>
      ) : null}
    </span>
  );
}

/** The open schedule fields, the sentence and the monthly figure, and Save. */
function ScheduleEditor({
  definition,
  onDone,
}: {
  definition: DefinitionResponse;
  onDone: (saved: boolean) => void;
}) {
  const qc = useQueryClient();
  const [cron, setCron] = useState<string | null>(definition.scheduleCron ?? DEFAULT_CRON);
  const [incomplete, setIncomplete] = useState(false);
  const prefix = useId();
  const ids = { reason: `${prefix}-reason`, line: `${prefix}-line` };
  // why: the estimate of the search as it would repeat, so the monthly figure counts the picked schedule's runs; the
  // first is asked at once (the search is whole), a change of the picker after the debounce
  const body =
    cron === null || incomplete
      ? null
      : draftToRequest({ ...definitionToDraft(definition), scheduleCron: cron, enabled: true });
  // why: ruling R2 — estimated as this search, so its own schedule's reservation is not counted against it
  const estimate = useEstimateDraft(body, { immediate: true, definitionId: definition.id });
  const [moved, setMoved] = useState(false);
  const sentence = sentenceOf(
    estimate.estimate,
    cron === null ? null : { cron, tz: definition.scheduleTz },
    W.save,
  );
  const save = useMutation({
    mutationFn: async (covers: { pence: number; calls: number }) => {
      const d = await api.updateDefinition(definition.id, {
        ...(cron === definition.scheduleCron ? {} : { scheduleCron: cron }),
        enabled: true,
        confirmedCostPence: covers.pence,
        confirmedCalls: covers.calls,
        confirmShown: true,
      });
      return { d, covers };
    },
    onSuccess: ({ d, covers }) => {
      void Promise.all([['definitions'], ['cards']].map((queryKey) => qc.invalidateQueries({ queryKey })));
      // why: fix round 1, finding 2 — the server stores the figures only when they cover its own recomputation; when
      // they were not stored the estimate moved since it was shown, so it is asked again and the fields stay open
      if (d.confirmedCostPence !== covers.pence || d.confirmedCalls !== covers.calls) {
        setMoved(true);
        estimate.refetch();
        return;
      }
      onDone(true);
    },
  });
  const wait =
    cron === null
      ? W.pickSchedule
      : incomplete
        ? SETUP_COPY.schedule.blocked
        : estimate.error !== null
          ? COPY.newSearch.estimateFailed(estimate.error.message)
          : sentence === null
            ? COPY.newSearch.working
            : null;
  const refused =
    save.error === null
      ? null
      : save.error instanceof ApiError && save.error.code === 'schedule_over_budget'
        ? W.overBudget
        : COPY.actionFailed(save.error.message);
  return (
    <div className="repeat-weekly space-y-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="def-fold-legend">{W.fieldsLabel}</legend>
        <ScheduleField
          cron={cron}
          tz={definition.scheduleTz}
          enabled
          onChange={setCron}
          onIncomplete={(id, on) => {
            if (id === SCHEDULE_FIELD_ID) setIncomplete(on);
          }}
        />
        {refused !== null ? (
          <p role="alert" className="bad-text">
            {refused}
          </p>
        ) : null}
      </fieldset>
      <SentenceRegion sentence={sentence} wait={wait} ids={ids} />
      {estimate.estimate !== null ? (
        <div>
          <p className="field-label">{W.monthHeading}</p>
          <BudgetFitPanel fit={estimate.estimate.budgetFit} />
        </div>
      ) : null}
      <span className="flex flex-wrap items-center gap-2">
        <SentenceButton
          verb={W.save}
          sentence={sentence}
          wait={wait}
          pending={save.isPending}
          ids={ids}
          onPress={(covers) => {
            setMoved(false);
            save.mutate(covers);
          }}
        />
        <button type="button" className="btn min-h-11" onClick={() => onDone(false)}>
          {W.cancel}
        </button>
        {moved ? (
          <span role="alert" className="bad-text text-sm">
            {W.estimateChanged}
          </span>
        ) : null}
      </span>
    </div>
  );
}
