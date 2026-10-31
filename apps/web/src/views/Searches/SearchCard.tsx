import { useEffect, useRef } from 'react';
import type { SearchCard as Card } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { StopSentence } from '../../components/StopWords.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import { SearchAgainButton } from '../Dates/SearchAgainButton.js';
import { suggestedName, useAirportDetails } from '../Definitions/airports.js';
import { isActive, neverSearchedText, scheduleText, stateLine, tripText, windowText } from './cardWords.js';
import { RemoveSearch } from './RemoveSearch.js';

const S = COPY.searchesView;

/** The patch of a card's links: its search's page, and its Edit page. */
const seeDatesPatch = (id: string) => ({ ...navPatch('dates'), def: id });
const editPatch = (id: string) => ({ view: 'definitions', edit: id });

/**
 * Spec rev 55 §11 "Searches": one saved search as a plate in layout B's main column. The route in words from the
 * airports' cities with the codes beside it, the window, the stay and (only when scheduled) "repeats Mondays 05:00"; its
 * state line in a polite status region; "N of M date pairs never searched" whenever non-zero; the cheapest found, always
 * through `PriceCell`'s compact face so its own source and age show; and the actions, with Remove visually apart from
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
      <div role="status" className="search-card-state">
        {state.kind === 'stop' ? (
          <StopSentence stop={state.stop} className="warn-text" />
        ) : (
          <p>{state.text}</p>
        )}
      </div>
      {never === null ? null : <p className="text-sm">{never}</p>}
      {cheapest === null ? null : (
        <div className="search-card-cheapest">
          <PriceBoundary>
            <PriceCell
              pricePence={cheapest.pricePence}
              provenance={cheapest.provenance}
              calendar={cheapest.basis === 'calendar'}
              stale={cheapest.stale}
              compact
            />
          </PriceBoundary>
          <span>{tripText(cheapest.departureDate, cheapest.returnDate)}</span>
          {active ? <span className="text-fg-2">{S.cheapestSoFar}</span> : null}
        </div>
      )}
      <div className="search-card-actions">
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
