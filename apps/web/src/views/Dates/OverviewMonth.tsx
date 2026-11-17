import type { IsoDate, IsoMonth } from '@gmt/core';
import { memo } from 'react';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayOfMonth, formatIsoMonth, WEEK_HEADERS } from '../../format.js';
import { type DayModel, type Heat, weeksOf } from './overview.js';
import './dates.css';

const C = COPY.calendar;

/** A day of the window as the calendar draws it: its model, its name and its step on the heat ramp. */
export interface DayView {
  date: IsoDate;
  model: DayModel;
  /** Its accessible name (`dayName`). */
  name: string;
  /** The printed price's step, or null when it prints none. */
  heat: Heat | null;
}

export interface CalendarMonthProps {
  month: IsoMonth;
  /** The days of this month that are buttons (in the window, not departed), by date. */
  days: ReadonlyMap<IsoDate, DayView>;
  /** The roving tab stop's day when it is in this month, else null. */
  tabStop: IsoDate | null;
  /** The open day when it is in this month, else null, and the panel it opens. */
  open: IsoDate | null;
  panelId: string;
}

/** What a day prints: its price inside a PriceCell (the name carries its label), "no price", the cross, or nothing. */
function Printed({ m }: { m: DayModel }) {
  const p = m.price;
  if (p !== null)
    return (
      <PriceBoundary>
        <PriceCell
          bare
          pricePence={p.cell.pricePence}
          provenance={p.cell.provenance}
          calendar={!p.trip}
          stale={p.cell.stale}
          truncated={p.cell.truncated}
        />
      </PriceBoundary>
    );
  if (m.notSeenOnly) return null;
  if (m.mark === 'no-price-shown') return <>{C.noPrice}</>;
  if (m.mark === 'couldnt-read') return <>{C.couldntReadGlyph}</>;
  return null;
}

function Day({
  d,
  tabStop,
  open,
  panelId,
}: {
  d: DayView;
  tabStop: boolean;
  open: boolean;
  panelId: string;
}) {
  const m = d.model;
  const p = m.price;
  return (
    <button
      type="button"
      className="cal-day"
      data-day={d.date}
      data-mark={m.mark}
      data-heat={d.heat ?? undefined}
      data-trip={p?.trip === true ? '' : undefined}
      data-stale={p !== null && p.cell.stale !== false ? '' : undefined}
      tabIndex={tabStop ? 0 : -1}
      aria-label={d.name}
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
    >
      <span className="cal-dn" aria-hidden="true">
        {formatDayOfMonth(d.date)}
      </span>
      {p?.trip === true ? (
        <span className="cal-dot" aria-hidden="true">
          {C.tripGlyph}
        </span>
      ) : null}
      <span className="cal-dp" aria-hidden="true">
        <Printed m={m} />
      </span>
    </button>
  );
}

/**
 * One month of the calendar (Ruling 18, mockup 02): a table captioned by the month's name, Monday first, a day of the
 * window a button printing its price (or why it prints none), any other day its number alone, blank and inert.
 * Memoised: focus moving elsewhere does not redraw the month.
 */
export const CalendarMonth = memo(function CalendarMonth({
  month,
  days,
  tabStop,
  open,
  panelId,
}: CalendarMonthProps) {
  return (
    <table className="cal-month">
      <caption className="cal-month-name">{formatIsoMonth(month)}</caption>
      <thead>
        <tr>
          {WEEK_HEADERS.map((w) => (
            <th key={w} scope="col" className="cal-dow">
              {w}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeksOf(month).map((week) => (
          <tr key={week.find((x) => x !== null) ?? month}>
            {week.map((date, i) => {
              if (date === null) return <td key={`pad-${month}-${i}`} />;
              const d = days.get(date);
              return (
                <td key={date}>
                  {d === undefined ? (
                    <span className="cal-day cal-out" aria-hidden="true">
                      {formatDayOfMonth(date)}
                    </span>
                  ) : (
                    <Day d={d} tabStop={date === tabStop} open={date === open} panelId={panelId} />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
});
