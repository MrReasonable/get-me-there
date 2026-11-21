import { MAX_WINDOW_DAYS, MAX_WINDOW_MONTHS, resolveWindow, WINDOW_PRESET_MONTHS } from '@gmt/core';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import type { DraftWindow } from './draft.js';
import { NumberField } from './fields.js';
import type { DateEnd, SearchForm } from './useSearchForm.js';
import { choiceOf, choiceValue, windowChoice } from './windowChoice.js';

const dateInput = 'input min-h-11';

/**
 * A whole number from 1 to `max`: the only values a rolling window's dates are worked out from. A number box takes any
 * digits (309 of them read as Infinity), which the API refuses by its field; until then the line is left out rather
 * than the resolution throwing and taking the form down.
 */
const resolvable = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
/** The two ends of Leave between, first then last, with their labels. */
const ENDS: ReadonlyArray<{ end: DateEnd; label: string }> = [
  { end: 'from', label: PLAN_COPY.earliest },
  { end: 'to', label: PLAN_COPY.latest },
];

/**
 * Spec §11 "When to leave": one choice of Next month, Next 3, 6 or 9 months, Next year (rolling windows in calendar
 * months, starting two weeks ahead, re-read on every run) or Set date range, which shows the two browser date fields
 * ("Leave from" and "Leave by", spec rev 67, design 2026-11-08 Ruling 13). A search saved with another rolling window
 * keeps it as a further choice, with its "starts in, lasts" boxes when it counts days. A rolling choice states the dates
 * it covers today.
 */
export function LeaveBetweenField({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  const choice = windowChoice(w);
  // why: while it is chosen the option names the window as edited; otherwise as it was last left
  const custom = choice === 'custom' ? w : form.customWindow;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{PLAN_COPY.leaveBetween}</legend>
      <span className="flex flex-col gap-1">
        <label htmlFor="w-choice" className="field-label">
          {PLAN_COPY.whenToLeave}
        </label>
        <select
          id="w-choice"
          className="input min-h-11"
          value={choiceValue(choice)}
          onChange={(e) => {
            const next = choiceOf(e.target.value);
            if (next === null) return;
            for (const id of ['w-offset', 'w-length']) form.markBlank(id, false);
            form.chooseWindow(next);
          }}
        >
          {WINDOW_PRESET_MONTHS.map((n) => (
            <option key={n} value={choiceValue(n)}>
              {PLAN_COPY.nextMonths(n)}
            </option>
          ))}
          <option value={choiceValue('range')}>{PLAN_COPY.setDateRange}</option>
          {custom === null ? null : (
            <option value={choiceValue('custom')}>{PLAN_COPY.customRolling(rollingLine(custom))}</option>
          )}
        </select>
      </span>
      {choice === 'range' ? (
        <div className="leave-dates">
          {ENDS.map((e) => (
            <DateBox key={e.end} form={form} end={e.end} label={e.label} />
          ))}
        </div>
      ) : w.kind === 'relative' ? (
        <DaysFields form={form} />
      ) : (
        <ResolvedDates form={form} />
      )}
    </fieldset>
  );
}

/** "starts in 7 days, lasts 182 days" or "starts in 14 days, lasts 2 months"; empty for fixed dates. */
function rollingLine(w: DraftWindow): string {
  if (w.kind === 'relative') return PLAN_COPY.rollingLine(w.startOffsetDays, w.lengthDays);
  if (w.kind === 'months') return PLAN_COPY.rollingMonthsLine(w.startOffsetDays, w.lengthMonths);
  return '';
}

/** "Leaving 5 Dec 2026 to 4 Mar 2027 as of today; the dates move forward each day." for a rolling window. */
function ResolvedDates({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  if (
    w.kind !== 'months' ||
    !resolvable(w.startOffsetDays, MAX_WINDOW_DAYS) ||
    !resolvable(w.lengthMonths, MAX_WINDOW_MONTHS)
  )
    return null;
  const r = resolveWindow(w, form.today);
  return (
    <p className="hint max-w-prose">
      {PLAN_COPY.rollingDates(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo))}
    </p>
  );
}

/**
 * A rolling window counted in days (a search saved before the presets): "starts in N days, lasts M days", with the
 * dates it covers today. A number box left blank is a "required" error that blocks estimating and saving (UI-10); it is
 * never coerced to 0.
 */
function DaysFields({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  const { blank, markBlank } = form;
  if (w.kind !== 'relative') return null;
  const resolved =
    resolvable(w.startOffsetDays, MAX_WINDOW_DAYS) && resolvable(w.lengthDays, MAX_WINDOW_DAYS)
      ? resolveWindow(
          { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
          form.today,
        )
      : null;
  return (
    <div className="flex flex-wrap items-end gap-4">
      <NumberField
        id="w-offset"
        label={COPY.startOffsetDays}
        value={blank.includes('w-offset') ? undefined : w.startOffsetDays}
        errors={[
          ...form.errorsFor('window.startOffsetDays'),
          ...(blank.includes('w-offset') ? [COPY.required] : []),
        ]}
        onChange={(v) => {
          markBlank('w-offset', v === undefined);
          if (v !== undefined) form.setDraft({ ...form.draft, window: { ...w, startOffsetDays: v } });
        }}
      />
      <NumberField
        id="w-length"
        label={COPY.lengthDays}
        value={blank.includes('w-length') ? undefined : w.lengthDays}
        errors={[
          ...form.errorsFor('window.lengthDays'),
          ...(blank.includes('w-length') ? [COPY.required] : []),
        ]}
        onChange={(v) => {
          markBlank('w-length', v === undefined);
          if (v !== undefined) form.setDraft({ ...form.draft, window: { ...w, lengthDays: v } });
        }}
      />
      {resolved === null ? null : (
        <p className="hint w-full">
          {PLAN_COPY.rollingResolved(
            PLAN_COPY.rollingLine(w.startOffsetDays, w.lengthDays),
            COPY.resolvedWindow(formatIsoDate(resolved.departureFrom), formatIsoDate(resolved.departureTo)),
          )}
        </p>
      )}
    </div>
  );
}

/** One end of Leave between: the date field, then any field error the API gave for it. */
function DateBox({ form, end, label }: { form: SearchForm; end: DateEnd; label: string }) {
  const id = `w-${end}`;
  const w = form.draft.window;
  const value = w.kind === 'absolute' ? w[end] : '';
  // why: the picker greys out what cannot be chosen: the past (a saved search keeps its own passed first date), and for
  // the latest, anything before the earliest. A date typed past the picker is refused by the form ("before today")
  const from = w.kind === 'absolute' ? w.from : '';
  const floor = end === 'from' && form.savedFrom !== null ? form.savedFrom : form.today;
  const min = end === 'to' && from > floor ? from : floor;
  const messages = form.errorsFor(`window.${end}`);
  const noteId = `${id}-note`;
  return (
    <span className="leave-date flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="date"
        className={dateInput}
        value={value}
        min={min}
        aria-invalid={messages.length > 0}
        aria-describedby={messages.length > 0 ? noteId : undefined}
        onChange={(e) => form.setDate(end, e.target.value)}
      />
      {/* why: fix round 1 finding 9 and follow-up 2 — the note is a polite region kept mounted, empty until the API names
      this field, so its words are announced when they appear and never as an alert */}
      <span id={noteId} aria-live="polite" className="bad-text text-sm">
        {messages.join(' ')}
      </span>
    </span>
  );
}
