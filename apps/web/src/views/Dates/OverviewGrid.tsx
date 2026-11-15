import {
  asIsoDate,
  type DatePair,
  type DecodedDatePairs,
  type IsoDate,
  type IsoMonth,
  monthOf,
} from '@gmt/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import type { BoardFlights } from '../../lib/flightReads.js';
import { PHONE_QUERY } from '../../lib/media.js';
import { CalendarKey } from './CalendarKey.js';
import { DayPanel } from './DayPanel.js';
import { targetOf } from './keys.js';
import { CalendarMonth, type DayView } from './OverviewMonth.js';
import { type DayModel, dayModel, dayName, dayScale, heatOf, monthsOf, panelOrder } from './overview.js';

const C = COPY.calendar;
/** Ruling 18: a sideways swipe of at least this many pixels turns the month at 375 px. */
export const SWIPE_PX = 50;

export interface CalendarProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  /** Each departure day's stays in view (`staysByDay` of the page's model), in date order. */
  byDay: ReadonlyMap<IsoDate, readonly DatePair[]>;
  /** The stays in view, which the lead names, or null when none is. */
  stay: { min: number; max: number } | null;
  /** Today's date: a day before it has departed and is blank. */
  today: IsoDate;
  /** The day whose panel is open, or null; the page owns it, so its flight lists are asked with the page's. */
  openDay: IsoDate | null;
  onOpenDay: (day: IsoDate | null) => void;
  /** The page's flight lists and read on demand (`usePageFlights`). */
  flights: BoardFlights;
  runActive: boolean;
  /** The journey limit in minutes, for the day panel's "over the limit" rows. */
  limit: number | null;
}

/** The day a button names, from an event's target inside the months, or null. */
function dayOf(target: EventTarget | null): IsoDate | null {
  const day =
    target instanceof Element ? target.closest<HTMLElement>('button[data-day]')?.dataset.day : undefined;
  return day === undefined ? null : asIsoDate(day);
}

/**
 * Ruling 18 (mockup 02's Calendar): the window's months (every month side by side on a desktop; one at a time at phone
 * width, with Previous and Next month beside a swipe), each day of the window a button that prints its one price on the
 * heat ramp, a dot on a trip's (core's `isTrip`), or why it prints none; departed days and days outside the window
 * blank and inert. One tab stop (roving tabindex): the arrow keys move a day or a week, Page Up and Down a month, Home
 * and End the week's ends. Enter or a click opens the day panel below the key; Escape or Close puts focus back on the day.
 */
export function Calendar({
  definition,
  data,
  byDay,
  stay,
  today,
  openDay,
  onOpenDay,
  flights,
  runActive,
  limit,
}: CalendarProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const id = useId();
  const panelId = `${id}-day`;
  const root = useRef<HTMLDivElement>(null);
  const months = useMemo(() => monthsOf(data.space), [data.space]);
  const [monthIndex, setMonthIndex] = useState(0);
  const [focusDay, setFocusDay] = useState<IsoDate | null>(null);
  const pendingFocus = useRef<IsoDate | null>(null);
  const swipeFrom = useRef<number | null>(null);

  // why: every day is modelled once per read or filter, never on a focus or a key (WP19 §6's bounds)
  const grid = useMemo(() => {
    const models = new Map<IsoDate, DayModel>();
    for (const [date, stays] of byDay) {
      const m = dayModel({ date, today }, stays);
      if (m.mark !== 'out') models.set(date, m);
    }
    const scale = dayScale(models.values());
    const byMonth = new Map<IsoMonth, Map<IsoDate, DayView>>();
    for (const [date, model] of models) {
      const month = monthOf(date);
      let days = byMonth.get(month);
      if (days === undefined) {
        days = new Map();
        byMonth.set(month, days);
      }
      const heat = model.price === null ? null : heatOf(scale, model.price.cell.pricePence);
      days.set(date, { date, model, name: dayName(date, model), heat });
    }
    return { models, byMonth };
  }, [byDay, today]);

  const shownMonths = phone ? months.slice(monthIndex, monthIndex + 1) : months;
  const shown = (d: IsoDate | null): d is IsoDate =>
    d !== null && grid.models.has(d) && shownMonths.includes(monthOf(d));
  const firstShown = shownMonths
    .map((m) => grid.byMonth.get(m)?.keys().next().value)
    .find((d) => d !== undefined);
  const tabStop = shown(focusDay) ? focusDay : shown(openDay) ? openDay : (firstShown ?? null);

  const showMonthOf = (d: IsoDate) => {
    const i = months.indexOf(monthOf(d));
    if (phone && i >= 0) setMonthIndex(i);
  };
  const focusOn = (d: IsoDate) => {
    const el = root.current?.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`);
    if (el) el.focus();
    else pendingFocus.current = d;
  };
  useEffect(() => {
    const d = pendingFocus.current;
    if (d === null) return;
    const el = root.current?.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  const close = () => {
    const day = openDay;
    onOpenDay(null);
    if (day === null) return;
    setFocusDay(day);
    showMonthOf(day);
    focusOn(day);
  };
  const turn = (d: 1 | -1) => setMonthIndex((i) => Math.min(months.length - 1, Math.max(0, i + d)));
  // why: one set of native listeners for every day (delegation, as the board's overview had), each day a real button,
  // so Enter and Space click it; the listeners read the latest render's handlers through a ref
  const handlers = useRef({
    key: (_e: KeyboardEvent) => {},
    click: (_e: MouseEvent) => {},
    focus: (_e: FocusEvent) => {},
    down: (_e: PointerEvent) => {},
    up: (_e: PointerEvent) => {},
  });
  handlers.current = {
    key: (e) => {
      const day = dayOf(e.target);
      const next = day === null ? null : targetOf(day, e.key);
      if (next === null) return;
      e.preventDefault();
      // why: a key that leaves the window (or reaches a departed day) leaves focus where it is
      if (!grid.models.has(next)) return;
      setFocusDay(next);
      showMonthOf(next);
      focusOn(next);
    },
    click: (e) => {
      const day = dayOf(e.target);
      if (day === null) return;
      setFocusDay(day);
      // why: the open day's button is a disclosure: a second press closes its panel
      onOpenDay(day === openDay ? null : day);
    },
    focus: (e) => {
      const day = dayOf(e.target);
      if (day !== null) setFocusDay(day);
    },
    down: (e) => {
      swipeFrom.current = e.clientX;
    },
    up: (e) => {
      const from = swipeFrom.current;
      swipeFrom.current = null;
      if (from === null || !phone) return;
      const dx = e.clientX - from;
      if (Math.abs(dx) >= SWIPE_PX) turn(dx < 0 ? 1 : -1);
    },
  };
  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    const key = (e: KeyboardEvent) => handlers.current.key(e);
    const click = (e: MouseEvent) => handlers.current.click(e);
    const focus = (e: FocusEvent) => handlers.current.focus(e);
    const down = (e: PointerEvent) => handlers.current.down(e);
    const up = (e: PointerEvent) => handlers.current.up(e);
    el.addEventListener('keydown', key);
    el.addEventListener('click', click);
    el.addEventListener('focusin', focus);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => {
      el.removeEventListener('keydown', key);
      el.removeEventListener('click', click);
      el.removeEventListener('focusin', focus);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
    };
  }, []);

  const open = openDay === null ? undefined : grid.models.get(openDay);
  const stays = useMemo(() => (open === undefined ? [] : panelOrder(open.stays)), [open]);
  return (
    <section className="search-section cal-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="search-section-title">
        {C.heading}
      </h2>
      {stay === null ? null : <p className="search-section-sub">{C.lead(stay.min, stay.max)}</p>}
      <div className="search-card cal-card">
        {phone ? (
          <nav aria-label={C.monthsLabel} className="cal-turn">
            <button type="button" className="btn btn-sm" disabled={monthIndex === 0} onClick={() => turn(-1)}>
              {C.previousMonth}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={monthIndex >= months.length - 1}
              onClick={() => turn(1)}
            >
              {C.nextMonth}
            </button>
          </nav>
        ) : null}
        <div ref={root} className="cal-months" data-testid="calendar-months">
          {shownMonths.map((m) => (
            <CalendarMonth
              key={m}
              month={m}
              days={grid.byMonth.get(m) ?? NO_DAYS}
              tabStop={tabStop !== null && monthOf(tabStop) === m ? tabStop : null}
              open={openDay !== null && monthOf(openDay) === m ? openDay : null}
              panelId={panelId}
            />
          ))}
        </div>
        <CalendarKey />
        {openDay !== null && open !== undefined ? (
          <DayPanel
            key={openDay}
            id={panelId}
            date={openDay}
            stays={stays}
            definition={definition}
            data={data}
            flights={flights}
            runActive={runActive}
            limit={limit}
            onClose={close}
          />
        ) : null}
      </div>
    </section>
  );
}

const NO_DAYS: ReadonlyMap<IsoDate, DayView> = new Map();
