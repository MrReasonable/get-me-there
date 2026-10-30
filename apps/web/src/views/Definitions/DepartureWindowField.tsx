import { type IsoDateTime, londonDateOf, resolveWindow } from '@gmt/core';
import type { Dispatch, SetStateAction } from 'react';
import { PLAN_COPY, WINDOW_PRESET_MONTHS } from '../../copy/plan.js';
import { useNow } from '../../now.js';
import { DEFAULT_RELATIVE, type DraftWindow } from './draft.js';
import { FieldErrors } from './fields.js';

/** A preset's rolling length in days: whole days in that many twelfths of a year (6 months → 182, the spec default). */
export const presetDays = (months: number): number => Math.floor((months * 365) / 12);

/** The dates a window covers today; null for a relative window whose numbers are not set yet. */
function datesOf(w: DraftWindow, now: IsoDateTime): { from: string; to: string } | null {
  if (w.kind === 'absolute') return { from: w.from, to: w.to };
  if (w.startOffsetDays < 1 || w.lengthDays < 1) return null;
  const r = resolveWindow(
    { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
    londonDateOf(now),
  );
  return { from: r.departureFrom, to: r.departureTo };
}

const startOf = (w: DraftWindow): number | null => (w.kind === 'relative' ? w.startOffsetDays : null);

const dateInput = 'input min-h-11';

/**
 * "Departing between": two dates and quick choices. A quick choice ("Next 6 months") is the spec §11 relative window
 * (`startOffsetDays`, `lengthDays`), which rolls with today, and the dates then show what it covers today; changing a
 * date fixes the window to absolute dates. The other mode's values are kept, so a quick choice after fixed dates keeps
 * the rolling start (review PFT-08); the rolling numbers themselves are under More options.
 */
export function DepartureWindowField({
  window: w,
  setWindow,
  otherWindow,
  setOtherWindow,
  errorsFor,
  clearBlank,
}: {
  window: DraftWindow;
  setWindow: (w: DraftWindow) => void;
  otherWindow: DraftWindow;
  setOtherWindow: Dispatch<SetStateAction<DraftWindow>>;
  errorsFor: (field: string) => string[];
  /** The rolling numbers' "required" marks, cleared when a quick choice or a date replaces them. */
  clearBlank: () => void;
}) {
  const now = useNow();
  const dates = datesOf(w, now);
  const choose = (months: number) => {
    // why: the rolling start the operator had (now, or before fixing dates) is kept; else the spec default.
    const start = startOf(w) ?? startOf(otherWindow) ?? startOf(DEFAULT_RELATIVE);
    if (start === null) return;
    if (w.kind === 'absolute') setOtherWindow(w);
    clearBlank();
    setWindow({ kind: 'relative', startOffsetDays: start, lengthDays: presetDays(months) });
  };
  const setDate = (end: 'from' | 'to', value: string) => {
    if (w.kind === 'relative') setOtherWindow(w);
    clearBlank();
    const base =
      w.kind === 'absolute' ? w : { kind: 'absolute' as const, from: dates?.from ?? '', to: dates?.to ?? '' };
    setWindow({ ...base, [end]: value });
  };
  const fromErrors = errorsFor('window.from');
  const toErrors = errorsFor('window.to');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="def-group-title">{PLAN_COPY.departing}</legend>
      <fieldset aria-label={PLAN_COPY.presets} className="flex flex-wrap gap-1.5">
        {WINDOW_PRESET_MONTHS.map((m) => {
          const on = w.kind === 'relative' && w.lengthDays === presetDays(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => choose(m)}
              // why: the chosen preset is an inverted flap tile, heavier, with a bar under it (definitions.css), so the
              // choice never rests on colour; aria-pressed says it to a screen reader
              className="seg min-h-11"
            >
              {PLAN_COPY.preset(m)}
            </button>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex flex-col gap-1">
          <label htmlFor="w-from" className="field-label">
            {PLAN_COPY.earliest}
          </label>
          <input
            id="w-from"
            type="date"
            className={dateInput}
            value={dates?.from ?? ''}
            aria-invalid={fromErrors.length > 0}
            aria-describedby={`w-mode${fromErrors.length > 0 ? ' w-from-errors' : ''}`}
            onChange={(e) => setDate('from', e.target.value)}
          />
          <FieldErrors id="w-from-errors" messages={fromErrors} />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor="w-to" className="field-label">
            {PLAN_COPY.latest}
          </label>
          <input
            id="w-to"
            type="date"
            className={dateInput}
            value={dates?.to ?? ''}
            aria-invalid={toErrors.length > 0}
            aria-describedby={`w-mode${toErrors.length > 0 ? ' w-to-errors' : ''}`}
            onChange={(e) => setDate('to', e.target.value)}
          />
          <FieldErrors id="w-to-errors" messages={toErrors} />
        </span>
      </div>
      <p id="w-mode" className="hint max-w-prose">
        {w.kind === 'relative' ? PLAN_COPY.rolling(w.startOffsetDays, w.lengthDays) : PLAN_COPY.fixed}
      </p>
    </fieldset>
  );
}
