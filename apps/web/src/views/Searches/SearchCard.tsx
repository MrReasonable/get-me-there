import type { PointOfSale } from '@gmt/core';
import { useEffect, useRef } from 'react';
import { useExecutionActions } from '../../api/queries.js';
import type { SearchCard as Card } from '../../api/types.js';
import { LowerPrice } from '../../components/LowerPrice.js';
import { RunProgress, runProgressOf } from '../../components/RunProgress.js';
import { TripRow, TripRowHead } from '../../components/rows/TripRow.js';
import { COPY } from '../../copy.js';
import { verifiedDetailOf } from '../../lib/bookingTarget.js';
import { useNow } from '../../now.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import { SearchAgainButton } from '../Dates/SearchAgainButton.js';
import {
  isActive,
  isStopped,
  metaParts,
  nothingFound,
  nothingFoundText,
  scheduleText,
  tripsLabel,
} from './cardWords.js';
import { RemoveSearch } from './RemoveSearch.js';
import { TurnOnBrowser } from './TurnOnBrowser.js';

const S = COPY.searchesView;

/** The patch of a card's links: its search's page, and its Edit page. */
const searchPatch = (id: string) => ({ ...navPatch('dates'), def: id });
const editPatch = (id: string) => ({ view: 'definitions', edit: id });

/**
 * Design 2026-11-08 §5.3 (mockup 01-searches), Rulings 4, 5, 7, 8, 11, 20: one saved search as a card. Its name links to
 * the Search page; under it the meta line (the route's codes, the window, the stay, when a finished run searched) and
 * "repeats Mondays 05:00" when scheduled. Then, by state: the run's progress and Cancel (`RunProgress`) while one goes,
 * or its stop and Resume; "Dates changed since this was last searched"; and for a finished search that found nothing
 * the first reason that applies (Ruling 8), with its fix. Then its three cheapest trips as shared rows (no airlines), each
 * price a label and a link, the counts line (trips with flights read; the dates that look lower on the calendar), and the
 * actions: All trips and dates, Search again (Cancel stands in its place while a run goes), Edit, and Remove, quietly.
 * The card owns no mutation of its search except the run's Cancel and Resume: Remove's request, the undo line and the
 * re-read live in the view.
 */
export function SearchCard({
  card,
  pointOfSale,
  browserConfigured,
  removing,
  removeError,
  onRemove,
  focusHeading,
  onFocused,
}: {
  card: Card;
  pointOfSale: PointOfSale;
  /** The browser provider is set up on this install (`/providers`): the fix is offered only then (Ruling 8). */
  browserConfigured: boolean;
  removing: boolean;
  removeError: Error | null;
  onRemove: () => void;
  /** Undo restored this card: its heading takes focus once, when it is back in its place. */
  focusHeading: boolean;
  onFocused: () => void;
}) {
  const now = useNow();
  const { cancel, resume } = useExecutionActions();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusHeading) return;
    headingRef.current?.focus();
    onFocused();
  }, [focusHeading, onFocused]);
  const pending = cancel.isPending ? 'cancel' : resume.isPending ? 'resume' : null;
  const active = isActive(card);
  const run = card.latestRun;
  const found = nothingFound(card);
  const multiAirport = card.origins.length > 1 || card.destinations.length > 1;
  const link = searchPatch(card.id);
  const rowSearch = {
    id: card.id,
    cabin: card.cabin,
    multiAirport,
    pointOfSale,
    showCarriers: false,
  } as const;
  // why: a card's trips are the search's current trips: while another search runs they are the previous search's, and a
  // trip a search before the latest read says so in its label's detail (Review Focus 2)
  const earlierNote = (fromEarlier: boolean): string | null =>
    fromEarlier || active ? (active ? S.previousSearchReplaced : S.previousSearchDetail) : null;
  const fix = found?.kind === 'browser-off';
  return (
    <li className="tcard" data-card={card.id}>
      <div className="tcard-head">
        <div className="tcard-title">
          <h2 ref={headingRef} tabIndex={-1} className="tcard-name">
            <a href={hrefWith(link)} onClick={navigateTo(link)} className="tcard-name-link">
              {card.name}
            </a>
          </h2>
          {card.schedule === null ? null : (
            <span className="tcard-repeat">{scheduleText(card.schedule)}</span>
          )}
        </div>
        <p className="tcard-meta">{metaParts(card, now).join(' · ')}</p>
      </div>
      {run === null ? <p className="tcard-state">{S.notSearchedYet}</p> : null}
      {run !== null && (active || isStopped(card)) ? (
        <div className="tcard-run">
          <RunProgress
            run={runProgressOf(run)}
            onCancel={() => cancel.mutate(run.id)}
            onResume={() => resume.mutate(run.id)}
            pending={pending}
            failure={cancel.error?.message ?? resume.error?.message ?? null}
          />
        </div>
      ) : null}
      {card.spaceChangedSince && run !== null && !active ? (
        <p className="tcard-state tcard-changed">{S.datesChanged}</p>
      ) : null}
      {found === null ? null : (
        <div className="tcard-state tcard-nothing">
          <span className="tcard-mark" aria-hidden="true">
            !
          </span>
          <p>
            {nothingFoundText(found)}
            {found.kind === 'browser-off' && !browserConfigured ? ` ${S.browserNotSetUp}` : null}
          </p>
        </div>
      )}
      {card.trips.length === 0 ? null : (
        <ul className="tcard-trips" aria-label={tripsLabel(card)}>
          <TripRowHead />
          {card.trips.map((t) => {
            const pair = { departureDate: t.departureDate, returnDate: t.returnDate, nights: t.nights };
            return (
              <TripRow
                key={`${t.departureDate}|${t.returnDate}|${t.figure.origin}|${t.figure.destination}`}
                figure={t.figure}
                details={verifiedDetailOf(card.verifiedDetails, pair, t.figure)}
                search={rowSearch}
                pair={pair}
                earlierNote={earlierNote(t.figure.fromEarlierSearch)}
              />
            );
          })}
        </ul>
      )}
      <CountsLine card={card} link={link} />
      <div data-testid="card-actions" className="tcard-foot">
        <a
          href={hrefWith(link)}
          onClick={navigateTo(link)}
          aria-label={S.allTripsAndDatesOf(card.name)}
          className="trip-btn tcard-btn"
        >
          {S.allTripsAndDates}
        </a>
        {active ? null : fix && browserConfigured ? (
          <TurnOnBrowser definitionId={card.id} name={card.name} />
        ) : (
          <SearchAgainButton
            definitionId={card.id}
            label={run === null ? COPY.searchAgain.searchNow : COPY.searchAgain.label}
            accessibleName={S.searchAgainOf(card.name)}
          />
        )}
        <span className="tcard-foot-end">
          {fix && !browserConfigured ? (
            <a href={hrefWith(navPatch('settings'))} onClick={navigateTo(navPatch('settings'))}>
              {S.browserNotSetUpLink}
            </a>
          ) : null}
          <a
            href={hrefWith(editPatch(card.id))}
            onClick={navigateTo(editPatch(card.id))}
            aria-label={S.editOf(card.name)}
            className="trip-btn trip-btn-quiet tcard-btn"
          >
            {S.edit}
          </a>
          <RemoveSearch
            name={card.name}
            active={active}
            pending={removing}
            error={removeError}
            onRemove={onRemove}
          />
        </span>
      </div>
    </li>
  );
}

/**
 * Rulings 5 and 6: under the trips, how many dates have flights read ("23 dates with flights read; these are the
 * cheapest.") and how many look lower on the calendar, from which price, with its label ("155 dates look lower on the
 * calendar, from £372 Calendar · 3h, flights not read."); with no trip, "Calendar prices for 2,146 dates, from £372
 * Calendar · 3h; no flights read yet." Each clause only when its count is not zero; the count links to the Search page.
 */
function CountsLine({ card, link }: { card: Card; link: Record<string, string> }) {
  const lower = card.lowerOnCalendar;
  if (card.readDates === 0 && lower === null) return null;
  const to = { href: hrefWith(link), onClick: navigateTo(link) };
  const noTrip = card.trips.length === 0;
  return (
    <div className="tcard-lower" data-testid="card-counts">
      {card.readDates === 0 ? null : (
        <>
          {S.datesWithFlightsRead(card.readDates)}
          {lower === null ? null : ' '}
        </>
      )}
      {lower === null ? null : (
        <>
          <a {...to}>{noTrip ? S.calendarOnlyLink(lower.count) : S.lowerLink(lower.count)}</a>
          {S.lowerFrom} <LowerPrice lower={lower.cheapest} />
          {noTrip ? S.calendarOnlyTail : S.lowerTail}
        </>
      )}
    </div>
  );
}
