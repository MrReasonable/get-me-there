import { type CellKey, priceLabelKind, stopDetailClause } from '@gmt/core';
import type { ReactNode } from 'react';
import { useFlightRead } from '../../api/flights.js';
import type { DefinitionResponse, TripResponse } from '../../api/types.js';
import { BookLink } from '../../components/BookLink.js';
import { PriceLabel } from '../../components/PriceLabel.js';
import { VerifyCellButton } from '../../components/VerifyCellButton.js';
import { listText } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { labelDetail } from '../../lib/figureLabel.js';
import { readStateWords } from '../../lib/readStateWords.js';
import { useNow } from '../../now.js';
import { FlightRead } from '../Dates/BoardCard.js';
import type { ListsState } from '../Dates/board.js';
import { refusalWords } from '../Dates/Flights.js';
import { hoursText } from '../Dates/flightLines.js';
import { readAt } from '../Dates/stateLines.js';
import { Amount } from './Amount.js';
import type { Card, CardState, LimitName } from './cardState.js';
import { Legs } from './Legs.js';
import { cheapestOutbound, figurePriceOf, readMinutes, type ShownTrip } from './model.js';

/** The board's flight-lists state where a list is in hand. */
const LISTS_READ: ListsState = 'available';

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
  // why: design §6.1, §3: the check is shown only where it can run (a SearchApi key, and the search lets it verify);
  // final review I2: it checks the figure's own airport pair, the price the card shows, while a read by hand names the
  // cell whose list the card reads (`r.read`, maybe another pair for a stale verified price)
  const f = r.figure;
  const cell: CellKey | null =
    f === null
      ? null
      : {
          origin: f.origin,
          destination: f.destination,
          departureDate: r.departureDate,
          returnDate: r.returnDate,
        };
  // final review M3: a calendar price is checked where it stands too (the search page's calendar-gap links open its
  // Trip page on its own airports for this), as is a read trip or a verified price
  const check =
    (state.kind === 'trip' || state.kind === 'verified' || f?.basis === 'calendar') &&
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
  const c = figurePriceOf(r);
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
      const list = r.flightList;
      // why: the cheapest outbound's price is Google's list price for it, said with its own label like every price
      const kind = priceLabelKind({ kind: 'list-outbound' }, false);
      return (
        <>
          {T.noneWithin(listAgo, limitsText(state.failing, r.limits))}
          {cheapest === null || list === null ? null : (
            <>
              {' '}
              {T.cheapestRead}{' '}
              <Amount
                price={{ pricePence: cheapest.amountMinor, provenance: list.provenance, stale: list.stale }}
                variant="inline"
              />
              {T.cheapestReadLeg(formatMinutes(cheapest.durationMinutes))}{' '}
              <PriceLabel
                kind={kind}
                ageHours={list.ageHours}
                stale={list.stale}
                provenance={list.provenance}
                detail={labelDetail(kind, null)}
              />
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
      // why: Ruling 5: the card and the Search page's row say the same of one read (`readStateWords`)
      return r.figure?.pairingRead === 'list-failed'
        ? T.calendarFailed(readStateWords(r.figure))
        : T.calendarOnly;
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
        <p>{T.outsideWindow}</p>
      </section>
    );
  if (state.kind === 'reading') {
    // why: final review M2: only a calendar figure's price is "the calendar's"; a verified price is never called so
    const calendar = r.figure?.basis === 'calendar' ? figurePriceOf(r) : null;
    const minutes = readMinutes(r.read.pagesPlanned);
    return (
      <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state={state.kind}>
        <div role="status" aria-live="polite" className="trip-reading">
          {/* why: a div, since the price's label is a disclosure (<details>), which a <p> may not hold */}
          <div>
            {T.reading(minutes)}
            {calendar === null ? null : (
              <>
                {' '}
                {T.calendarShowed} <Amount price={calendar} variant="inline" />{' '}
                {/* why: CodeRabbit PR #58 finding 16: the calendar price keeps its one label while the read runs */}
                <PriceLabel
                  kind={calendar.label}
                  ageHours={calendar.ageHours}
                  stale={calendar.stale}
                  provenance={calendar.provenance}
                  detail={calendar.detail}
                />
                {T.sentenceEnd}
              </>
            )}
          </div>
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
  // why: final review M7 (plan Task 6): a stale verified price's flight read adds the read-trip line the board's row
  // shows beneath it (the trip read on these dates, which does not lead); a failed read is said above, by `failure`.
  // A figure with a pairing has a list, so the board's "flights not read" words never apply
  const readTrip =
    state.kind === 'verified' && r.figure !== null && r.figure.pairing !== null ? (
      <FlightRead figure={r.figure} lists={LISTS_READ} />
    ) : null;
  if ((state.kind === 'trip' || state.kind === 'verified') && trip !== null)
    return (
      <section className="trip-card" aria-label={T.cardLabel} data-state={state.kind}>
        {failure}
        <TripAnswer trip={trip} caption />
        {readTrip}
        <div className="trip-card-foot">{actions}</div>
      </section>
    );
  const listAgo = agoText(r.flightList?.ageHours ?? r.figure?.pairing?.ageHours ?? 'unknown');
  return (
    <section className="trip-card trip-card-state" aria-label={T.cardLabel} data-state={state.kind}>
      {failure}
      <CalendarPrice r={r} muted={state.kind === 'gone'} />
      <div className="trip-sentence">{stateSentence(r, state, listAgo)}</div>
      {trip !== null ? <TripAnswer trip={trip} caption={false} /> : null}
      {actions}
    </section>
  );
}
