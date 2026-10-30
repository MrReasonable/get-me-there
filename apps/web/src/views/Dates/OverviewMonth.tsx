import type { IsoDate, IsoMonth } from '@gmt/core';
import { memo } from 'react';
import { COPY } from '../../copy.js';
import { formatDayOfMonth, formatIsoMonth, formatWeekday, WEEK_HEADERS, weekdayIndex } from '../../format.js';
import { type CellModel, type Column, type Mark, weeksOf } from './overview.js';
import { BAND_CLASSES, FLAT_CLASS } from './shade.js';
import './dates.css';

const M = COPY.datesView.marks;

/**
 * Each mark's pattern beside its glyph (spec §11: no mark by colour alone). Only "partly not searched" is a pattern
 * (stripes in the cell's own text colour, so it keeps the text's contrast on every shade); every mark has its glyph.
 */
export const MARK_CLASS: Readonly<Record<Mark, string>> = {
  empty: '',
  no_data: '',
  error: '',
  skipped: '',
  not_run: '',
  partly: 'dates-partly',
  notChecked: '',
  superseded: '',
  notSeen: '',
  noneWithin: '',
  unshown: '',
};
/** A cell with no current figure: an unlit socket, never a band colour, with the board's white ink for its glyphs. */
export const NEUTRAL_CLASS = 'lamp-none bg-[#2a2d30] text-[#f1f1ec]';
/** Spec §11: focus always visible, a solid outline (asserted by class in jsdom; drawn by the browser in the smoke). */
export const CELL_FOCUS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
/**
 * A board row's cell (spec §11 Rings): an outline, not colour alone; lit when its row or itself is pointed at. why: two
 * tones, a 2 px black line over a 3 px white one (so 1 px of white shows inside the black), so one tone clears 3:1 on
 * every band: black alone is about 2.2:1 on band 0's #134e4a, white is about 9.5:1 there (priceCellBands.test.tsx).
 */
export const RING_CLASS = 'shadow-[inset_0_0_0_2px_#000,inset_0_0_0_3px_#fff]';
export const LIT_CLASS = 'outline-solid outline-[3px] outline-offset-1 outline-[#ffb22e]';

export interface CellView {
  key: string;
  date: IsoDate;
  column: Column;
  model: CellModel;
  /** The accessible name: dates, nights and rank or marks in words. */
  name: string;
  ringed: boolean;
}

export interface OverviewMonthProps {
  month: IsoMonth;
  /** The drawn days of this month, each with its strip of cells. */
  days: ReadonlyMap<IsoDate, readonly CellView[]>;
  /** The roving tab stop's key when it is in this month, else null. */
  tabStop: string | null;
  /** The lit cell's key when it is in this month, else null. */
  lit: string | null;
  readoutId: string;
  phone: boolean;
}

/** Saturday and Sunday read brighter in the day column, as a concourse board marks them. */
const weekend = (d: IsoDate) => {
  // why: Monday-first, so Saturday is 5 and Sunday 6
  return weekdayIndex(d) >= 5;
};

function fillOf(m: CellModel): string {
  if (m.shade === null) return NEUTRAL_CLASS;
  return m.shade === 'flat' ? FLAT_CLASS : BAND_CLASSES[m.shade];
}

function Cell({
  c,
  tabStop,
  lit,
  readoutId,
}: {
  c: CellView;
  tabStop: boolean;
  lit: boolean;
  readoutId: string;
}) {
  const patterns = c.model.marks.map((m) => MARK_CLASS[m]).filter((x) => x !== '');
  return (
    <button
      type="button"
      data-cell={c.key}
      data-date={c.date}
      data-from={c.column.from}
      data-band={c.column.to > c.column.from ? `${c.column.from}-${c.column.to}` : undefined}
      data-shade={c.model.shade ?? 'none'}
      data-marks={c.model.marks.join(' ')}
      data-ringed={c.ringed ? '' : undefined}
      data-lit={lit ? '' : undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-label={c.name}
      aria-describedby={readoutId}
      className={`lamp ${fillOf(c.model)} ${patterns.join(' ')} ${c.ringed ? RING_CLASS : ''} ${lit ? LIT_CLASS : ''} ${CELL_FOCUS}`}
    >
      {c.model.marks.length > 0 ? (
        <span aria-hidden="true" data-testid="cell-glyphs" className="dates-glyphs">
          {c.model.marks.map((m) => M.glyph[m]).join('')}
        </span>
      ) : null}
    </button>
  );
}

/**
 * One month of the overview (spec §11 Overview): desktop, a table captioned by the month's name, weeks as rows, each
 * day cell holding its strip of stay-length (or band) cells; phone, one day a row with its strip across the width.
 * A cell prints no amount. Memoised: a hover or a focus elsewhere does not redraw this month.
 */
export const OverviewMonth = memo(function OverviewMonth({
  month,
  days,
  tabStop,
  lit,
  readoutId,
  phone,
}: OverviewMonthProps) {
  const strip = (date: IsoDate) =>
    (days.get(date) ?? []).map((c) => (
      <Cell key={c.key} c={c} tabStop={c.key === tabStop} lit={c.key === lit} readoutId={readoutId} />
    ));
  if (phone) {
    return (
      <section aria-label={formatIsoMonth(month)} className="space-y-1">
        <h4 className="h-sub">{formatIsoMonth(month)}</h4>
        <ol className="space-y-px">
          {[...days.keys()].map((date) => (
            // why: WP19 Task 19.9 (the 375 px smoke): twelve 24 px cells and their 1 px gaps take 299 px of the 343 px
            // inside the page's gutters, so the day's label is its weekday and number (the month is the heading above)
            <li key={date} className={`flex items-center gap-0.5 ${weekend(date) ? 'ov-weekend' : ''}`}>
              <span className="ov-day w-10 shrink-0">
                {`${formatWeekday(date)} ${formatDayOfMonth(date)}`}
              </span>
              <span className="lamp-strip flex flex-1 gap-px">{strip(date)}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    // why: WP19 Task 19.9: a month off screen skips style, layout and paint (dates.css), so a read or a filter change
    // over 400 days lays out the months in view, not every cell of the window
    <div className="dates-month">
      <table className="ov-table w-full table-fixed border-separate border-spacing-1">
        <caption className="h-sub pb-1 text-left">{formatIsoMonth(month)}</caption>
        <thead>
          <tr>
            {WEEK_HEADERS.map((w) => (
              <th key={w} scope="col" className="label-caps text-xs">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(month).map((week) => (
            <tr key={week.find((d) => d !== null) ?? month}>
              {week.map((date, i) =>
                date === null ? (
                  <td key={`pad-${month}-${i}`} />
                ) : (
                  <td key={date} className="align-top">
                    <span className="ov-day block pb-0.5" aria-hidden="true">
                      {formatDayOfMonth(date)}
                    </span>
                    {days.has(date) ? <span className="lamp-strip flex gap-px">{strip(date)}</span> : null}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
