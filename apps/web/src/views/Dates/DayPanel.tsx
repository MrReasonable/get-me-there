import type { DatePair, DecodedDatePairs, IsoDate } from '@gmt/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { CalendarRow } from '../../components/rows/CalendarRow.js';
import { TripRow } from '../../components/rows/TripRow.js';
import { COPY } from '../../copy.js';
import { verifiedDetailOf } from '../../lib/bookingTarget.js';
import { hoursText, pairKey } from '../../lib/flightLines.js';
import type { BoardFlights } from '../../lib/flightReads.js';
import { rowDay } from '../../lib/legWords.js';
import { stayMark } from './overview.js';

const C = COPY.calendar;
const S = COPY.searchesView;
/** Ruling 18: the panel lists a day's first five stays, then "Show N more stays". */
export const DAY_FIRST = 5;

export interface DayPanelProps {
  /** The region's id, which the open day's button names (`aria-controls`). */
  id: string;
  date: IsoDate;
  /** The day's stays in view, in the panel's order (`panelOrder`). */
  stays: readonly DatePair[];
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  /** The page's flight lists and read on demand (`usePageFlights`): a calendar row offers Read flights where it can. */
  flights: BoardFlights;
  /** A search is running: an earlier search's trip says the running one will replace it (Review Focus 2). */
  runActive: boolean;
  /** The journey limit in minutes the "over the limit" row names, or null. */
  limit: number | null;
  /** Escape or Close: the page closes the panel and puts focus back on the day. */
  onClose: () => void;
}

/**
 * Ruling 18 (mockup 02's day panel): a labelled region below the calendar, "Wed 11 Nov: 12 stays", whose heading takes
 * focus and scrolls into view when it opens. It lists the day's stays: a trip (and a verified price the latest search
 * did not see again, "Not seen again", linked nowhere) as a trip row, a calendar price as a calendar row with Read
 * flights where a read would go now, and a stay with no price as a calendar row saying why (no price, couldn't read, not
 * reached, not searched, over the limit); five, then "Show 7 more stays". Escape (when no label's detail is open) or
 * Close closes it. The page keys it by its day, so another day opens a panel of its own.
 */
export function DayPanel({
  id,
  date,
  stays,
  definition,
  data,
  flights,
  runActive,
  limit,
  onClose,
}: DayPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const h = heading.current;
    if (h === null) return;
    h.focus();
    h.scrollIntoView({ block: 'nearest' });
  }, []);
  const shown = all ? stays : stays.slice(0, DAY_FIRST);
  const more = stays.length - shown.length;
  const search = {
    id: definition.id,
    cabin: definition.cabin,
    multiAirport: definition.origins.length > 1 || definition.destinations.length > 1,
    pointOfSale: data.pointOfSale,
    destinationNotes: definition.destinationNotes,
  };
  const available = flights.meta?.available === true;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // why: an open label's detail takes Escape first (PriceLabel closes it); the panel closes on the next one
    if (e.key !== 'Escape' || e.currentTarget.querySelector('details[open]') !== null) return;
    e.preventDefault();
    onClose();
  };
  return (
    <section
      id={id}
      className="cal-panel"
      aria-labelledby={`${id}-h`}
      data-testid="day-panel"
      onKeyDown={onKeyDown}
    >
      <div className="cal-panel-head">
        <h3 id={`${id}-h`} ref={heading} tabIndex={-1} className="cal-panel-title">
          {C.panelHeading(rowDay(date), stays.length)}
        </h3>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          {C.close}
        </button>
      </div>
      <ul className="search-rows" aria-labelledby={`${id}-h`}>
        {shown.map((p) => {
          const f = p.figure;
          if (f !== null && f.basis !== 'calendar')
            return (
              <TripRow
                key={p.index}
                figure={f}
                details={verifiedDetailOf(data.verifiedDetails, p, f)}
                search={{ ...search, showCarriers: true }}
                pair={p}
                earlierNote={
                  f.fromEarlierSearch ? (runActive ? S.previousSearchReplaced : S.previousSearchDetail) : null
                }
              />
            );
          const key = pairKey(p);
          const onRead = available && flights.byKey.get(key)?.readNow === true ? flights.read : null;
          const reading = flights.readingKey === null ? null : flights.readingKey === key ? 'this' : 'other';
          if (f !== null)
            return (
              <CalendarRow
                key={p.index}
                figure={f}
                search={search}
                pair={p}
                onRead={onRead}
                reading={reading}
              />
            );
          const mark = stayMark(p);
          return (
            <CalendarRow
              key={p.index}
              figure={null}
              empty={{
                name: C.stayName[mark],
                line:
                  mark === 'over-limit'
                    ? C.stayLine[mark](limit === null ? null : hoursText(limit))
                    : C.stayLine[mark],
              }}
              search={search}
              pair={p}
              onRead={onRead}
              reading={reading}
            />
          );
        })}
      </ul>
      {more > 0 ? (
        <div className="search-card-foot">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setAll(true);
              // why: the button goes with the press; focus stays in the panel, on its heading
              heading.current?.focus();
            }}
          >
            {C.showMore(more)}
          </button>
        </div>
      ) : null}
    </section>
  );
}
