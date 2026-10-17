import { apiContract, londonDateOf, microGbpToPence, resolveWindow } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, type FieldError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, EstimateResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../example.js';
import { formatIsoDate } from '../../format.js';
import { useNow } from '../../now.js';
import { updateSearchParams } from '../../state/urlState.js';
import { withKey } from '../../state/withKey.js';
import { AdvancedFields, type ProviderCapabilities } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { CreateConfirmation, Reconfirmation } from './Confirmation.js';
import { CoverageCheck } from './CoverageCheck.js';
import {
  applyExample,
  DEFAULT_RELATIVE,
  type Draft,
  type DraftWindow,
  defaultDraft,
  definitionToDraft,
  draftToRequest,
  EMPTY_ABSOLUTE,
} from './draft.js';
import { BudgetFitPanel, EstimatePanel } from './EstimatePanel.js';
import { FieldErrors, NumberField, PoundsField } from './fields.js';

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsFor = (errors: readonly FieldError[], field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

const input = 'min-h-11 rounded border border-slate-400 px-1';
const button = 'min-h-11 rounded border border-slate-700 px-3';

/** "departures from 21 Oct 2026 to 20 Apr 2027, as resolved today" under the relative fields (review PFT-08). */
function ResolvedWindow({ window: w }: { window: DraftWindow }) {
  const now = useNow();
  if (w.kind !== 'relative' || w.startOffsetDays < 1 || w.lengthDays < 1) return null;
  const r = resolveWindow(
    { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
    londonDateOf(now),
  );
  return (
    <p className="w-full text-xs">
      {COPY.resolvedWindow(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo))}
    </p>
  );
}

/**
 * Spec §11 Definitions form. New definition: "Show estimate" calls POST /api/definitions/estimate
 * with the unsaved body and shows the estimate and budgetFit; "Create and confirm" (below them) is
 * the explicit confirmation, a POST carrying confirmedCostPence = ceil(estimate / 10 000) (spec §8.1)
 * and confirmedCalls = the estimate's calls (decisions 42, 43),
 * labelled with the calls and the pounds it commits to (decision 36). Editing the draft after an
 * estimate hides Create and says why. Saved definition: "Save changes" PUTs; a needsConfirmation
 * response asks again before scheduled runs proceed.
 */
export function DefinitionForm({
  existing,
  providers,
}: {
  existing: DefinitionResponse | null;
  providers: ProvidersResponse;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() =>
    existing ? definitionToDraft(existing) : defaultDraft(providers.presets),
  );
  // why: switching the window mode keeps the other mode's values, so toggling back loses nothing (review PFT-08).
  const [otherWindow, setOtherWindow] = useState<DraftWindow>(() =>
    draft.window.kind === 'relative' ? EMPTY_ABSOLUTE : DEFAULT_RELATIVE,
  );
  const [saved, setSaved] = useState<DefinitionResponse | null>(existing);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const capabilities: ProviderCapabilities[] = providers.providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.providerId,
      displayName: p.displayName,
      discovery: p.capabilities.discovery !== null,
      verification: p.capabilities.verification !== null,
    }));
  const travelpayouts = providers.providers.some((p) => p.providerId === 'travelpayouts' && p.enabled);
  const current = JSON.stringify(draft);

  const refresh = () => qc.invalidateQueries({ queryKey: ['definitions'] });
  const onError = (e: Error) => {
    setFieldErrors(e instanceof ApiError ? e.fieldErrors() : []);
    setNotice(COPY.actionFailed(e.message));
  };
  const accept = (d: DefinitionResponse, message: string | null) => {
    setSaved(d);
    setFieldErrors([]);
    setNotice(message);
    void refresh();
  };

  const estimateDraft = useMutation({
    mutationFn: () => api.estimateDraft(draftToRequest(draft)),
    onSuccess: (e) => {
      setEstimate(e);
      setEstimatedFor(current);
      setFieldErrors([]);
      setNotice(null);
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (e: EstimateResponse) =>
      api.createDefinition({
        ...draftToRequest(draft),
        confirmedCostPence: microGbpToPence(e.estimate.totalCostMicroGbp),
        // why: decisions 42, 43: the calls the operator saw are confirmed with the pence; one without the other covers no run.
        confirmedCalls: e.estimate.totalCalls,
      }),
    onSuccess: (d) => {
      accept(d, COPY.created);
      // why: only the selected definition changes; edit= stays, so the form keeps its confirmation notice.
      updateSearchParams({ def: d.id });
    },
    onError,
  });
  const save = useMutation({
    mutationFn: (s: DefinitionResponse) => api.updateDefinition(s.id, draftToRequest(draft)),
    onSuccess: (d) => accept(d, COPY.saved),
    onError,
  });
  const confirm = useMutation({
    mutationFn: (v: { id: string; pence: number; calls: number }) =>
      api.updateDefinition(v.id, { confirmedCostPence: v.pence, confirmedCalls: v.calls }),
    onSuccess: (d) => accept(d, COPY.saved),
    onError,
  });

  const w = draft.window;
  const switchWindow = () => {
    setOtherWindow(w);
    setDraft({ ...draft, window: otherWindow });
  };
  const fresh = estimate !== null && estimatedFor === current;
  const nightsErrors = (field: 'minNights' | 'maxNights') => errorsFor(fieldErrors, field);
  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-3 text-sm">
      {fieldErrors.length > 0 ? (
        <div role="alert" className="rounded border border-red-700 p-2">
          <p className="font-semibold">{COPY.fieldErrorsHeading}</p>
          <ul>
            {fieldErrors.map((e) => (
              <li key={`${e.field}-${e.message}`}>{COPY.fieldError(e.field, e.message)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {saved !== null && saved.notices.length > 0 ? (
        <ul aria-label={COPY.definitionNotices} className="rounded border border-amber-700 bg-amber-50 p-2">
          {saved.notices.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className={button}
        onClick={() => setDraft(applyExample(draft, EXAMPLE_DEFINITION))}
      >
        {COPY.importExample(EXAMPLE_LABEL)}
      </button>
      <span className="flex flex-col">
        <label htmlFor="d-name">{COPY.name}</label>
        <input
          id="d-name"
          value={draft.name}
          aria-invalid={errorsFor(fieldErrors, 'name').length > 0}
          aria-describedby={errorsFor(fieldErrors, 'name').length > 0 ? 'd-name-errors' : undefined}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={input}
        />
        <FieldErrors id="d-name-errors" messages={errorsFor(fieldErrors, 'name')} />
      </span>
      <AirportListInput
        id="origins"
        label={COPY.origins}
        addLabel={COPY.addOrigin}
        codes={draft.origins}
        onChange={(origins) => setDraft({ ...draft, origins })}
        errors={errorsFor(fieldErrors, 'origins')}
      />
      <AirportListInput
        id="destinations"
        label={COPY.destinations}
        addLabel={COPY.addDestination}
        codes={draft.destinations}
        onChange={(destinations) => setDraft({ ...draft, destinations })}
        errors={errorsFor(fieldErrors, 'destinations')}
      />
      {draft.destinations.map((d) => (
        <span key={d} className="flex flex-wrap gap-3">
          <span className="flex flex-col">
            <label htmlFor={`note-${d}`}>{COPY.destinationNote(d)}</label>
            <input
              id={`note-${d}`}
              value={draft.destinationNotes[d] ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, destinationNotes: { ...draft.destinationNotes, [d]: e.target.value } })
              }
              className={input}
            />
          </span>
          <PoundsField
            id={`onward-${d}`}
            label={COPY.onwardCost(d)}
            pence={draft.onwardCostPence[d]}
            onChange={(p) => setDraft({ ...draft, onwardCostPence: withKey(draft.onwardCostPence, d, p) })}
          />
        </span>
      ))}
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="font-semibold">{COPY.windowHeading}</legend>
        <span className="flex min-h-11 items-center gap-1">
          <input
            id="w-relative"
            type="radio"
            name="window"
            checked={w.kind === 'relative'}
            onChange={switchWindow}
          />
          <label htmlFor="w-relative">{COPY.windowRelative}</label>
        </span>
        <span className="flex min-h-11 items-center gap-1">
          <input
            id="w-absolute"
            type="radio"
            name="window"
            checked={w.kind === 'absolute'}
            onChange={switchWindow}
          />
          <label htmlFor="w-absolute">{COPY.windowAbsolute}</label>
        </span>
        {w.kind === 'relative' ? (
          <>
            <NumberField
              id="w-offset"
              label={COPY.startOffsetDays}
              value={w.startOffsetDays}
              errors={errorsFor(fieldErrors, 'window.startOffsetDays')}
              onChange={(v) => setDraft({ ...draft, window: { ...w, startOffsetDays: v ?? 0 } })}
            />
            <NumberField
              id="w-length"
              label={COPY.lengthDays}
              value={w.lengthDays}
              errors={errorsFor(fieldErrors, 'window.lengthDays')}
              onChange={(v) => setDraft({ ...draft, window: { ...w, lengthDays: v ?? 0 } })}
            />
            <ResolvedWindow window={w} />
          </>
        ) : (
          <>
            <span className="flex flex-col">
              <label htmlFor="w-from">{COPY.windowFrom}</label>
              <input
                id="w-from"
                type="date"
                className={input}
                value={w.from}
                onChange={(e) => setDraft({ ...draft, window: { ...w, from: e.target.value } })}
              />
            </span>
            <span className="flex flex-col">
              <label htmlFor="w-to">{COPY.windowTo}</label>
              <input
                id="w-to"
                type="date"
                className={input}
                value={w.to}
                onChange={(e) => setDraft({ ...draft, window: { ...w, to: e.target.value } })}
              />
            </span>
          </>
        )}
        <NumberField
          id="n-min"
          label={COPY.minNights}
          value={draft.minNights}
          errors={nightsErrors('minNights')}
          onChange={(v) => setDraft({ ...draft, minNights: v ?? 0 })}
        />
        <NumberField
          id="n-max"
          label={COPY.maxNights}
          value={draft.maxNights}
          errors={nightsErrors('maxNights')}
          onChange={(v) => setDraft({ ...draft, maxNights: v ?? 0 })}
        />
        <span className="flex flex-col">
          <label htmlFor="d-cabin">{COPY.cabin}</label>
          <select
            id="d-cabin"
            className={input}
            value={draft.cabin}
            onChange={(e) => {
              const cabin = apiContract.cabinSchema.safeParse(e.target.value);
              if (cabin.success) setDraft({ ...draft, cabin: cabin.data });
            }}
          >
            {apiContract.cabinSchema.options.map((c) => (
              <option key={c} value={c}>
                {COPY.cabinName[c]}
              </option>
            ))}
          </select>
        </span>
      </fieldset>
      <details>
        <summary className="min-h-11 cursor-pointer font-semibold">{COPY.advanced}</summary>
        <AdvancedFields draft={draft} setDraft={setDraft} capabilities={capabilities} />
      </details>
      <CoverageCheck draft={draft} available={travelpayouts} />
      {saved === null ? (
        <button type="button" className={button} onClick={() => estimateDraft.mutate()}>
          {COPY.showEstimate}
        </button>
      ) : (
        <button type="button" className={button} onClick={() => save.mutate(saved)}>
          {COPY.save}
        </button>
      )}
      {saved === null && estimate !== null ? (
        <CreateConfirmation
          estimate={estimate}
          fresh={fresh}
          hardStop={draft.budget.maxCalls}
          onCreate={() => create.mutate(estimate)}
        />
      ) : null}
      {saved !== null ? (
        <Reconfirmation definition={saved} onConfirm={(v) => confirm.mutate({ id: saved.id, ...v })} />
      ) : null}
      {saved?.estimate ? <EstimatePanel estimate={saved.estimate} hardStop={saved.budget.maxCalls} /> : null}
      {saved !== null ? <BudgetFitPanel fit={saved.budgetFit} /> : null}
      {notice !== null ? <p role="status">{notice}</p> : null}
    </form>
  );
}
