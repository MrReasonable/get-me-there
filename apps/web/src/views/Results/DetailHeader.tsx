import { daysBetween } from '@gmt/core';
import type { ExecutionSummary } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatFlapDate, formatIsoDate } from '../../format.js';
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
    <div className="detail-head space-y-2">
      <p>
        <a
          href={hrefWith(BACK_TO_DATES)}
          onClick={navigateTo(BACK_TO_DATES)}
          data-testid="back-to-dates"
          className="link gap-2"
        >
          <span aria-hidden="true">←</span>
          {COPY.detailView.backToDates}
        </a>
      </p>
      {/* why: the dates and nights on the name board; ViewHeader's heading keeps the same words for readers */}
      <div aria-hidden="true" className="flap-strip detail-name">
        <Flaps text={formatFlapDate(datePair.departureDate)} />
        <Flaps text="→" />
        <Flaps text={formatFlapDate(datePair.returnDate)} />
        <Flaps text={COPY.datesView.scopeNights(nights, nights)} className="flaps-gap" />
      </div>
      <div className="detail-title">
        <ViewHeader
          title={COPY.detailView.title(
            formatIsoDate(datePair.departureDate),
            formatIsoDate(datePair.returnDate),
            nights,
          )}
          executions={executions}
          stale={stale}
        />
      </div>
      {airportPairs.inScope < airportPairs.total ? (
        <p className="text-sm font-semibold">
          {COPY.datesView.scopeAirports(airportPairs.inScope, airportPairs.total)}
        </p>
      ) : null}
    </div>
  );
}
