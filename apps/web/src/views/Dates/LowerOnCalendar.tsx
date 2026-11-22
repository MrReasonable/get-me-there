import { type DatePair, type DecodedDatePairs, flightLimitsOf, MAX_FLIGHT_LIST_PAIRS } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useId, useMemo } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { CalendarRow } from '../../components/rows/CalendarRow.js';
import { COPY } from '../../copy.js';
import { pairKey } from '../../lib/flightLines.js';
import { type BoardFlights, unavailableWords, useBoardFlights } from '../../lib/flightReads.js';
import { type FigurePair, LOWER_SHOWN } from './board.js';

const P = COPY.searchPage;

/** The calendar's anchor: "See all on the calendar" and the Trips cards' counts link land there (Ruling 18). */
export const CALENDAR_ID = 'calendar';

/**
 * The flight lists of the dates the page shows a read for (Ruling 20: Read flights where a read would go now): the lower
 * dates the section shows, then the open day panel's stays (Ruling 18), at most MAX_FLIGHT_LIST_PAIRS to a request.
 * Owned by the page so its words outlive the section (`ReadSaid`, the page's one status) and the no-trip lead knows
 * whether flights can be read here. A read that lands calls the page's re-read, so the date shows as a trip.
 */
export function usePageFlights(
  definition: DefinitionResponse,
  lower: readonly FigurePair[],
  day: readonly DatePair[] = [],
): BoardFlights {
  const qc = useQueryClient();
  const keys = lower.slice(0, LOWER_SHOWN).map(pairKey).join(',');
  const dayKeys = day.map(pairKey).join(',');
  const pages = useMemo(() => {
    const out = keys === '' ? [] : [keys.split(',')];
    const days = dayKeys === '' ? [] : dayKeys.split(',');
    for (let i = 0; i < days.length; i += MAX_FLIGHT_LIST_PAIRS)
      out.push(days.slice(i, i + MAX_FLIGHT_LIST_PAIRS));
    return out;
  }, [keys, dayKeys]);
  const limits = useMemo(() => flightLimitsOf(definition.constraints), [definition.constraints]);
  // why: a landed read made the date a trip on the server; the page's read says so once read again
  const onLanded = useCallback(
    () => void qc.invalidateQueries({ queryKey: ['date-pairs', definition.id] }),
    [qc, definition.id],
  );
  return useBoardFlights(definition.id, pages, limits, onLanded);
}

/**
 * What a pressed read ends in (a refusal in words, or that it ended), in a polite status the page keeps mounted in one
 * place whatever the sections show, and never hidden while empty, so its words are announced when they arrive.
 */
export function ReadSaid({ flights }: { flights: BoardFlights }) {
  return (
    <p role="status" className="search-read-said" data-testid="read-said">
      {flights.said?.words ?? ''}
    </p>
  );
}

export interface LowerOnCalendarProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  /** Every calendar price lower than the cheapest trip, by price (`boardModel`'s, Ruling 5). */
  lower: readonly FigurePair[];
  /** The page has a trip, so these are "lower" than it; without one they are the lowest calendar prices. */
  hasTrip: boolean;
  /** The shown dates' flight lists and the read on demand (`usePageFlights`, the page's). */
  flights: BoardFlights;
}

/**
 * Design 2026-11-08 §5.2 (mockup 02), Rulings 5 and 20: the calendar prices below the cheapest trip whose flights were not
 * read, cheapest first: three as shared calendar rows, each saying what is known of its flights (`readStateWords`) with
 * "Read flights" where a read would go now (the flight lists' `readNow`), the count of them all, and "See all on the
 * calendar". Where flight lists cannot be read here one line says why, and no row offers a read. Nothing without a
 * lower date.
 */
export function LowerOnCalendar({ definition, data, lower, hasTrip, flights }: LowerOnCalendarProps) {
  const id = useId();
  const rows = lower.slice(0, LOWER_SHOWN);
  if (rows.length === 0) return null;
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
            const said = flights.said?.key === key ? flights.said.words : null;
            return (
              <CalendarRow
                key={`${p.index}|${p.figure.origin}|${p.figure.destination}`}
                figure={p.figure}
                search={search}
                pair={p}
                onRead={readNow ? flights.read : null}
                reading={reading}
                said={said}
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
    </section>
  );
}
