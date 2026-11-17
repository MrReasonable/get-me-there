import { type BookingTarget, bookingTargetOf } from '@gmt/core';
import { useState } from 'react';
import type { FlightList, TripResponse } from '../../api/types.js';
import { BookLink } from '../../components/BookLink.js';
import { PriceLabel } from '../../components/PriceLabel.js';
import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { labelDetail } from '../../lib/figureLabel.js';
import { carriersText } from '../../lib/flightLines.js';
import { Amount } from './Amount.js';
import { type OtherGroup, type OtherRow, otherFlightsOf } from './model.js';

const T = COPY.trip;
const F = COPY.flights;

const HEADING: Record<OtherGroup['heading'], string> = {
  returns: T.otherReturns,
  'returns-second': T.otherReturnsSecond,
  outbounds: T.otherOutbounds,
};

/** One other flight: its price as a "Find on Google Flights ↗" link named by its times, its label, its leg. */
function Row({ row, list, target }: { row: OtherRow; list: FlightList; target: BookingTarget }) {
  const f = row.flight;
  const out = row.leg === 'outbound';
  const [from, to] = out ? [list.origin, list.destination] : [list.destination, list.origin];
  const name = T.legName(out ? T.out : T.back, f.departsLocal, from, f.arrivesLocal, to);
  const meta = [
    formatMinutes(f.durationMinutes),
    F.changes(f.stops),
    carriersText(f, F),
    ...(out ? [T.returnsNotRead] : []),
  ];
  return (
    <li className="trip-fl" data-testid="other-flight">
      <span className="trip-fl-price">
        <BookLink
          target={target}
          label={name}
          price={<Amount price={{ pricePence: row.pence, provenance: list.provenance, stale: list.stale }} />}
        />
        <PriceLabel
          kind={row.label}
          ageHours={list.ageHours}
          stale={list.stale}
          provenance={list.provenance}
          detail={labelDetail(row.label, null)}
        />
      </span>
      <span className="trip-fl-what">
        <b>
          {out ? T.out : T.back} {f.departsLocal} {from} → {f.arrivesLocal}
          {f.arrivesDayOffset === 0 ? null : (
            <sup className="trip-plus">{T.dayOffset(f.arrivesDayOffset)}</sup>
          )}{' '}
          {to}
        </b>
        <span className="trip-legmeta">{meta.join(F.separator)}</span>
      </span>
    </li>
  );
}

/** A group: its rows within the limits, cheapest first, then one line for the rest with "Show them". */
function Group({ group, list, target }: { group: OtherGroup; list: FlightList; target: BookingTarget }) {
  const [open, setOpen] = useState(false);
  const rows = open ? [...group.shown, ...group.folded] : group.shown;
  const parts = [
    ...(group.over > 0 ? [T.foldedOver(group.over, group.overLimit)] : []),
    ...(group.dearer > 0 ? [T.foldedDearer(group.dearer)] : []),
  ].join(', ');
  const leg = group.heading === 'outbounds' ? 'outbound' : 'return';
  return (
    <div className="trip-fl-group">
      <h3 className="trip-subhead">{HEADING[group.heading]}</h3>
      {rows.length > 0 ? (
        <ul className="trip-fl-list">
          {rows.map((row, i) => (
            <Row key={`${row.leg}-${i}-${row.flight.departsLocal}`} row={row} list={list} target={target} />
          ))}
        </ul>
      ) : null}
      {group.folded.length > 0 && !open ? (
        <p className="trip-fold-line">
          <span>{T.folded(group.folded.length, leg, parts)}</span>{' '}
          <button type="button" className="trip-btn trip-btn-quiet" onClick={() => setOpen(true)}>
            {T.showThem}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Design 2026-11-08 §6.1 "Other flights on these dates": the other flights the card's list read, each with Google's own
 * price and its one label, each linking to the Google Flights search for the dates (no booking page was read for
 * them; a synthetic read links nowhere). Absent with no list, or one with no flights.
 */
export function OtherFlights({ r, synthetic }: { r: TripResponse; synthetic: boolean }) {
  const list = r.flightList;
  const groups = otherFlightsOf(r);
  if (list === null || groups.length === 0) return null;
  const target = bookingTargetOf({ synthetic, booking: null, bookingUrl: null, searchLink: r.searchLink });
  return (
    <section className="trip-section" aria-labelledby="trip-other">
      <h2 id="trip-other" className="trip-h2">
        {T.otherHeading}
      </h2>
      <p className="trip-section-sub">{T.otherSub}</p>
      <div className="trip-card trip-card-list">
        {groups.map((g) => (
          <Group key={g.heading} group={g} list={list} target={target} />
        ))}
      </div>
    </section>
  );
}
