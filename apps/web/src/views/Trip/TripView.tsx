import { useMemo } from 'react';
import { useProvidersWatch, useTrip } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { Crumbs } from '../../components/Crumbs.js';
import { Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { BACK_TO_DATES } from '../../state/resultsState.js';
import { type TripUiState, tripQueryOf } from '../../state/tripState.js';
import { hrefWith } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import { AboutPrice } from './AboutPrice.js';
import { AnswerCard } from './AnswerCard.js';
import { cardOf } from './cardState.js';
import { dayText, shownTripOf, tripSynthetic } from './model.js';
import { OtherFlights } from './OtherFlights.js';
import { SearchLog } from './SearchLog.js';
import './trip.css';

const T = COPY.trip;

/**
 * Design 2026-11-08 §6.1 (trip-page plan Task 7): one pair of dates of a search, ending in a booking link. The whole
 * page is one read (`GET /definitions/:id/trip`), the board's own figure for these dates under the search page's
 * filters (`d.from`, `d.to`, `d.journey`), so the card shows what the row shows. The answer card, the other flights
 * read, then "About this price" and the search log, each one click down.
 */
export function TripView({ definition, state }: { definition: DefinitionResponse; state: TripUiState }) {
  const now = useNow();
  const query = useMemo(() => tripQueryOf(state), [state]);
  const trip = useTrip(definition.id, query);
  const providers = useProvidersWatch();
  const r = trip.data;
  const synthetic = r !== undefined && tripSynthetic(r);
  // why: design §6.1: a page that can't load its data shows nothing rather than old prices, so an error blanks the card
  const failed = trip.isError;
  const card = r === undefined ? null : cardOf(r, failed);
  const shown =
    r === undefined || card === null ? null : shownTripOf(r, card.state, synthetic, definition.cabin);
  const dates = T.heading(dayText(state.departureDate), dayText(state.returnDate));
  const live = r !== undefined && !failed && r.inWindow;
  return (
    <div className="trip" data-testid="trip-page">
      {/* why: the shell already shows the banner when /providers says synthetic (spec §5.5: one banner) */}
      {synthetic && providers.data?.synthetic !== true ? <SyntheticBanner /> : null}
      <Crumbs
        items={[
          { label: COPY.crumbs.trips, href: hrefWith(navPatch('searches')) },
          { label: definition.name, href: hrefWith(BACK_TO_DATES), testId: 'trip-back' },
          { label: dates },
        ]}
      />
      <h2 className="trip-title">
        {dates} {r === undefined ? null : <span className="trip-nights">{T.nights(r.nights)}</span>}
      </h2>
      {r === undefined && !failed ? (
        <Loading />
      ) : (
        <AnswerCard
          r={r}
          card={card ?? { state: { kind: 'unreachable' }, couldNotRead: null }}
          trip={shown}
          definition={definition}
          onRetry={() => void trip.refetch()}
        />
      )}
      {live ? <OtherFlights r={r} synthetic={synthetic} /> : null}
      {live ? (
        <section className="trip-section trip-card trip-folds">
          <AboutPrice r={r} trip={shown} now={now} />
          <SearchLog log={r.log} now={now} />
        </section>
      ) : null}
    </div>
  );
}
