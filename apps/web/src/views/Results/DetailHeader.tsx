import { daysBetween } from '@gmt/core';
import type { ExecutionSummary } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { BACK_TO_DATES, type DetailPair } from '../../state/resultsState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

export interface DetailHeaderProps {
  datePair: DetailPair;
  /** The airport pairs the detail reads (the Dates airport filter's) and the definition's, for "2 of 4 airport pairs". */
  airportPairs: { inScope: number; total: number };
  executions: readonly ExecutionSummary[];
  stale: boolean;
}

/**
 * Spec §11 Date pair detail, top: "Back to dates" (the Dates filters and sort kept), the dates and nights as the view's
 * title, the runs shown with their status and age, and, under an airport filter, the airport pairs in scope.
 */
export function DetailHeader({ datePair, airportPairs, executions, stale }: DetailHeaderProps) {
  const nights = daysBetween(datePair.departureDate, datePair.returnDate);
  return (
    <div className="space-y-1">
      <p>
        <a
          href={hrefWith(BACK_TO_DATES)}
          onClick={navigateTo(BACK_TO_DATES)}
          data-testid="back-to-dates"
          className="inline-flex min-h-11 items-center underline"
        >
          {COPY.detailView.backToDates}
        </a>
      </p>
      <ViewHeader
        title={COPY.detailView.title(
          formatIsoDate(datePair.departureDate),
          formatIsoDate(datePair.returnDate),
          nights,
        )}
        executions={executions}
        stale={stale}
      />
      {airportPairs.inScope < airportPairs.total ? (
        <p className="text-sm">{COPY.datesView.scopeAirports(airportPairs.inScope, airportPairs.total)}</p>
      ) : null}
    </div>
  );
}
