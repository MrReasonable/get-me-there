import type { PointOfSale } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { rowBookingTarget, type VerifiedDetails } from '../../lib/bookingTarget.js';
import { dayOffsetOf, type LegWordsFacts, legWords } from '../../lib/legWords.js';
import { tripHref } from '../../state/tripState.js';
import { BookLink } from '../BookLink.js';
import {
  DatesCell,
  NightsCell,
  RowAmount,
  type RowFigure,
  RowLabel,
  type RowPair,
  stayDates,
} from './RowParts.js';

const R = COPY.rows;

/** What a row needs of the search it sits under. */
export interface RowSearch {
  id: string;
  cabin: DefinitionResponse['cabin'];
  /** More than one origin or destination: rows say their airport pair (Ruling 20) and link their own trip. */
  multiAirport: boolean;
  /** The install's point of sale, for a search link (`rowBookingTarget`). */
  pointOfSale: PointOfSale;
  /** The destination notes of the search (`DefinitionResponse['destinationNotes']`), where its price is shown. */
  destinationNotes?: DefinitionResponse['destinationNotes'];
}

export interface TripRowSearch extends RowSearch {
  /** The airlines of each way, on the Search page and its day panel; the Trips cards leave them off (mockup 01). */
  showCarriers?: boolean;
}

export interface TripRowProps {
  /** A trip: `isTrip(figure)`, or a verified figure the latest search did not see again (the day panel's). */
  figure: RowFigure;
  /** This verified figure's details from the read (`verifiedDetailOf`), else null. A verified row never reads `figure.pairing`. */
  details: VerifiedDetails | null;
  search: TripRowSearch;
  pair: RowPair;
  /**
   * What an earlier search's trip says in its label's detail (Review Focus 2: "read by the previous search"); the row
   * is then styled as an earlier result. Null for a trip the latest search read.
   */
  earlierNote?: string | null;
}

/**
 * Each way's facts and times for a row (Ruling 20). A pairing figure's are its pairing's own; a verified figure's are
 * its own times with the legs its details state (none without them); nothing else is a trip's, so a calendar figure
 * and a not-current verified one show no pairing's legs, which may be another airport pair's.
 */
function legsOf(
  figure: RowFigure,
  details: VerifiedDetails | null,
  showCarriers: boolean,
): Array<{ name: string; words: string }> {
  const q = figure.pairing;
  if (figure.basis === 'pairing' && q !== null) {
    const out: LegWordsFacts = showCarriers ? q.legs.out : { ...q.legs.out, carriers: undefined };
    const back: LegWordsFacts = showCarriers ? q.legs.back : { ...q.legs.back, carriers: undefined };
    return [
      { name: R.out, words: legWords(out, { depart: q.departOut, arrive: q.arriveOut }) },
      { name: R.back, words: legWords(back, { depart: q.departBack, arrive: q.arriveBack }) },
    ];
  }
  if (figure.basis === 'verified') {
    const none = { durationMinutes: null, stops: null };
    // why: a verified leg's own local date-times give its day mark
    const out = {
      ...(details?.legs.out ?? none),
      arrivesDayOffset: dayOffsetOf(figure.departOut, figure.arriveOut),
    };
    const back = {
      ...(details?.legs.back ?? none),
      arrivesDayOffset: dayOffsetOf(figure.departBack, figure.arriveBack),
    };
    return [
      { name: R.out, words: legWords(out, { depart: figure.departOut, arrive: figure.arriveOut }) },
      { name: R.back, words: legWords(back, { depart: figure.departBack, arrive: figure.arriveBack }) },
    ];
  }
  // why: the grid keeps its columns whatever a row knows of its flights
  return [
    { name: R.out, words: '' },
    { name: R.back, words: '' },
  ];
}

/** The column heads of a list of trip rows, desktop only and hidden from assistive technology (each value names itself). */
export function TripRowHead() {
  return (
    <li className="trip-row trip-row-head" aria-hidden="true">
      <span>{R.head.price}</span>
      <span>{R.head.dates}</span>
      <span>{R.head.nights}</span>
      <span>{R.head.out}</span>
      <span>{R.head.back}</span>
      <span />
    </li>
  );
}

/**
 * Design 2026-11-08 §5.3, Ruling 20: one trip with flights read, as a list item. The price is the booking link (the one
 * target from `rowBookingTarget`, so every surface links the same place) with its label; then the dates, the nights,
 * each way's times, journey time, changes and (on the Search page) airlines, and › to the Trip page. A search with
 * several airports names the pair and links its own trip.
 */
export function TripRow({ figure, details, search, pair, earlierNote = null }: TripRowProps) {
  const target = rowBookingTarget(pair, figure, search.cabin, details?.booking ?? null, search.pointOfSale);
  const pairName = search.multiAirport ? R.pair(figure.origin, figure.destination) : null;
  const legs = legsOf(figure, details, search.showCarriers === true);
  const href = tripHref(
    search.id,
    pair.departureDate,
    pair.returnDate,
    search.multiAirport ? { from: figure.origin, to: figure.destination } : {},
  );
  return (
    <li
      className={earlierNote === null ? 'trip-row' : 'trip-row trip-row-earlier'}
      data-testid="trip-row"
      data-earlier={earlierNote === null ? undefined : 'true'}
    >
      <div className="row-price">
        <BookLink
          target={target}
          price={
            <RowAmount
              figure={figure}
              destinationNote={search.destinationNotes?.[figure.destination] ?? null}
            />
          }
          label={stayDates(pair)}
        />
        <RowLabel figure={figure} note={earlierNote ?? undefined} />
      </div>
      <DatesCell pair={pair} figure={figure} multiAirport={search.multiAirport} />
      <NightsCell nights={pair.nights} />
      {legs.map((l, i) => (
        <div key={l.name} className={i === 0 ? 'row-leg row-out' : 'row-leg row-back'}>
          {l.words === '' ? null : (
            <>
              <span className="row-leg-tag">{l.name}</span> {l.words}
            </>
          )}
        </div>
      ))}
      <a className="row-go" href={href} aria-label={R.detailsFor(stayDates(pair), pairName)}>
        ›
      </a>
    </li>
  );
}
