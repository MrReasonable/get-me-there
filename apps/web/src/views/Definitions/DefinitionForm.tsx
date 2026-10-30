import { apiContract, microGbpToPence } from '@gmt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type FieldError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import type { DefinitionResponse, EstimateResponse, ProvidersResponse } from '../../api/types.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { EXAMPLE_DEFINITION, EXAMPLE_LABEL } from '../../example.js';
import { updateSearchParams } from '../../state/urlState.js';
import { withKey } from '../../state/withKey.js';
import { AdvancedFields, type ProviderCapabilities } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { suggestedName, useAirportDetails } from './airports.js';
import { CreateConfirmation, Reconfirmation } from './Confirmation.js';
import { CoverageCheck } from './CoverageCheck.js';
import { DepartureWindowField } from './DepartureWindowField.js';
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
import { FieldErrors, HoursMinutesField, NumberField, PoundsField } from './fields.js';
import { RollingWindowFields } from './RollingWindowFields.js';
import { SCHEDULE_FIELD_ID } from './ScheduleField.js';

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsFor = (errors: readonly FieldError[], field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

const input = 'input min-h-11';
/** Fields that live inside the collapsed More options fold; the journey time and the window's dates are in the short form. */
const ADVANCED_FIELDS =
  /^(constraints(?!\.maxJourneyMinutes)|verification|budget|providers|schedule|enabled|destinationNotes|onwardCostPence|window\.(startOffsetDays|lengthDays))/;
/** The short form's group titles (From, Departing between, Stay, Longest journey each way): one weight and size. */
const GROUP_TITLE = 'def-group-title';
const SR_ONLY = 'sr-only';
const primary = 'btn btn-primary min-h-11';
type EstimateBody = ReturnType<typeof draftToRequest>;
/** A draft as it was when Show estimate was clicked: its comparison key and the request body built from it. */
interface DraftSnapshot {
  key: string;
  body: EstimateBody;
}

/**
 * Spec §11 Definitions form, led by "Plan a search": from, to, when, how long, journey time, cabin and a name
 * suggested from the airports; everything else is under More options, from the plan preset's defaults. New definition: "Show estimate" calls POST /api/definitions/estimate
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
  const [stored, setDraft] = useState<Draft>(() =>
    existing ? definitionToDraft(existing) : defaultDraft(providers.presets),
  );
  // why: switching the window mode keeps the other mode's values, so toggling back loses nothing (review PFT-08).
  const [otherWindow, setOtherWindow] = useState<DraftWindow>(() =>
    stored.window.kind === 'relative' ? EMPTY_ABSOLUTE : DEFAULT_RELATIVE,
  );
  // why: the name follows the airports ("<from> → <to>") until the operator types one, imports the example or edits a
  // saved search; a name blurred empty follows them again.
  const [nameTouched, setNameTouched] = useState(existing !== null);
  const lookups = useAirportDetails([...stored.origins, ...stored.destinations]);
  const details = lookups.rows;
  // why: the name waits until every airport's lookup has answered, so it never shows a half-named route first.
  const suggestion = lookups.settled ? suggestedName(stored.origins, stored.destinations, details) : null;
  // why: derived, not written back by an effect, so no edit built on an older render can drop the suggested name; every
  // later setDraft({ ...draft }) carries it, so the estimate, the create body and the comparison key all hold it.
  const draft: Draft = nameTouched || suggestion === null ? stored : { ...stored, name: suggestion };
  const [saved, setSaved] = useState<DefinitionResponse | null>(existing);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimatedFor, setEstimatedFor] = useState<string | null>(null);
  // why: the body that was estimated; Create sends this one, so a later edit can never reach the server under an old confirmation.
  const [estimatedBody, setEstimatedBody] = useState<EstimateBody | null>(null);
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
    // why: the snapshot is the mutation variable, so onSuccess records the draft that was sent, not the one at response time.
    mutationFn: (snap: DraftSnapshot) => api.estimateDraft(snap.body),
    onSuccess: (e, snap) => {
      setEstimate(e);
      setEstimatedFor(snap.key);
      setEstimatedBody(snap.body);
      setFieldErrors([]);
      setNotice(null);
    },
    onError,
  });
  const create = useMutation({
    mutationFn: (v: { e: EstimateResponse; body: EstimateBody }) =>
      api.createDefinition({
        ...v.body,
        confirmedCostPence: microGbpToPence(v.e.estimate.totalCostMicroGbp),
        // why: decisions 42, 43: the calls the operator saw are confirmed with the pence; one without the other covers no run.
        confirmedCalls: v.e.estimate.totalCalls,
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
    // why: the departure board's form plate: fields on the left, the estimate and its actions in a side column that
    // stays in view on a desk (definitions.css); one column on a phone, in the same reading order
    <form onSubmit={(e) => e.preventDefault()} className="plate plate-pad def-form text-[15px]">
      <div className="def-main">
        {fieldErrors.length > 0 ? (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="def-errors">
            <p className="bad-text">{COPY.fieldErrorsHeading}</p>
            <ul>
              {fieldErrors.map((e) => (
                <li key={`${e.field}-${e.message}`}>{COPY.fieldError(e.field, e.message)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {saved !== null && saved.notices.length > 0 ? (
          <ul aria-label={COPY.definitionNotices} className="def-notices">
            {saved.notices.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        <section aria-labelledby="plan-heading" className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <div className="space-y-1">
              <h3 id="plan-heading" className="h-section">
                {PLAN_COPY.heading}
              </h3>
              <p className="lede">{PLAN_COPY.lead}</p>
            </div>
            <button
              type="button"
              className="btn-text min-h-11 text-fg-2"
              onClick={() => {
                setDraft(applyExample(draft, EXAMPLE_DEFINITION));
                setNameTouched(true);
                setBlank([]);
              }}
            >
              {COPY.importExample(EXAMPLE_LABEL)}
            </button>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <AirportListInput
              id="origins"
              label={PLAN_COPY.from}
              placeholder={PLAN_COPY.fromPlaceholder}
              codes={draft.origins}
              details={details}
              onChange={(origins) => setDraft({ ...draft, origins })}
              errors={errorsFor(fieldErrors, 'origins')}
            />
            <AirportListInput
              id="destinations"
              label={PLAN_COPY.to}
              placeholder={PLAN_COPY.toPlaceholder}
              codes={draft.destinations}
              details={details}
              onChange={(destinations) => setDraft({ ...draft, destinations })}
              errors={errorsFor(fieldErrors, 'destinations')}
            />
          </div>
          <DepartureWindowField
            window={draft.window}
            setWindow={(window) => setDraft({ ...draft, window })}
            otherWindow={otherWindow}
            setOtherWindow={setOtherWindow}
            errorsFor={(field) => errorsFor(fieldErrors, field)}
            clearBlank={() => {
              for (const id of ['w-offset', 'w-length']) markBlank(id, false);
            }}
          />
          <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
            <fieldset className="flex flex-col gap-1">
              <legend className={GROUP_TITLE}>{PLAN_COPY.stay}</legend>
              {/* why: "[10] to [21] nights" reads as one range; each box keeps its own label for a screen reader */}
              <span className="flex flex-wrap items-start gap-2">
                <NumberField
                  id="n-min"
                  label={PLAN_COPY.shortest}
                  labelClassName={SR_ONLY}
                  value={blank.includes('n-min') ? undefined : draft.minNights}
                  errors={[
                    ...errorsFor(fieldErrors, 'minNights'),
                    ...(blank.includes('n-min') ? [COPY.required] : []),
                  ]}
                  onChange={(v) => {
                    markBlank('n-min', v === undefined);
                    if (v !== undefined) setDraft({ ...draft, minNights: v });
                  }}
                />
                <span aria-hidden="true" className="flex min-h-11 items-center text-fg-2">
                  {PLAN_COPY.stayTo}
                </span>
                <NumberField
                  id="n-max"
                  label={PLAN_COPY.longest}
                  labelClassName={SR_ONLY}
                  hint={PLAN_COPY.nights}
                  value={blank.includes('n-max') ? undefined : draft.maxNights}
                  errors={[
                    ...errorsFor(fieldErrors, 'maxNights'),
                    ...(blank.includes('n-max') ? [COPY.required] : []),
                  ]}
                  onChange={(v) => {
                    markBlank('n-max', v === undefined);
                    if (v !== undefined) setDraft({ ...draft, maxNights: v });
                  }}
                />
              </span>
            </fieldset>
            <HoursMinutesField
              id="c-maxJourney"
              label={PLAN_COPY.journey}
              legendClassName={GROUP_TITLE}
              description={PLAN_COPY.journeyHint}
              value={draft.constraints.maxJourneyMinutes}
              onChange={(n) =>
                setDraft({ ...draft, constraints: withKey(draft.constraints, 'maxJourneyMinutes', n) })
              }
            />
            <span className="flex flex-col gap-1">
              <label htmlFor="d-cabin" className={GROUP_TITLE}>
                {COPY.cabin}
              </label>
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
          </div>
          <span className="flex max-w-md flex-col gap-1">
            <label htmlFor="d-name" className={GROUP_TITLE}>
              {PLAN_COPY.name}
            </label>
            <input
              id="d-name"
              value={draft.name}
              aria-invalid={errorsFor(fieldErrors, 'name').length > 0}
              aria-describedby={
                errorsFor(fieldErrors, 'name').length > 0 ? 'd-name-hint d-name-errors' : 'd-name-hint'
              }
              onChange={(e) => {
                setNameTouched(true);
                setDraft({ ...draft, name: e.target.value });
              }}
              onBlur={(e) => {
                if (e.target.value.trim() === '') setNameTouched(false);
              }}
              className={input}
            />
            <span id="d-name-hint" className="hint">
              {PLAN_COPY.nameHint}
            </span>
            <FieldErrors id="d-name-errors" messages={errorsFor(fieldErrors, 'name')} />
          </span>
        </section>
        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
          className="fold def-more"
        >
          <summary className="min-h-12">
            <span>{PLAN_COPY.moreOptions}</span>
            <span className="hint font-normal">{PLAN_COPY.moreOptionsHint}</span>
          </summary>
          <div className="space-y-5 pt-2 pb-6">
            <RollingWindowFields
              window={draft.window}
              setWindow={(window) => setDraft({ ...draft, window })}
              errorsFor={(field) => errorsFor(fieldErrors, field)}
              blank={blank}
              markBlank={markBlank}
            />
            <fieldset className="def-fold-group flex flex-col gap-3">
              <legend className="def-fold-legend">{PLAN_COPY.notesHeading}</legend>
              {draft.destinations.length === 0 ? <p className="text-fg-2">{PLAN_COPY.notesEmpty}</p> : null}
              {draft.destinations.map((d) => (
                <span key={d} className="flex flex-wrap gap-3">
                  <span className="flex flex-col gap-1">
                    <label htmlFor={`note-${d}`} className="field-label">
                      {COPY.destinationNote(d)}
                    </label>
                    <input
                      id={`note-${d}`}
                      value={draft.destinationNotes[d] ?? ''}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          destinationNotes: { ...draft.destinationNotes, [d]: e.target.value },
                        })
                      }
                      className={input}
                    />
                  </span>
                  <PoundsField
                    id={`onward-${d}`}
                    label={COPY.onwardCost(d)}
                    pence={draft.onwardCostPence[d]}
                    onChange={(p) =>
                      setDraft({ ...draft, onwardCostPence: withKey(draft.onwardCostPence, d, p) })
                    }
                  />
                </span>
              ))}
            </fieldset>
            <AdvancedFields
              draft={draft}
              setDraft={setDraft}
              capabilities={capabilities}
              onIncomplete={markIncomplete}
            />
          </div>
        </details>
        <CoverageCheck draft={draft} available={travelpayouts} />
      </div>
      <div className="def-side">
        {saved === null ? (
          <button
            type="button"
            className={primary}
            disabled={blocked || estimateDraft.isPending}
            aria-busy={estimateDraft.isPending ? true : undefined}
            aria-describedby={blocked ? 'd-blocked' : undefined}
            onClick={() => estimateDraft.mutate({ key: current, body: draftToRequest(draft) })}
          >
            {estimateDraft.isPending ? COPY.working : COPY.showEstimate}
          </button>
        ) : (
          <button
            type="button"
            className={primary}
            disabled={blocked || save.isPending}
            aria-busy={save.isPending ? true : undefined}
            aria-describedby={blocked ? 'd-blocked' : undefined}
            onClick={() => save.mutate(saved)}
          >
            {save.isPending ? COPY.working : COPY.save}
          </button>
        )}
        {blocked ? (
          <p id="d-blocked" className="bad-text">
            {[
              ...(incomplete.some((id) => id !== SCHEDULE_FIELD_ID) ? [COPY.blockedByTimeWindow] : []),
              ...(incomplete.includes(SCHEDULE_FIELD_ID) ? [SETUP_COPY.schedule.blocked] : []),
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
            onCreate={() => {
              if (estimatedBody !== null) create.mutate({ e: estimate, body: estimatedBody });
            }}
          />
        ) : null}
        {saved !== null ? (
          <Reconfirmation
            definition={saved}
            pending={confirm.isPending}
            onConfirm={(v) => confirm.mutate({ id: saved.id, ...v })}
          />
        ) : null}
        {saved?.estimate ? (
          <EstimatePanel estimate={saved.estimate} hardStop={saved.budget.maxCalls} />
        ) : null}
        {saved !== null ? <BudgetFitPanel fit={saved.budgetFit} /> : null}
        {notice !== null ? (
          <p role="status" className="font-semibold">
            {notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
