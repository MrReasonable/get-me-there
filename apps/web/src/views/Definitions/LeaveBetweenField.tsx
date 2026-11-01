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
 * Spec rev 55 §11 "Leave between" (WP20 Task 20.5; design §4.1): two text fields taking a date as "10 Jan 2027" (also
 * "10 january 2027", "10 Sept 2027", `2027-01-10`; a day and month alone is their next occurrence, echoed beside the
 * field as "10 Jan 2027"). A date typed another way ("10/01/2027") is refused beside its field ("Enter the date as 10
 * Jan 2027": `aria-invalid`, described by a polite note) once the field is left or the press is tried, and no estimate
 * is asked for it meanwhile. While the window rolls (More options) the fields give way to the dates it covers today.
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

/** One end of Leave between: the box, then either its refusal or the date it was read as. */
function DateBox({ form, end, label }: { form: SearchForm; end: DateEnd; label: string }) {
  const id = `w-${end}`;
  const error = form.dateError[end];
  const echo = form.dateEcho[end];
  const apiErrors = form.errorsFor(`window.${end}`);
  const messages = [...(error === null ? [] : [error]), ...apiErrors];
  const noteId = `${id}-note`;
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        className={dateInput}
        placeholder={PLAN_COPY.datePlaceholder}
        value={form.dateText[end]}
        aria-invalid={messages.length > 0}
        aria-describedby={messages.length > 0 || echo !== null ? noteId : undefined}
        onChange={(e) => form.setDateText(end, e.target.value)}
        onBlur={() => form.leaveDate(end)}
      />
      {/* why: fix round 1, finding 9 — the note is polite: it is said once the field is left, never as an alert */}
      {messages.length > 0 ? (
        <span id={noteId} aria-live="polite" className="bad-text text-sm">
          {messages.join(' ')}
        </span>
      ) : echo !== null ? (
        <span id={noteId} className="hint">
          {echo}
        </span>
      ) : null}
    </span>
  );
}
