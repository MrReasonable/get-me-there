import { type IsoDateTime, type PriceLabelKind, priceLabelKind } from '@gmt/core';
import type { ReactNode } from 'react';
import type { TripResponse } from '../../api/types.js';
import { PriceLabel } from '../../components/PriceLabel.js';
import { COPY } from '../../copy.js';
import { formatIsoDateShort, londonParts } from '../../format.js';
import { labelDetail } from '../../lib/figureLabel.js';
import { instantMs } from '../../lib/time.js';
import { hoursText } from '../Dates/flightLines.js';
import { londonDaysAgo } from '../Dates/stateLines.js';
import { Amount } from './Amount.js';
import { figurePriceOf, type Priced, type ShownTrip } from './model.js';

const T = COPY.trip;
const A = T.about;

/** When a price was read, in London: "today at 16:42", "yesterday at 09:10", "on 12 Mar at 11:44". */
function whenRead(at: IsoDateTime, now: IsoDateTime): string {
  const { date, time } = londonParts(instantMs(at));
  const days = londonDaysAgo(at, now);
  if (days === 0) return T.aboutWhen.today(time);
  if (days === 1) return T.aboutWhen.yesterday(time);
  return T.aboutWhen.day(formatIsoDateShort(date), time);
}

/** A calendar or cached price for these dates with its label, or the line that says there was none. */
function OtherPrice({ price, lead, none }: { price: TripResponse['calendar']; lead: string; none: string }) {
  if (price === null) return <li>{none}</li>;
  const kind: PriceLabelKind = priceLabelKind(
    { kind: 'calendar', providerId: price.provenance.providerId },
    price.notSeenAgain,
  );
  return (
    <li>
      {lead}{' '}
      <b>
        <Amount price={price} />
      </b>{' '}
      {A.forTheseDates}{' '}
      <PriceLabel
        kind={kind}
        ageHours={price.ageHours}
        stale={price.stale}
        provenance={price.provenance}
        detail={labelDetail(kind, null)}
      />
    </li>
  );
}

/** What the card's price is and when it was read, in one sentence after the price. */
function whatLine(trip: ShownTrip | null, r: TripResponse, now: IsoDateTime): ReactNode {
  const price: (Priced & { label: PriceLabelKind; seller?: ShownTrip['seller'] }) | null =
    trip ?? figurePriceOf(r);
  if (price === null) return null;
  const when = whenRead(price.provenance.fetchedAt, now);
  const seller = trip?.seller ?? null;
  const words =
    price.label === 'seller'
      ? seller === null
        ? A.sellerSearchApi(when)
        : A.seller(seller.name, when)
      : price.label === 'google-list'
        ? A['google-price'](when)
        : A[price.label](when);
  return (
    <li>
      <b>
        <Amount price={price} />
      </b>{' '}
      {words}
    </li>
  );
}

/** What was checked of the card's price, and what wasn't. */
function checkedLines(trip: ShownTrip | null, r: TripResponse): string[] {
  // why: a verified price not seen again (`gone`) shows no trip, but SearchApi checked it all the same
  if (trip === null && r.figure?.basis === 'verified') return [A.checkedSearchApi, A.notCheckedTrip];
  if (trip === null) return [A.notCheckedCalendar];
  // why: SearchApi's own checks (its verdicts) apply to a verified price; a pairing is checked by the list's limits
  if (trip.pairingKind === null) return [A.checkedSearchApi, A.notCheckedTrip];
  const max = r.limits.maxJourneyMinutes;
  return [max === null ? A.checkedLimits : A.checkedJourney(hoursText(max)), A.notCheckedTrip];
}

/**
 * Design 2026-11-08 §6.1 "About this price", one click down: what the card's price is and when it was read, what was
 * checked and what wasn't, what the calendar and the Aviasales cache said for these dates (each with its label), and
 * one line for each other airport pair of these dates.
 */
export function AboutPrice({ r, trip, now }: { r: TripResponse; trip: ShownTrip | null; now: IsoDateTime }) {
  const here = {
    origin: r.figure?.origin ?? r.read.origin,
    destination: r.figure?.destination ?? r.read.destination,
  };
  const others = r.cells.filter((c) => c.origin !== here.origin || c.destination !== here.destination);
  return (
    <details className="trip-fold" data-testid="about-price">
      <summary>
        <span>
          {T.aboutSummary} <span className="trip-fold-sub">{T.aboutSub}</span>
        </span>
      </summary>
      <ul className="trip-facts">
        {whatLine(trip, r, now)}
        {checkedLines(trip, r).map((l) => (
          <li key={l}>{l}</li>
        ))}
        <OtherPrice price={r.calendar} lead={A.calendarShowed} none={A.calendarNone} />
        <OtherPrice price={r.cached} lead={A.cachedShowed} none={A.cachedNone} />
        {others.map((c) => (
          <li key={`${c.origin}-${c.destination}`}>
            {A.otherPair(c.origin, c.destination, A.pairState[c.bucket])}
          </li>
        ))}
      </ul>
    </details>
  );
}
