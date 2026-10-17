import { addDays, type CellKey, type Iata, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import {
  formatDayOfMonth,
  formatIsoDateLong,
  formatIsoDateShort,
  formatIsoMonth,
  monthDays,
  WEEK_HEADERS,
  weekdayIndex,
} from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { CoverageCue } from './CoverageCue.js';
import type { DayDisplay, Glyph } from './display.js';
import { coverageOf } from './marker.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, PRICELESS_CLASS } from './scale.js';
import type { DaySlice, GridDay } from './types.js';
import './calendar.css';

/** Visible focus (spec §11 accessibility); focus-visible keeps it off mouse clicks. Exported for the grid test. */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

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

/** Monday-first weeks of one month, null for padding. */
function weeksOf(month: IsoMonth): Array<Array<IsoDate | null>> {
  const dates = monthDays(month);
  const first = dates[0];
  const cells: Array<IsoDate | null> =
    first === undefined ? [] : Array.from({ length: weekdayIndex(first) }, () => null);
  cells.push(...dates);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<IsoDate | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The same day of the month before or after, clamped to that month's length (PageUp / PageDown). */
function sameDayOtherMonth(date: IsoDate, delta: -1 | 1): IsoDate {
  const own = monthDays(monthOf(date));
  const edge = delta === -1 ? own[0] : own[own.length - 1];
  const other = monthDays(monthOf(addDays(edge ?? date, delta)));
  const index = Math.min(own.indexOf(date), other.length - 1);
  return other[index] ?? date;
}

/** The date a navigation key moves focus to, or null for any other key (APG grid pattern). */
export function targetOf(date: IsoDate, key: string): IsoDate | null {
  const step = STEPS[key];
  if (step !== undefined) return addDays(date, step);
  if (key === 'Home') return addDays(date, -weekdayIndex(date));
  if (key === 'End') return addDays(date, 6 - weekdayIndex(date));
  if (key === 'PageUp') return sameDayOtherMonth(date, -1);
  if (key === 'PageDown') return sameDayOtherMonth(date, 1);
  return null;
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

function DayBody(props: { display: DayDisplay; slice: DaySlice; notes: Partial<Record<Iata, string>> }) {
  const { display, slice, notes } = props;
  if (display.kind === 'price') return <DayPriceBlock display={display} slice={slice} notes={notes} />;
  const C = COPY.calendarView;
  return (
    <span className="block text-[11px]">
      <Unconfirmed slice={slice} />
      <GlyphList glyphs={display.glyphs} />
      {display.reason === 'no-run' ? <span className="block">{C.noRunCoversDay}</span> : null}
      {display.reason === 'no-provider' ? <span className="block">{C.noDiscoveryProvider}</span> : null}
      {/* why: ui-r2-003 — a grey day says how much of it was looked at, as a priced day does */}
      {display.reason === 'counts' ? <CoverageCue coverage={coverageOf(slice)} /> : null}
    </span>
  );
}

/**
 * The phone face (plan decision 52, review ui-r2-001): at 375 px a column is about 45 px, so a day shows its number and
 * band, the amount through PriceCell's `face` (marks as single glyphs, words in its title and spoken text) or the
 * glyphs of a priceless day, and one-glyph marks for "price not confirmed" and partial coverage. Stay, provider,
 * "cached from" and the counts are in the panel, one tap away.
 */
function PhoneDayBody(props: { display: DayDisplay; slice: DaySlice; notes: Partial<Record<Iata, string>> }) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const coverage = coverageOf(slice);
  const partial = coverage.kind === 'fraction' && coverage.searched < coverage.total;
  const full =
    display.kind === 'price' && coverage.kind === 'fraction' && coverage.searched === coverage.total;
  const unconfirmed = slice.unconfirmedCells > 0 && slice.cheapestVerified === null;
  const marks = (
    <>
      {unconfirmed ? (
        <span data-testid="day-unconfirmed">
          <span aria-hidden="true">{COPY.priceMarkGlyph.unconfirmed}</span>
          <span className="sr-only">{C.unconfirmedShort}</span>
        </span>
      ) : null}
      {partial ? (
        <span data-coverage="partial">
          <span aria-hidden="true">{C.phoneMark.partial}</span>
          <span className="sr-only">{C.phonePartial}</span>
        </span>
      ) : null}
      {/* why: decision 38 — every priced day carries a visible non-colour coverage cue; fully searched has its own mark */}
      {full ? (
        <span data-coverage="full">
          <span aria-hidden="true">{C.phoneMark.full}</span>
          <span className="sr-only">{C.phoneFull}</span>
        </span>
      ) : null}
    </>
  );
  if (display.kind === 'price') {
    const p = display.price;
    return (
      <span data-testid="day-price-face" className="block min-w-0 text-[11px]">
        <span className="sr-only">
          {display.basis === 'calendar' ? C.calendarPrice : COPY.classLabel.verified}
        </span>
        <PriceBoundary>
          <PriceCell
            face
            {...figureMarks(p)}
            pricePence={p.pricePence}
            provenance={p.provenance}
            calendar={display.basis === 'calendar'}
            stale={display.stale}
            truncated={p.truncated}
            destination={p.cell.destination}
            destinationNote={notes[p.cell.destination] ?? null}
          />
        </PriceBoundary>
        {/* why: the stay's night count is on the face (decision 38); the dates are in the panel */}
        <span data-testid="day-nights" className="block">
          {C.phoneNights(p.cell.nights)} {marks}
        </span>
      </span>
    );
  }
  return (
    <span className="block min-w-0 text-[11px]">
      {display.glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          <span aria-hidden="true" className="font-bold">
            {C.glyphSymbol[g.status]}
          </span>
          <span className="sr-only">{glyphWords(g)}</span>
        </span>
      ))}
      {display.reason === 'no-provider' ? <span className="sr-only">{C.noDiscoveryProvider}</span> : null}
      <span className="block">{marks}</span>
    </span>
  );
}

/**
 * The day's price in WP9's PriceCell compact form (decisions 36, 38, 46): the amount with "≈", a short provider badge,
 * the destination code and the stale, truncated and unconfirmed marks, with source, age and note in its title; then
 * the stay, any cheaper cached fare with its own destination and stay (decision 52) and the coverage cue. Everything
 * else is in the side panel. A price without provenance is withheld (spec §9 item 6).
 */
function DayPriceBlock(props: {
  display: Extract<DayDisplay, { kind: 'price' }>;
  slice: DaySlice;
  notes: Partial<Record<Iata, string>>;
}) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const p = display.price;
  const isCalendar = display.basis === 'calendar';
  const cached = display.cheaperCached;
  return (
    <span data-testid="day-price-block" className="flex flex-col gap-0.5 text-xs">
      <span className="sr-only">{isCalendar ? C.calendarPrice : COPY.classLabel.verified}</span>
      <Unconfirmed slice={slice} />
      <PriceBoundary>
        <PriceCell
          compact
          {...figureMarks(p)}
          pricePence={p.pricePence}
          provenance={p.provenance}
          calendar={isCalendar}
          stale={display.stale}
          truncated={p.truncated}
          destination={p.cell.destination}
          destinationNote={notes[p.cell.destination] ?? null}
        />
      </PriceBoundary>
      <span data-testid="day-stay" className="block text-[11px]">
        {C.stay(p.cell.nights, formatIsoDateShort(p.cell.returnDate))}
      </span>
      {cached !== null ? (
        <span data-testid="cached-from" className="block text-[11px]">
          <span>{C.cachedFrom}</span>
          <PriceBoundary>
            <PriceCell
              compact
              {...figureMarks(cached)}
              pricePence={cached.pricePence}
              provenance={cached.provenance}
              calendar
              stale={cached.stale}
              truncated={cached.truncated}
              destination={cached.cell.destination}
              destinationNote={notes[cached.cell.destination] ?? null}
            />
          </PriceBoundary>
          <span className="block">
            {C.stay(cached.cell.nights, formatIsoDateShort(cached.cell.returnDate))}
          </span>
        </span>
      ) : null}
      <CoverageCue coverage={coverageOf(slice)} />
    </span>
  );
}

/**
 * Decision 48: a day whose itinerary search priced cells but confirmed no price says "price not confirmed", so it never
 * reads as "nothing found" or as a confirmed fare. Only when the day shows no class-verified price; under a filter the
 * api counts that destination's cells only (decisions 51, 53; review prov-r2-004).
 */
function Unconfirmed({ slice }: { slice: DaySlice }) {
  if (slice.unconfirmedCells === 0 || slice.cheapestVerified !== null) return null;
  return (
    <span data-testid="day-unconfirmed" className="block text-[11px] font-semibold">
      {COPY.calendarView.unconfirmedShort}
    </span>
  );
}

/** "47 not searched": the glyph's words with its count when one is known. */
function glyphWords(g: Glyph): string {
  return g.count === null
    ? COPY.bucket[g.status]
    : COPY.calendarView.glyphCount(g.count, COPY.bucket[g.status]);
}

function GlyphList({ glyphs }: { glyphs: readonly Glyph[] }) {
  if (glyphs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          <span aria-hidden="true" className="font-bold">
            {COPY.calendarView.glyphSymbol[g.status]}
          </span>{' '}
          {glyphWords(g)}
        </span>
      ))}
    </span>
  );
}
