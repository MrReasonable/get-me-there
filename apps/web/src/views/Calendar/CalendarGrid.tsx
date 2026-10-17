import type { CellKey, Iata, IsoDate, IsoMonth } from '@gmt/core';
import { monthOf } from '@gmt/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { COPY } from '../../copy.js';
import { formatDayOfMonth, formatIsoDateLong, formatIsoMonth, WEEK_HEADERS } from '../../format.js';
import { DayBody, PhoneDayBody } from './DayBodies.js';
import { targetOf, weeksOf } from './grid.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, PRICELESS_CLASS } from './scale.js';
import type { GridDay } from './types.js';
import './calendar.css';

/** Visible focus (spec §11 accessibility); focus-visible keeps it off mouse clicks. Exported for the grid test. */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

export interface CalendarGridProps {
  days: readonly GridDay[];
  model: CalendarModel;
  /** The months to draw: every month of the window, or one at a time at phone width (plan decision 38). */
  months: readonly IsoMonth[];
  destinationNotes: Partial<Record<Iata, string>>;
  /** Phone width: each day shows its compact face, the rest is in the panel (plan decision 52, review ui-r2-001). */
  compact: boolean;
  onOpen(date: IsoDate, cell: CellKey | null): void;
  /** Phone width draws one month: a key that leaves it asks the parent to show the target's month (review ui M7). */
  onMonth?(month: IsoMonth): void;
}

/**
 * View B heatmap: a captioned table of day buttons per month (plan decision 51), roving tabindex; arrows move by a day or a week, Home and End to the ends of
 * the week, PageUp and PageDown by a month; Enter or Space opens the side panel (spec §11 View B, Accessibility).
 */
export function CalendarGrid({
  days,
  model,
  months,
  destinationNotes,
  compact,
  onOpen,
  onMonth,
}: CalendarGridProps) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const shown = new Set(months);
  const [focusDate, setFocusDate] = useState<IsoDate | null>(null);
  const refs = useRef(new Map<IsoDate, HTMLButtonElement>());
  const pending = useRef<IsoDate | null>(null);
  // why: the tab stop is the focused day if it is still drawn, else the first drawn day.
  const firstShown = days.find((d) => shown.has(monthOf(d.date)))?.date ?? null;
  const tabStop =
    focusDate !== null && shown.has(monthOf(focusDate)) && byDate.has(focusDate) ? focusDate : firstShown;

  const open = (date: IsoDate) => {
    const disp = model.displays.get(date);
    onOpen(date, disp?.kind === 'price' ? disp.price.cell : null);
  };
  // why: Enter and Space are the button's own activation (its onClick); the keys below move focus.
  const onKeyDown = (date: IsoDate) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = targetOf(date, e.key);
    if (next === null) return;
    e.preventDefault();
    // why: focus moves only to a drawn day that has data; elsewhere it stays put.
    if (byDate.has(next) && shown.has(monthOf(next))) {
      setFocusDate(next);
      refs.current.get(next)?.focus();
    } else if (byDate.has(next) && onMonth !== undefined) {
      // why: at phone width the target lies in another month: show that month, then focus the day once it is drawn
      pending.current = next;
      setFocusDate(next);
      onMonth(monthOf(next));
    }
  };
  useEffect(() => {
    const date = pending.current;
    if (date !== null && refs.current.has(date)) {
      pending.current = null;
      refs.current.get(date)?.focus();
    }
  });

  return (
    <div className="flex flex-col gap-6">
      {months.map((m) => (
        <table
          key={m}
          className={`w-full table-fixed border-separate ${compact ? 'border-spacing-0.5' : 'border-spacing-1'}`}
        >
          <caption className="text-left font-semibold">{formatIsoMonth(m)}</caption>
          <thead>
            <tr>
              {WEEK_HEADERS.map((w) => (
                <th key={w} scope="col" className="text-xs font-medium">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeksOf(m).map((week) => (
              <tr key={week.find((d) => d !== null) ?? m}>
                {week.map((date, i) => {
                  if (date === null) return <td key={`pad-${m}-${i}`} />;
                  const gd = byDate.get(date);
                  if (gd === undefined) {
                    // why: outside the window or the api's days: only the day number, never a price or a glyph.
                    return (
                      <td key={date} className="align-top text-xs text-slate-500">
                        {formatDayOfMonth(date)}
                      </td>
                    );
                  }
                  const disp = model.displays.get(date);
                  if (disp === undefined) throw new Error(`calendar model has no display for ${date}`);
                  const band = model.bands.get(date);
                  const flat = model.flatDays.has(date);
                  const hatched = disp.kind === 'price' && disp.basis !== model.colourBasis;
                  const fill =
                    band !== undefined
                      ? BAND_CLASSES[band]
                      : flat
                        ? FLAT_CLASS
                        : hatched
                          ? 'day-hatched'
                          : PRICELESS_CLASS;
                  return (
                    <td key={date} className="align-top">
                      <button
                        type="button"
                        data-date={date}
                        data-basis={disp.kind === 'price' ? disp.basis : 'none'}
                        data-band={band ?? (flat ? 'flat' : '')}
                        tabIndex={date === tabStop ? 0 : -1}
                        ref={(el) => {
                          if (el) refs.current.set(date, el);
                          else refs.current.delete(date);
                        }}
                        onKeyDown={onKeyDown(date)}
                        onFocus={() => setFocusDate(date)}
                        onClick={() => {
                          setFocusDate(date);
                          open(date);
                        }}
                        className={`block h-full w-full min-w-0 cursor-pointer overflow-hidden rounded text-left ${compact ? 'p-0.5' : 'p-1'} ${FOCUS_RING} ${fill}`}
                      >
                        <span className="block text-xs font-semibold">
                          <span aria-hidden="true">{formatDayOfMonth(date)}</span>
                          {band !== undefined ? (
                            // why: ui-r2-005 — the band is printed, so adjacent shades never rest on colour alone
                            <span
                              aria-hidden="true"
                              data-band-number
                              className="ml-0.5 align-super text-[10px]"
                            >
                              {band + 1}
                            </span>
                          ) : null}
                          <span className="sr-only">{formatIsoDateLong(date)}</span>
                        </span>
                        {compact ? (
                          <PhoneDayBody display={disp} slice={gd.slice} notes={destinationNotes} />
                        ) : (
                          <DayBody display={disp} slice={gd.slice} notes={destinationNotes} />
                        )}
                        {band !== undefined ? (
                          <span className="sr-only">{COPY.calendarView.bandAria(band)}</span>
                        ) : null}
                        {flat ? <span className="sr-only">{COPY.calendarView.flatAria}</span> : null}
                        {hatched ? <span className="sr-only">{COPY.calendarView.hatchedAria}</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
