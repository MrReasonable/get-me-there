import { CONFIRM_TARGET, type DecodedDatePairs } from '@gmt/core';
import { useId } from 'react';
import type { DefinitionResponse, ExecutionResponse } from '../../api/types.js';
import { TripRow, TripRowHead } from '../../components/rows/TripRow.js';
import { COPY } from '../../copy.js';
import { verifiedDetailOf } from '../../lib/bookingTarget.js';
import { hoursText } from '../../lib/flightLines.js';
import { CLEARED_FILTERS, datesPatch } from '../../state/datesState.js';
import { updateSearchParams } from '../../state/urlState.js';
import { type FigurePair, nextPage } from './board.js';
import { ConfirmLine } from './ConfirmLine.js';
import { confirmStepGoing } from './confirmWords.js';

const P = COPY.searchPage;
const S = COPY.searchesView;

/** What the section says when it has no trip: why, and whether the filters are the reason (then Clear filters). */
export type NoTrip = { text: string; clear: boolean };

export interface CheapestTripsProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  /** The trips in view, in rank order (`boardModel`'s, Ruling 4). */
  trips: readonly FigurePair[];
  /** How many of them show: five, then ten more per press of "Show 10 more". */
  shown: number;
  onShowMore: () => void;
  /** The dates in view whose trips were all over the journey limit, and that limit in minutes (Ruling 4). */
  overLimit: number;
  limit: number | null;
  /** The latest run's own read, for the stopping sentence (Ruling 22), once it has answered. */
  run: ExecutionResponse | undefined;
  /** A run is going: a trip an earlier search read says so, and that the running one will replace it (Review Focus 2). */
  runActive: boolean;
  /** A filter is applied: "these five" is said only of the five cheapest unfiltered (Ruling 22). */
  filtered: boolean;
  /** What the section says with no trip, or null while there is one. */
  noTrip: NoTrip | null;
}

/**
 * Design 2026-11-08 §5.2 (mockup 02), Rulings 4, 20 and 22: the trips whose flights were read, cheapest first, as shared
 * rows with their airlines: five, then "Show 10 more". Its lead says what they are and how reading stopped (the stopping
 * sentence, "these five" only of the five cheapest shown unfiltered); "N dates' trips are over 25h each way" when the
 * journey limit left trips out; with none, why (Review Focus 3: "No flights read yet for these dates…" when calendar
 * prices are below). A trip an earlier search read is styled as such, with its age (Review Focus 2).
 */
export function CheapestTrips({
  definition,
  data,
  trips,
  shown,
  onShowMore,
  overLimit,
  limit,
  run,
  runActive,
  filtered,
  noTrip,
}: CheapestTripsProps) {
  const id = useId();
  const rows = trips.slice(0, shown);
  const more = nextPage(trips.length, rows.length);
  const search = {
    id: definition.id,
    cabin: definition.cabin,
    multiAirport: definition.origins.length > 1 || definition.destinations.length > 1,
    pointOfSale: data.pointOfSale,
    destinationNotes: definition.destinationNotes,
    showCarriers: true,
    onSearchPage: true,
  };
  const f = run?.flights ?? null;
  const stopping =
    f === null
      ? null
      : {
          confirm: f.confirm,
          ended: f.ended,
          stopCause: f.stopCause,
          // why: only a running run reads pages (a pending one is queued or waiting to resume), the card's rule too
          running: run?.status === 'running' && confirmStepGoing(f),
          planned: f.planned,
          theseFive: rows.length === CONFIRM_TARGET && !filtered,
        };
  // why: Review Focus 2: an earlier search's trip says so; "will replace it" only while a search runs
  const earlierNote = (fromEarlier: boolean): string | null =>
    fromEarlier ? (runActive ? S.previousSearchReplaced : S.previousSearchDetail) : null;
  return (
    <section className="search-section" aria-labelledby={`${id}-h`} data-testid="cheapest-trips">
      <h2 id={`${id}-h`} className="search-section-title">
        {P.cheapestHeading}
      </h2>
      <ConfirmLine lead={noTrip === null ? P.cheapestLead : noTrip.text} input={stopping} />
      {overLimit > 0 && limit !== null ? (
        <p className="search-section-sub" data-testid="over-limit">
          {P.overLimit(overLimit, hoursText(limit))}
        </p>
      ) : null}
      {noTrip?.clear === true ? (
        <p className="search-section-sub">
          <button
            type="button"
            className="btn btn-sm min-h-11"
            onClick={() => updateSearchParams(datesPatch(CLEARED_FILTERS))}
          >
            {COPY.clearFilters}
          </button>
        </p>
      ) : null}
      {rows.length === 0 ? null : (
        <div className="search-card">
          <ul className="search-rows" aria-labelledby={`${id}-h`}>
            <TripRowHead />
            {rows.map((p) => (
              <TripRow
                key={`${p.index}|${p.figure.origin}|${p.figure.destination}`}
                figure={p.figure}
                details={verifiedDetailOf(data.verifiedDetails, p, p.figure)}
                search={search}
                pair={p}
                earlierNote={earlierNote(p.figure.fromEarlierSearch)}
              />
            ))}
          </ul>
          {more > 0 ? (
            <div className="search-card-foot">
              <button type="button" className="btn btn-sm" onClick={onShowMore}>
                {P.showMore(more)}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
