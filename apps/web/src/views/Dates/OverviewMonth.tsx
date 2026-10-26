import type { IsoDate, IsoMonth } from '@gmt/core';
import { memo } from 'react';
import { COPY } from '../../copy.js';
import { formatDayOfMonth, formatDayShort, formatIsoMonth, WEEK_HEADERS } from '../../format.js';
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
/** A cell with no current figure: a plain fill, never a band colour, with black ink for its glyphs. */
export const NEUTRAL_CLASS = 'border border-slate-400 bg-white text-black';
/** Spec §11: focus always visible, a solid outline (asserted by class in jsdom; drawn by the browser in the smoke). */
export const CELL_FOCUS =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';
/** A board row's cell (spec §11 Rings): an outline, not colour alone; lit when its row or itself is pointed at. */
export const RING_CLASS = 'shadow-[inset_0_0_0_2px_#000]';
export const LIT_CLASS = 'outline-solid outline-[3px] outline-offset-1 outline-black';

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
      className={`flex min-h-6 min-w-6 flex-1 items-center justify-center overflow-hidden rounded-sm text-[10px] leading-none ${fillOf(c.model)} ${patterns.join(' ')} ${c.ringed ? RING_CLASS : ''} ${lit ? LIT_CLASS : ''} ${CELL_FOCUS}`}
    >
      {c.model.marks.length > 0 ? (
        <span aria-hidden="true" data-testid="cell-glyphs">
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
        <h4 className="font-semibold">{formatIsoMonth(month)}</h4>
        <ol className="space-y-1">
          {[...days.keys()].map((date) => (
            <li key={date} className="flex items-center gap-1">
              <span className="w-16 shrink-0 text-xs">{formatDayShort(date)}</span>
              <span className="flex flex-1 gap-0.5">{strip(date)}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  return (
    <table className="w-full table-fixed border-separate border-spacing-1">
      <caption className="text-left font-semibold">{formatIsoMonth(month)}</caption>
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
        {weeksOf(month).map((week) => (
          <tr key={week.find((d) => d !== null) ?? month}>
            {week.map((date, i) =>
              date === null ? (
                <td key={`pad-${month}-${i}`} />
              ) : (
                <td key={date} className="align-top">
                  <span className="block text-[10px] text-slate-700" aria-hidden="true">
                    {formatDayOfMonth(date)}
                  </span>
                  {days.has(date) ? <span className="flex gap-px">{strip(date)}</span> : null}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
});
