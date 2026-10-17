import { microGbpToPence } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type FieldError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, EstimateResponse, ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../example.js';
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
import { FieldErrors, PoundsField } from './fields.js';
import { SearchSpaceFields } from './SearchSpaceFields.js';

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsFor = (errors: readonly FieldError[], field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

const input = 'min-h-11 rounded border border-slate-400 px-1';
/** Fields that live inside the collapsed advanced fold. */
const ADVANCED_FIELDS = /^(constraints|verification|budget|providers|schedule|enabled)/;
const button = 'min-h-11 rounded border border-slate-700 px-3';

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
  // why: a half-filled time window is a local field error; saving or estimating would send a window the operator changed.
  const [incomplete, setIncomplete] = useState<readonly string[]>([]);
  const markIncomplete = useCallback(
    (id: string, on: boolean) =>
      setIncomplete((prev) =>
        on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id),
      ),
    [],
  );
  // why: a required number box left blank is also a local field error (UI-10); neither is coerced to a value.
  const [blank, setBlank] = useState<readonly string[]>([]);
  const markBlank = useCallback(
    (id: string, on: boolean) =>
      setBlank((prev) => (on ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((x) => x !== id))),
    [],
  );
  const blocked = incomplete.length > 0 || blank.length > 0;
  // why: the API's field errors move focus to their summary, and open the fold when one names an advanced field (UI-11).
  const summaryRef = useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useEffect(() => {
    if (fieldErrors.length === 0) return;
    if (fieldErrors.some((e) => ADVANCED_FIELDS.test(e.field))) setAdvancedOpen(true);
    summaryRef.current?.focus();
  }, [fieldErrors]);
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

  const fresh = estimate !== null && estimatedFor === current;
  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-3 text-sm">
      {fieldErrors.length > 0 ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded border border-red-700 p-2">
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
        onClick={() => {
          setDraft(applyExample(draft, EXAMPLE_DEFINITION));
          setBlank([]);
        }}
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
      <SearchSpaceFields
        draft={draft}
        setDraft={setDraft}
        otherWindow={otherWindow}
        setOtherWindow={setOtherWindow}
        errorsFor={(field) => errorsFor(fieldErrors, field)}
        blank={blank}
        markBlank={markBlank}
      />
      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
        <summary className="min-h-11 cursor-pointer font-semibold">{COPY.advanced}</summary>
        <AdvancedFields
          draft={draft}
          setDraft={setDraft}
          capabilities={capabilities}
          onIncomplete={markIncomplete}
        />
      </details>
      <CoverageCheck draft={draft} available={travelpayouts} />
      {saved === null ? (
        <button
          type="button"
          className={button}
          disabled={blocked || estimateDraft.isPending}
          aria-busy={estimateDraft.isPending ? true : undefined}
          aria-describedby={blocked ? 'd-blocked' : undefined}
          onClick={() => estimateDraft.mutate()}
        >
          {estimateDraft.isPending ? COPY.working : COPY.showEstimate}
        </button>
      ) : (
        <button
          type="button"
          className={button}
          disabled={blocked || save.isPending}
          aria-busy={save.isPending ? true : undefined}
          aria-describedby={blocked ? 'd-blocked' : undefined}
          onClick={() => save.mutate(saved)}
        >
          {save.isPending ? COPY.working : COPY.save}
        </button>
      )}
      {blocked ? (
        <p id="d-blocked" className="text-red-800">
          {[
            ...(incomplete.length > 0 ? [COPY.blockedByTimeWindow] : []),
            ...(blank.length > 0 ? [COPY.blockedByRequired] : []),
          ].join(' ')}
        </p>
      ) : null}
      {saved === null && estimate !== null ? (
        <CreateConfirmation
          estimate={estimate}
          fresh={fresh}
          blocked={blocked}
          pending={create.isPending}
          hardStop={draft.budget.maxCalls}
          onCreate={() => create.mutate(estimate)}
        />
      ) : null}
      {saved !== null ? (
        <Reconfirmation
          definition={saved}
          pending={confirm.isPending}
          onConfirm={(v) => confirm.mutate({ id: saved.id, ...v })}
        />
      ) : null}
      {saved?.estimate ? <EstimatePanel estimate={saved.estimate} hardStop={saved.budget.maxCalls} /> : null}
      {saved !== null ? <BudgetFitPanel fit={saved.budgetFit} /> : null}
      {notice !== null ? <p role="status">{notice}</p> : null}
    </form>
  );
}
