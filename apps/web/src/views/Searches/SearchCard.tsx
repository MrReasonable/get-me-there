import { resultBasisOf } from '@gmt/core';
import { useEffect, useRef } from 'react';
import type { SearchCard as Card } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { StopSentence } from '../../components/StopWords.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { tripHref } from '../../state/tripState.js';
import { hrefWith, navigateTo, navigateToQuery } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import { SearchAgainButton } from '../Dates/SearchAgainButton.js';
import { suggestedName, useAirportDetails } from '../Definitions/airports.js';
import {
  announcement,
  isActive,
  neverSearchedText,
  scheduleText,
  stateLine,
  tripText,
  windowText,
} from './cardWords.js';
import { RemoveSearch } from './RemoveSearch.js';

const S = COPY.searchesView;

/** The patch of a card's links: its search's page, and its Edit page. */
const seeDatesPatch = (id: string) => ({ ...navPatch('dates'), def: id });
const editPatch = (id: string) => ({ view: 'definitions', edit: id });

/**
 * Spec rev 55 §11 "Searches": one saved search as a plate in layout B's main column. The route in words from the
 * airports' cities with the codes beside it, the window, the stay and (only when scheduled) "repeats Mondays 05:00"; its
 * state line in a polite status region; "N of M date pairs never searched" whenever non-zero; the cheapest found, always
 * through `PriceCell`'s compact face so its own source and age show (a pairing figure calendar-styled, worded "cheapest
 * of the sellers read, not checked with the airline" through `basisKindName`: spec rev 56 §11, prov-006, 21.7
 * persona H1); and the actions, with Remove visually apart from
 * Search again. The card owns no mutation of its search: Remove's request, the undo line and the re-read live in the
 * view.
 */
export function SearchCard({
  card,
  removing,
  removeError,
  onRemove,
  focusHeading,
  onFocused,
}: {
  card: Card;
  removing: boolean;
  removeError: Error | null;
  onRemove: () => void;
  /** Undo restored this card: its heading takes focus once, when it is back in its place. */
  focusHeading: boolean;
  onFocused: () => void;
}) {
  const now = useNow();
  const details = useAirportDetails([...card.origins, ...card.destinations]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusHeading) return;
    headingRef.current?.focus();
    onFocused();
  }, [focusHeading, onFocused]);
  const active = isActive(card);
  const state = stateLine(card, now);
  const never = neverSearchedText(card);
  const cheapest = card.cheapest;
  const tripLink =
    cheapest === null ? null : tripHref(card.id, cheapest.departureDate, cheapest.returnDate, {});
  const codes = S.codes(card.origins.join(', '), card.destinations.join(', '));
  return (
    <li className="plate plate-pad search-card" data-card={card.id}>
      <h3 ref={headingRef} tabIndex={-1} className="search-card-name">
        {card.name}
      </h3>
      <p className="search-card-route">
        {suggestedName(card.origins, card.destinations, details.rows)}{' '}
        <span className="text-fg-2">({codes})</span>
      </p>
      <p className="search-card-facts text-fg-2">
        {[
          windowText(card.window),
          COPY.datesView.scopeNights(card.minNights, card.maxNights),
          ...(card.schedule === null ? [] : [scheduleText(card.schedule)]),
        ].join(' · ')}
      </p>
      {/* why: the visible line carries the counts and is not live (it changes every poll); the hidden line below
      announces only the kind of state, or a stop's sentence, so a poll announces nothing new */}
      <div data-testid="card-state" className="search-card-state">
        {state.kind === 'stopped' ? (
          <StopSentence stop={state.stop} className="warn-text" />
        ) : (
          <p>{state.words}</p>
        )}
      </div>
      <p role="status" className="sr-only">
        {announcement(state)}
      </p>
      {never === null ? null : <p className="text-sm">{never}</p>}
      {cheapest === null || tripLink === null ? null : (
        <div className="search-card-cheapest">
          {/* why: Ruling 7, design 2026-11-08 §5.3: a card's trip price opens that trip's page (its booking targets come
          with the card redesign); the link stays in this tab, so the way out of the app is the page's own. The card's
          price is the whole search's cheapest, read under no filters, so the link carries none and its click goes to
          exactly that address (CodeRabbit PR #58 finding 9) */}
          <a
            href={tripLink}
            onClick={navigateToQuery(tripLink)}
            data-testid="card-trip-price"
            className="search-card-price-link"
          >
            <PriceBoundary>
              <PriceCell
                pricePence={cheapest.pricePence}
                provenance={cheapest.provenance}
                calendar={resultBasisOf(cheapest.basis) === 'calendar'}
                stale={cheapest.stale}
                truncated={cheapest.truncated}
                destination={cheapest.destination}
                compact
              />
            </PriceBoundary>
            <span className="sr-only">{S.openThisTrip}</span>
          </a>
          <span>{tripText(cheapest.departureDate, cheapest.returnDate)}</span>
          {/* why: spec rev 56 §11 (prov-006): a card carries no seller, offer count or grid price, so a pairing figure
          says what it is in words */}
          {cheapest.priceKind !== null ? (
            <span data-testid="card-price-kind" className="text-fg-2">
              {COPY.basisKindName[cheapest.priceKind]}
            </span>
          ) : null}
          {/* why: the first-ranked figure is not always the cheapest: a fresh trip with flights read ranks ahead of a
          cheaper older one, and a verified trip ahead of a cheaper calendar price. A calendar figure ranks first only
          when no trip with flights read exists, so it is then the cheapest current calendar price; every other figure is
          worded as the top trip (design 2026-11-08) */}
          {active ? (
            <span className="text-fg-2">
              {cheapest.basis === 'calendar' ? S.cheapestSoFar : S.topTripSoFar}
            </span>
          ) : null}
        </div>
      )}
      <div data-testid="card-actions" className="search-card-actions">
        <span className="search-card-main-actions">
          <a
            href={hrefWith(seeDatesPatch(card.id))}
            onClick={(e) => {
              // why: spec §11 — a card's See dates remembers the search as the one last opened, as its page does on mount
              writeLastSearch(card.id);
              navigateTo(seeDatesPatch(card.id))(e);
            }}
            aria-label={S.seeDatesOf(card.name)}
            className="btn btn-sm min-h-11"
          >
            {S.seeDates}
          </a>
          <SearchAgainButton definitionId={card.id} accessibleName={S.searchAgainOf(card.name)} />
          <a
            href={hrefWith(editPatch(card.id))}
            onClick={navigateTo(editPatch(card.id))}
            aria-label={S.editOf(card.name)}
            className="btn btn-sm min-h-11"
          >
            {S.edit}
          </a>
        </span>
        <RemoveSearch
          name={card.name}
          active={active}
          pending={removing}
          error={removeError}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}
