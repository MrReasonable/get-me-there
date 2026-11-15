import { apiContract } from '@gmt/core';
import type { ReactNode } from 'react';
import type { BudgetFit, ProvidersResponse } from '../../api/types.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import type { CallsLeft } from '../../lib/searchApiCallsLeft.js';
import { withKey } from '../../state/withKey.js';
import { AdvancedFields } from './AdvancedFields.js';
import { AirportListInput } from './AirportListInput.js';
import { BudgetFitPanel } from './EstimatePanel.js';
import { FieldErrors, HoursMinutesField, NumberField, PoundsField } from './fields.js';
import { LeaveBetweenField } from './LeaveBetweenField.js';
import { RepeatField } from './RepeatField.js';
import { RollingWindowFields } from './RollingWindowFields.js';
import type { SearchForm } from './useSearchForm.js';
import { WhereToLook } from './WhereToLook.js';

const input = 'input min-h-11';
/** The short form's group titles (From, Leave between, Stay): one weight and size. */
const GROUP_TITLE = 'def-group-title';
const SR_ONLY = 'sr-only';

/**
 * Spec rev 55 §11 (WP20 Task 20.5; design 2026-11-08 Rulings 13–14): the fields of a search, as the new-search panel and
 * the Edit page both show them. In view: From, To (the airport search), Leave from and Leave by (two browser date
 * fields), Stay (shortest to longest nights) and Where to look (each source set up, with its cost). Under More options,
 * already filled in from the presets: the longest journey each way (25 h), the cabin, Repeat, rolling dates instead of
 * fixed ones, and the name (suggested from the airports). The time windows are empty, "only if you set one". `edit`
 * adds a second fold, Limits and checks, with what only the Edit page shows: the notes and onward costs per
 * destination, the constraints, checking fares, the run budget with its refresh intervals, and the budget fit
 * (`extra` renders after the folds: the coverage check).
 */
export function SearchFields({
  form,
  providers,
  callsLeft,
  edit,
  budgetFit,
  extra,
}: {
  form: SearchForm;
  providers: ProvidersResponse;
  /** SearchApi's calls left, as the top bar says them (`searchApiCallsLeft`), or null when there is nothing to say. */
  callsLeft: CallsLeft | null;
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
      <section aria-label={PLAN_COPY.heading} className="search-fields">
        <div className="search-places">
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
        <WhereToLook draft={draft} onChange={setDraft} providers={providers} callsLeft={callsLeft} />
      </section>
      <details
        open={form.advancedOpen}
        onToggle={(e) => form.setAdvancedOpen(e.currentTarget.open)}
        className="fold def-more"
      >
        <summary className="min-h-12">
          <span>{PLAN_COPY.moreOptions}</span>
        </summary>
        <div className="search-more">
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
          <div className="search-pair">
            <span className="flex flex-col gap-1">
              <label htmlFor="d-cabin" className="field-label">
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
            {/* why: Ruling 14 — a search that is not repeating (never, or stopped: `enabled` off) reads Never; a pick
            stores the cron and turns repeating on or off with it */}
            <RepeatField
              cron={draft.enabled ? draft.scheduleCron : null}
              tz={draft.scheduleTz}
              onChange={(scheduleCron) =>
                setDraft({ ...draft, scheduleCron, enabled: scheduleCron !== null })
              }
              onIncomplete={form.markIncomplete}
            />
          </div>
          <RollingWindowFields form={form} />
          <NameField form={form} />
        </div>
      </details>
      {edit ? (
        <details
          open={form.limitsOpen}
          onToggle={(e) => form.setLimitsOpen(e.currentTarget.open)}
          className="fold def-more"
        >
          <summary className="min-h-12">
            <span>{COPY.newSearch.limitsHeading}</span>
          </summary>
          <div className="space-y-5 pt-2 pb-6">
            <DestinationFields form={form} />
            <AdvancedFields draft={draft} setDraft={setDraft} onIncomplete={form.markIncomplete} />
            {budgetFit !== null ? <BudgetFitPanel fit={budgetFit} /> : null}
          </div>
        </details>
      ) : null}
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
