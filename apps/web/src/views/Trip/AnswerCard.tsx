import { type CellKey, stopDetailClause } from '@gmt/core';
import type { ReactNode } from 'react';
import { useFlightRead } from '../../api/flights.js';
import type { DefinitionResponse, TripResponse } from '../../api/types.js';
import { BookLink } from '../../components/BookLink.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { PriceLabel } from '../../components/PriceLabel.js';
import { VerifyCellButton } from '../../components/VerifyCellButton.js';
import { listText } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';
import { BACK_TO_DATES } from '../../state/resultsState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { refusalWords } from '../Dates/Flights.js';
import { hoursText } from '../Dates/flightLines.js';
import { readAt } from '../Dates/stateLines.js';
import type { Card, CardState, LimitName } from './cardState.js';
import { Legs } from './Legs.js';
import { calendarPriceOf, cheapestOutbound, type Priced, readMinutes, type ShownTrip } from './model.js';

const T = COPY.trip;
const F = COPY.flights;
const D = COPY.datesView;

/** The states whose card offers a read by hand (design §6.1's table), and the one where it is the main action. */
const READ_STATES: ReadonlySet<CardState['kind']> = new Set<CardState['kind']>([
  'trip',
  'verified',
  'calendar-with-trip',
  'none-within',
  'other-limits',
  'outbound-only',
  'no-return',
  'read-without-calendar',
  'calendar-only',
  'gone',
  'no-price',
  'over-journey-limit',
  'could-not-read',
]);

/** A price in the card's large or middle size, through PriceCell (the one component that prints a price). */
function Amount({
  price,
  variant,
  muted = false,
}: {
  price: Priced;
  variant: 'big' | 'mid' | 'inline';
  muted?: boolean;
}) {
  return (
    <span className={`trip-amount trip-amount-${variant}${muted ? ' trip-amount-muted' : ''}`}>
      <PriceBoundary>
        <PriceCell
          pricePence={price.pricePence}
          provenance={price.provenance}
          calendar={false}
          stale={price.stale}
          bare
        />
      </PriceBoundary>
    </span>
  );
}

/** "3h ago", or "at a time not known" when the read's age is not known. */
function agoText(hours: number | 'unknown'): string {
  return hours === 'unknown' ? T.agoUnknown : COPY.agoOf(hours);
}

/** The limits no flight read met, in words ("your 25h limit each way and your 1-change limit"), else "your limits". */
function limitsText(failing: readonly LimitName[], limits: TripResponse['limits']): string {
  const words = failing.flatMap((n): string[] => {
    if (n === 'journey')
      return limits.maxJourneyMinutes === null ? [] : [T.limitJourney(hoursText(limits.maxJourneyMinutes))];
    if (n === 'stops') return limits.maxStops === null ? [] : [T.limitStops(limits.maxStops)];
    return [n === 'departure' ? T.limitDeparture : T.limitArrival];
  });
  return words.length === 0 ? T.limitAny : listText(words);
}

/** The read by hand (design §6.1): free, about N minutes; shown only when it would go, else the one reason it can't. */
function ReadAction({
  r,
  definitionId,
  primary,
  retry,
}: {
  r: TripResponse;
  definitionId: string;
  primary: boolean;
  retry: boolean;
}) {
  const read = useFlightRead(definitionId);
  if (!r.read.available)
    return (
      <p className="trip-note" data-testid="read-unavailable">
        {r.read.unavailableReason === 'cabin' ? F.unavailableCabin : F.unavailable}
      </p>
    );
  if (!r.read.wouldGo) return null;
  const minutes = readMinutes(r.read.pagesPlanned);
  const { origin, destination } = r.read;
  // why: Ruling 2: the read names the card's airport pair, so a filtered page reads the pair its row showed
  const body = {
    departureDate: r.departureDate,
    returnDate: r.returnDate,
    ...(origin !== null && destination !== null ? { origin, destination } : {}),
  };
  return (
    <span className="trip-action">
      <button
        type="button"
        className={primary ? 'trip-btn trip-btn-primary' : 'trip-btn'}
        disabled={read.isPending}
        aria-busy={read.isPending ? true : undefined}
        onClick={() => read.mutate(body)}
      >
        {retry ? T.tryAgain(minutes) : T.readFlights(r.flightList !== null, minutes)}
      </button>
      {read.isSuccess ? <span role="status">{T.readStarted}</span> : null}
      {read.error ? <span role="alert">{refusalWords(read.error)}</span> : null}
    </span>
  );
}

/** The card's actions: the read by hand where its state has one, and the SearchApi check where it can run. */
function Actions({
  r,
  state,
  definition,
  retry,
}: {
  r: TripResponse;
  state: CardState;
  definition: DefinitionResponse;
  retry: boolean;
}) {
  const read = READ_STATES.has(state.kind);
  // why: design §6.1, §3: the check is shown only where it can run (a SearchApi key, and the search lets it verify)
  const origin = r.read.origin ?? r.figure?.origin ?? null;
  const destination = r.read.destination ?? r.figure?.destination ?? null;
  const cell: CellKey | null =
    origin === null || destination === null
      ? null
      : { origin, destination, departureDate: r.departureDate, returnDate: r.returnDate };
  const check =
    (state.kind === 'trip' || state.kind === 'verified') &&
    r.verificationConfigured &&
    definition.providers.verification.includes('searchapi') &&
    cell !== null;
  if (!read && !check) return null;
  return (
    <div className="trip-actions">
      {read ? (
        <ReadAction
          r={r}
          definitionId={definition.id}
          primary={state.kind === 'calendar-only'}
          retry={retry}
        />
      ) : null}
      {check && cell !== null ? <VerifyCellButton definitionId={definition.id} cell={cell} /> : null}
    </div>
  );
}

/** The answer: the trip's price as its booking link, its one label, its seller, the line under the link, its legs. */
function TripAnswer({ trip, caption }: { trip: ShownTrip; caption: boolean }) {
  return (
    <div className="trip-hero">
      <div className="trip-hero-price">
        {caption ? <span className="trip-caption">{T.caption}</span> : null}
        <BookLink
          target={trip.target}
          price={<Amount price={trip} variant={caption ? 'big' : 'mid'} />}
          className="trip-book"
        />
        <span className="trip-label-row">
          <PriceLabel
            kind={trip.label}
            ageHours={trip.ageHours}
            stale={trip.stale}
            provenance={trip.provenance}
            detail={trip.detail}
          />
          {trip.seller !== null ? (
            <span className="trip-seller" data-testid="trip-seller">
              {T.sellerLine(trip.seller.name, trip.seller.offersRead)}
            </span>
          ) : trip.pairingKind !== null ? (
            <span className="trip-note">{D.priceKind[trip.pairingKind]}</span>
          ) : null}
        </span>
        {trip.target.kind === 'booking-page' ? <span className="trip-note">{T.bookingPageLine}</span> : null}
      </div>
      <div className="trip-hero-legs">
        <Legs legs={trip.legs} times={trip.times} />
      </div>
    </div>
  );
}

/** A calendar figure's price with its one label, greyed when the latest search did not see it again. */
function CalendarPrice({ r, muted = false }: { r: TripResponse; muted?: boolean }) {
  const c = calendarPriceOf(r);
  if (c === null) return null;
  return (
    <span className="trip-cal-price">
      <Amount price={c} variant="mid" muted={muted} />
      <PriceLabel
        kind={c.label}
        ageHours={c.ageHours}
        stale={c.stale}
        provenance={c.provenance}
        detail={c.detail}
      />
    </span>
  );
}

/** What a state without a leading trip says, in one or two sentences, a price beside them where they name one. */
function stateSentence(r: TripResponse, state: CardState, listAgo: string): ReactNode {
  switch (state.kind) {
    case 'none-within': {
      const cheapest = cheapestOutbound(r.flightList);
      return (
        <>
          {T.noneWithin(listAgo, limitsText(state.failing, r.limits))}
          {cheapest === null || r.flightList === null ? null : (
            <>
              {' '}
              {T.cheapestRead}{' '}
              <Amount
                price={{
                  pricePence: cheapest.amountMinor,
                  provenance: r.flightList.provenance,
                  stale: r.flightList.stale,
                  ageHours: r.flightList.ageHours,
                }}
                variant="inline"
              />
              {T.cheapestReadLeg(formatMinutes(cheapest.durationMinutes))}
            </>
          )}
        </>
      );
    }
    case 'other-limits':
      return T.otherLimits(listAgo);
    case 'outbound-only':
      return T.outboundOnly(listAgo);
    case 'no-return':
      return T.noReturn(listAgo);
    case 'calendar-only':
      return T.calendarOnly;
    case 'gone':
      return T.gone;
    case 'calendar-with-trip':
      return T.calendarWithTrip(agoText(r.figure?.pairing?.ageHours ?? 'unknown'));
    case 'read-without-calendar':
      return T.readWithoutCalendar(agoText(r.flightList?.ageHours ?? 'unknown'));
    case 'over-journey-limit':
      return T.overJourneyLimit;
    case 'could-not-read':
      return T.couldNotRead;
    case 'no-price':
      return T.noPrice;
    case 'not-offered':
      return T.notOffered;
    case 'not-reached':
      return T.notReached;
    case 'browser-unavailable':
      return T.browserUnavailable;
    case 'not-searched':
      return T.notSearched;
    case 'outside-window':
      return T.outsideWindow;
    case 'unreachable':
      return T.unreachable;
    case 'reading':
    case 'trip':
    case 'verified':
      return null;
  }
}

export interface AnswerCardProps {
  /** The trip read, or undefined when it failed before any answer. */
  r: TripResponse | undefined;
  card: Card;
  /** The trip the card shows (`shownTripOf`), for the states that show one. */
  trip: ShownTrip | null;
  definition: DefinitionResponse;
  onRetry: () => void;
}

/**
 * Design 2026-11-08 §6.1: the Trip page's top card in each of its states (cardState's `cardOf`, the board's own
 * figure). A read trip is the answer: its price is its booking link. Every other state says what was and wasn't read
 * in a sentence or two, with exactly its own actions; one that can't run is not shown.
 */
export function AnswerCard({ r, card, trip, definition, onRetry }: AnswerCardProps) {
  const now = useNow();
  const { state, couldNotRead } = card;
  if (state.kind === 'unreachable' || r === undefined)
    return (
      <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state="unreachable">
        <p role="alert" className="trip-bad">
          {T.unreachable}{' '}
          <button type="button" className="trip-btn" onClick={onRetry}>
            {T.retry}
          </button>
        </p>
      </section>
    );
  if (state.kind === 'outside-window')
    return (
      <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state={state.kind}>
        <p>
          {T.outsideWindow}{' '}
          <a className="trip-link" href={hrefWith(BACK_TO_DATES)} onClick={navigateTo(BACK_TO_DATES)}>
            {T.backToSearch(definition.name)}
          </a>
        </p>
      </section>
    );
  if (state.kind === 'reading') {
    const calendar = calendarPriceOf(r);
    const minutes = readMinutes(r.read.pagesPlanned);
    return (
      <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state={state.kind}>
        <div role="status" aria-live="polite" className="trip-reading">
          <p>
            {T.reading(minutes)}
            {calendar === null ? null : (
              <>
                {' '}
                {T.calendarShowed} <Amount price={calendar} variant="inline" />
                {T.sentenceEnd}
              </>
            )}
          </p>
          {/* why: design §6.1: a bar run against the read's estimated time, an estimate, not progress */}
          <div className="trip-progress" data-minutes={String(Math.min(minutes, 5))} aria-hidden="true">
            <i />
          </div>
        </div>
      </section>
    );
  }
  const failure =
    couldNotRead === null ? null : (
      <p className="trip-bad" data-testid="could-not-read">
        {T.listFailed(
          readAt(couldNotRead.at, now, COPY),
          stopDetailClause(couldNotRead.cause, 'camoufox', true),
        )}
      </p>
    );
  const actions = <Actions r={r} state={state} definition={definition} retry={couldNotRead !== null} />;
  if ((state.kind === 'trip' || state.kind === 'verified') && trip !== null)
    return (
      <section className="trip-card" aria-label={T.cardLabel} data-state={state.kind}>
        {failure}
        <TripAnswer trip={trip} caption />
        <div className="trip-card-foot">{actions}</div>
      </section>
    );
  const listAgo = agoText(r.flightList?.ageHours ?? r.figure?.pairing?.ageHours ?? 'unknown');
  return (
    <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state={state.kind}>
      {failure}
      <CalendarPrice r={r} muted={state.kind === 'gone'} />
      <p className="trip-sentence">{stateSentence(r, state, listAgo)}</p>
      {trip !== null ? <TripAnswer trip={trip} caption={false} /> : null}
      {actions}
    </section>
  );
}
