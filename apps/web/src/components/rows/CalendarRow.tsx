import type { DatePairFigure } from '@gmt/core';
import { COPY } from '../../copy.js';
import { readStateWords } from '../../lib/readStateWords.js';
import { DatesCell, NightsCell, RowAmount, RowLabel, type RowPair, stayDates } from './RowParts.js';
import type { RowSearch } from './TripRow.js';

const R = COPY.rows;

/** The date pair and airports "Read flights" is asked for. */
export interface ReadTarget {
  departureDate: RowPair['departureDate'];
  returnDate: RowPair['returnDate'];
  origin: DatePairFigure['origin'];
  destination: DatePairFigure['destination'];
}

export interface CalendarRowProps {
  /** A calendar price (not a trip): its price is never a link, it says its flights' read state instead. */
  figure: DatePairFigure;
  search: RowSearch;
  pair: RowPair;
  /** Starts reading this date pair's flights; null where flights can't be read from here, which shows no button. */
  onRead: ((target: ReadTarget) => void) | null;
  /**
   * A read under way: this row's (`this`: the button stays, says "Reading flights…" and is not pressed again, so it keeps
   * focus) or another row's (`other`: the button is disabled, one read at a time); null when none is.
   */
  reading?: 'this' | 'other' | null;
}

/**
 * Design 2026-11-08 §5.2, Ruling 20: one calendar price, as a list item: the price (not a link) with its label, the
 * dates, the nights, what is known of its flights (`readStateWords`) and "Read flights". A search with several airports
 * names the pair.
 */
export function CalendarRow({ figure, search, pair, onRead, reading = null }: CalendarRowProps) {
  const pairName = search.multiAirport ? R.pair(figure.origin, figure.destination) : null;
  return (
    <li className="trip-row trip-row-cal" data-testid="calendar-row">
      <div className="row-price">
        <span className="book-price">
          <RowAmount
            figure={figure}
            destinationNote={search.destinationNotes?.[figure.destination] ?? null}
          />
        </span>
        <RowLabel figure={figure} />
      </div>
      <DatesCell pair={pair} figure={figure} multiAirport={search.multiAirport} />
      <NightsCell nights={pair.nights} />
      <div className="row-leg row-out row-muted">{readStateWords(figure)}</div>
      {onRead === null ? null : (
        <button
          type="button"
          className="row-read"
          aria-label={reading === 'this' ? undefined : R.readFlightsFor(stayDates(pair), pairName)}
          aria-disabled={reading === 'this' ? true : undefined}
          disabled={reading === 'other'}
          onClick={() => {
            if (reading !== null) return;
            onRead({
              departureDate: pair.departureDate,
              returnDate: pair.returnDate,
              origin: figure.origin,
              destination: figure.destination,
            });
          }}
        >
          {reading === 'this' ? COPY.flights.reading : R.readFlights}
        </button>
      )}
    </li>
  );
}
