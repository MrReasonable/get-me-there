import { resolveWindow } from '@gmt/core';
import { PLAN_COPY } from '../../copy/plan.js';
import { formatIsoDate } from '../../format.js';
import type { DateEnd, SearchForm } from './useSearchForm.js';

const dateInput = 'input min-h-11 w-40';
/** The two ends of Leave between, first then last, with their labels. */
const ENDS: ReadonlyArray<{ end: DateEnd; label: string }> = [
  { end: 'from', label: PLAN_COPY.earliest },
  { end: 'to', label: PLAN_COPY.latest },
];

/**
 * Spec rev 67 §11 "Leave between": two browser date fields, so the operator picks each date from a calendar (the
 * phone's own date wheel) and it is shown in the browser's own date format. The earliest cannot be picked before
 * today, nor the latest before the earliest. While the window rolls (More options) the fields give way to the dates
 * it covers today.
 */
export function LeaveBetweenField({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  if (w.kind === 'relative') {
    const r =
      w.startOffsetDays >= 1 && w.lengthDays >= 1
        ? resolveWindow(
            { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
            form.today,
          )
        : null;
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="def-group-title">{PLAN_COPY.leaveBetween}</legend>
        {r === null ? null : (
          <p className="hint max-w-prose">
            {PLAN_COPY.rollingDates(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo))}
          </p>
        )}
      </fieldset>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="def-group-title">{PLAN_COPY.leaveBetween}</legend>
      <div className="flex flex-wrap items-start gap-3">
        {ENDS.map((e) => (
          <DateBox key={e.end} form={form} end={e.end} label={e.label} />
        ))}
      </div>
    </fieldset>
  );
}

/** One end of Leave between: the date field, then any field error the API gave for it. */
function DateBox({ form, end, label }: { form: SearchForm; end: DateEnd; label: string }) {
  const id = `w-${end}`;
  const w = form.draft.window;
  const value = w.kind === 'absolute' ? w[end] : '';
  // why: the picker greys out what cannot be chosen: the past, and for the latest, anything before the earliest
  const from = w.kind === 'absolute' ? w.from : '';
  const min = end === 'to' && from > form.today ? from : form.today;
  const messages = form.errorsFor(`window.${end}`);
  const noteId = `${id}-note`;
  return (
    <span className="flex flex-col gap-1">
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
