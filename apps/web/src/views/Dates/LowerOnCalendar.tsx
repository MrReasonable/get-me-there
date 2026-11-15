import { type DecodedDatePairs, flightLimitsOf } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { CalendarRow } from '../../components/rows/CalendarRow.js';
import { COPY } from '../../copy.js';
import { unavailableWords, useBoardFlights } from '../../lib/flightReads.js';
import { type FigurePair, LOWER_SHOWN } from './board.js';
import { pairKey } from './flightLines.js';

const P = COPY.searchPage;

/** The calendar's region id: "See all on the calendar" lands there (Task 9 keeps it on the new calendar). */
export const CALENDAR_ID = 'calendar';

export interface LowerOnCalendarProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  /** Every calendar price lower than the cheapest trip, by price (`boardModel`'s, Ruling 5). */
  lower: readonly FigurePair[];
  /** The page has a trip, so these are "lower" than it; without one they are the lowest calendar prices. */
  hasTrip: boolean;
}

/**
 * Design 2026-11-08 §5.2 (mockup 02), Rulings 5 and 20: the calendar prices below the cheapest trip whose flights were not
 * read, cheapest first: three as shared calendar rows, each saying what is known of its flights (`readStateWords`) with
 * "Read flights" where a read would go now (the flight lists' `readNow`), the count of them all, and "See all on the
 * calendar". A pressed read is said in a polite status (its refusal in words, or that it ended); when it lands the page
 * reads its dates again, so the date leaves this list and shows as a trip (the status stays, should it take the last
 * one). Where flight lists cannot be read here one line says why, and no row offers a read.
 */
export function LowerOnCalendar({ definition, data, lower, hasTrip }: LowerOnCalendarProps) {
  const id = useId();
  const qc = useQueryClient();
  const rows = lower.slice(0, LOWER_SHOWN);
  const keys = rows.map(pairKey).join(',');
  const pages = useMemo(() => (keys === '' ? [] : [keys.split(',')]), [keys]);
  const limits = useMemo(() => flightLimitsOf(definition.constraints), [definition.constraints]);
  // why: a landed read made the date a trip on the server; the page's read says so once read again
  const onLanded = useCallback(
    () => void qc.invalidateQueries({ queryKey: ['date-pairs', definition.id] }),
    [qc, definition.id],
  );
  const flights = useBoardFlights(definition.id, pages, limits, onLanded);
  const said = (
    <p role="status" className="search-section-sub" data-testid="read-said">
      {flights.said?.words ?? ''}
    </p>
  );
  // why: a read that lands may take the last lower date away; its words stay said where the section was
  if (rows.length === 0) return said;
  const search = {
    id: definition.id,
    cabin: definition.cabin,
    multiAirport: definition.origins.length > 1 || definition.destinations.length > 1,
    pointOfSale: data.pointOfSale,
    destinationNotes: definition.destinationNotes,
  };
  const available = flights.meta?.available === true;
  return (
    <section className="search-section" aria-labelledby={`${id}-h`} data-testid="lower-on-calendar">
      <h2 id={`${id}-h`} className="search-section-title">
        {P.lowerHeading}
      </h2>
      <p className="search-section-sub">
        {hasTrip ? P.lowerLead : P.lowerLeadNoTrip} {P.inAll(lower.length)}
      </p>
      <div className="search-card">
        <ul className="search-rows" aria-labelledby={`${id}-h`}>
          {rows.map((p) => {
            const key = pairKey(p);
            const readNow = available && flights.byKey.get(key)?.readNow === true;
            const reading =
              flights.readingKey === null ? null : flights.readingKey === key ? 'this' : 'other';
            return (
              <CalendarRow
                key={`${p.index}|${p.figure.origin}|${p.figure.destination}`}
                figure={p.figure}
                search={search}
                pair={p}
                onRead={readNow ? flights.read : null}
                reading={reading}
              />
            );
          })}
        </ul>
        <div className="search-card-foot">
          <a className="btn btn-sm" href={`#${CALENDAR_ID}`}>
            {P.seeAll}
          </a>
        </div>
      </div>
      {flights.meta !== null && !available ? (
        <p className="search-section-sub" data-testid="flights-unavailable">
          {unavailableWords(flights.meta.unavailableReason)}
        </p>
      ) : null}
      {said}
    </section>
  );
}
