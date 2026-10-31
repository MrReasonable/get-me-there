import { apiContract } from '@gmt/core';
import type { ReactNode } from 'react';
import type { BudgetFit, ProvidersResponse } from '../../api/types.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import { withKey } from '../../state/withKey.js';
import { AdvancedFields, type ProviderCapabilities } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { BudgetFitPanel } from './EstimatePanel.js';
import { FieldErrors, HoursMinutesField, NumberField, PoundsField } from './fields.js';
import { LeaveBetweenField } from './LeaveBetweenField.js';
import { RollingWindowFields } from './RollingWindowFields.js';
import type { SearchForm } from './useSearchForm.js';

const input = 'input min-h-11';
/** The short form's group titles (From, Leave between, Stay): one weight and size. */
const GROUP_TITLE = 'def-group-title';
const SR_ONLY = 'sr-only';

/** The enabled sources by what they can do, for the price-source ticks in More options. */
export function capabilitiesOf(providers: ProvidersResponse): ProviderCapabilities[] {
  return providers.providers
    .filter((p) => p.enabled)
    .map((p) => ({
      id: p.providerId,
      displayName: p.displayName,
      discovery: p.capabilities.discovery !== null,
      verification: p.capabilities.verification !== null,
    }));
}

/**
 * Spec rev 55 §11 (WP20 Task 20.5; design §4.1): the fields of a search, as the new-search form and the Edit page both
 * show them. In view: From, To (the airport search), Leave between (two "10 Jan 2027" dates) and Stay (shortest to
 * longest nights). Under More options, already filled in from the presets: the longest journey each way (25 h), the
 * cabin, rolling dates instead of fixed ones, the name (suggested from the airports), the price sources, policy and run
 * budget with their one-line explanations, and the budget-fit table. The time windows are empty, "only if you set one".
 * `edit` adds what only a saved search has: the notes and onward costs per destination and the schedule fields (`extra`
 * renders after the fold: the coverage check).
 */
export function SearchFields({
  form,
  providers,
  edit,
  budgetFit,
  extra,
}: {
  form: SearchForm;
  providers: ProvidersResponse;
  edit: boolean;
  budgetFit: BudgetFit | null;
  extra?: ReactNode;
}) {
  const { draft, setDraft, blank, markBlank } = form;
  return (
    <>
      {form.fieldErrors.length > 0 ? (
        <div ref={form.summaryRef} tabIndex={-1} role="alert" className="def-errors">
          <p className="bad-text">{COPY.fieldErrorsHeading}</p>
          <ul>
            {form.fieldErrors.map((e) => (
              <li key={`${e.field}-${e.message}`}>{COPY.fieldError(e.field, e.message)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <section aria-label={PLAN_COPY.heading} className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2">
          <AirportListInput
            id="origins"
            label={PLAN_COPY.from}
            placeholder={PLAN_COPY.fromPlaceholder}
            codes={draft.origins}
            details={form.details}
            onChange={(origins) => setDraft({ ...draft, origins })}
            errors={form.errorsFor('origins')}
          />
          <AirportListInput
            id="destinations"
            label={PLAN_COPY.to}
            placeholder={PLAN_COPY.toPlaceholder}
            codes={draft.destinations}
            details={form.details}
            onChange={(destinations) => setDraft({ ...draft, destinations })}
            errors={form.errorsFor('destinations')}
          />
        </div>
        <LeaveBetweenField form={form} />
        <fieldset className="flex flex-col gap-1">
          <legend className={GROUP_TITLE}>{PLAN_COPY.stay}</legend>
          {/* why: "[10] to [21] nights" reads as one range; each box keeps its own label for a screen reader */}
          <span className="flex flex-wrap items-start gap-2">
            <NumberField
              id="n-min"
              label={PLAN_COPY.shortest}
              labelClassName={SR_ONLY}
              value={blank.includes('n-min') ? undefined : draft.minNights}
              errors={[...form.errorsFor('minNights'), ...(blank.includes('n-min') ? [COPY.required] : [])]}
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
              errors={[...form.errorsFor('maxNights'), ...(blank.includes('n-max') ? [COPY.required] : [])]}
              onChange={(v) => {
                markBlank('n-max', v === undefined);
                if (v !== undefined) setDraft({ ...draft, maxNights: v });
              }}
            />
          </span>
        </fieldset>
      </section>
      <details
        open={form.advancedOpen}
        onToggle={(e) => form.setAdvancedOpen(e.currentTarget.open)}
        className="fold def-more"
      >
        <summary className="min-h-12">
          <span>{PLAN_COPY.moreOptions}</span>
          <span className="hint font-normal">
            {edit ? PLAN_COPY.moreOptionsHint : PLAN_COPY.moreOptionsNew}
          </span>
        </summary>
        <div className="space-y-5 pt-2 pb-6">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
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
          <RollingWindowFields form={form} />
          <NameField form={form} />
          {edit ? <DestinationFields form={form} /> : null}
          <AdvancedFields
            draft={draft}
            setDraft={setDraft}
            capabilities={capabilitiesOf(providers)}
            onIncomplete={form.markIncomplete}
            schedule={edit}
          />
          {budgetFit !== null ? <BudgetFitPanel fit={budgetFit} /> : null}
        </div>
      </details>
      {extra}
    </>
  );
}

/** The search's name, suggested from the airports until the operator types one; blurred empty, it follows them again. */
function NameField({ form }: { form: SearchForm }) {
  const errors = form.errorsFor('name');
  return (
    <span className="flex max-w-md flex-col gap-1">
      <label htmlFor="d-name" className={GROUP_TITLE}>
        {PLAN_COPY.name}
      </label>
      <input
        id="d-name"
        value={form.draft.name}
        aria-invalid={errors.length > 0}
        aria-describedby={errors.length > 0 ? 'd-name-hint d-name-errors' : 'd-name-hint'}
        onChange={(e) => {
          form.setNameTouched(true);
          form.setDraft({ ...form.draft, name: e.target.value });
        }}
        onBlur={(e) => {
          if (e.target.value.trim() === '') form.setNameTouched(false);
        }}
        className={input}
      />
      <span id="d-name-hint" className="hint">
        {PLAN_COPY.nameHint}
      </span>
      <FieldErrors id="d-name-errors" messages={errors} />
    </span>
  );
}

/** The Edit page's note and onward cost per destination (spec §11 Edit). */
function DestinationFields({ form }: { form: SearchForm }) {
  const { draft, setDraft } = form;
  return (
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
    </fieldset>
  );
}
