import { addDays, type FlightLimits, type IsoDate, type ListedFlight } from '@gmt/core';
import type { FlightList } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDateWords, formatMinutes } from '../../format.js';
import { carriersText, flightMarks, listStale } from './flightLines.js';

// Spec rev 55 §11 "Flights" (WP20 Task 20.10): one flight a list read, and every amount a list carries, through
// PriceCell (ruling C3) with the list's complete provenance.

const F = COPY.flights;
const D = COPY.datesView;

/**
 * An amount a flight list read, through PriceCell's compact face (spec rev 55 §11): the list's provenance, the
 * main-path flight-list source name, the calendar style (dashed outline, "not checked": no airline checked it) and the
 * list's stale mark (older than this search's refresh).
 */
export function FlightPrice({ list, pence }: { list: FlightList; pence: number }) {
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={pence}
        provenance={list.provenance}
        calendar
        stale={listStale(list)}
        sourceLabel={F.sourceLabel}
        compact
      />
    </PriceBoundary>
  );
}

/**
 * One flight (spec rev 55 §11): "depart 07:15, arrive 18:05 +1 · 10h 50m · 1 change · Virgin Atlantic · from £478 round
 * trip", the arrival's full date for assistive technology when it is a later day, then its marks against the search's
 * limits. Carrier names are text only (React escapes them; nothing here sets HTML).
 */
export function FlightRow({
  flight: f,
  list,
  limits,
}: {
  flight: ListedFlight;
  list: FlightList;
  limits: FlightLimits;
}) {
  const marks = flightMarks(f, limits, F);
  return (
    <li data-testid="flight" className="flight">
      <span data-testid="flight-line">
        {F.times(f.departsLocal, f.arrivesLocal, f.arrivesDayOffset)}
        {f.arrivesDayOffset > 0 ? (
          <span className="sr-only">{` ${D.arrivesOn(formatIsoDateWords(arrivalDate(list.departureDate, f)))}`}</span>
        ) : null}
        {F.separator}
        {formatMinutes(f.durationMinutes)}
        {F.separator}
        {F.changes(f.stops)}
        {F.separator}
        {carriersText(f, F)}
      </span>
      <span className="flight-price">
        {F.separator}
        {F.from} <FlightPrice list={list} pence={f.amountMinor} /> {F.roundTrip}
      </span>
      {marks.length > 0 ? (
        <span data-testid="flight-mark" className="flight-mark">
          {marks.join(F.markJoin)}
        </span>
      ) : null}
    </li>
  );
}

/** The arrival's calendar date: the departure date plus the page's day offset (dates as strings, no time zone). */
function arrivalDate(departure: IsoDate, f: ListedFlight): IsoDate {
  return addDays(departure, f.arrivesDayOffset);
}
