import { addDays, type FlightLimits, fitsLimits } from '@gmt/core';
import { useState } from 'react';
import type { FlightList } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateWords, formatMinutes } from '../../format.js';
import { FlightPrice } from './FlightRow.js';
import { carriersText, legMarks } from './flightLines.js';
import { allReturnsInOrder, bookingNote, mismatchOf, type PairingView, returnNote } from './pairing.js';
import { ReturnRow } from './ReturnRow.js';

// Spec rev 56 §11 "The pairing section" (WP21 Task 21.7): inside a flights block, after its head, for a list whose
// return read is `read` with returns. It names the outbound the pairing used, shows that outbound ("Out:") with its
// marks and no price, the pairing's return ("Back:") with the cheapest offer's price first, then the other returns with
// their "from" prices, and the notes that apply. Every amount through PriceCell with the list's provenance (FlightPrice);
// no seller is linked anywhere (booking stays on Google, through the date pair's link below the block).

const F = COPY.flights;
const D = COPY.datesView;

/**
 * The section's head (spec rev 56 §11): after a limit edit (the stored limits differ, or today's limits select other
 * outbounds) "With the <which> outbound read, selected under your limits when read, 3d ago:"; with no outbound within the
 * limits "With the cheapest outbound read (over your limits):"; else "With the cheapest outbound read within your
 * limits:" or the next-cheapest's.
 */
function sectionHead(p: PairingView, list: FlightList): string {
  if (!p.selectedNow || !p.underCurrentLimits)
    return F.pairingHeadWhenRead(p.which, COPY.agoOf(list.ageHours));
  return p.outboundFits ? F.pairingHead(p.which) : F.pairingHeadOver;
}

/** The pairing's outbound: "Out: depart 07:15, arrive 18:05 · 14h 50m · 1 change · QQ Air", its marks below, no price. */
function OutLine({ p, list, limits }: { p: PairingView; list: FlightList; limits: FlightLimits }) {
  const f = p.outbound;
  const marks = legMarks('outbound', f, limits, F, true);
  return (
    <p data-testid="pairing-out" className="flight">
      <span data-testid="pairing-out-line">
        {F.out} {F.times(f.departsLocal, f.arrivesLocal, f.arrivesDayOffset)}
        {f.arrivesDayOffset > 0 ? (
          <span className="sr-only">
            {` ${D.arrivesOn(formatIsoDateWords(addDays(list.departureDate, f.arrivesDayOffset)))}`}
          </span>
        ) : null}
        {F.separator}
        {formatMinutes(f.durationMinutes)}
        {F.separator}
        {F.changes(f.stops)}
        {F.separator}
        {carriersText(f, F)}
      </span>
      {marks.length > 0 ? (
        <span data-testid="pairing-out-mark" className="flight-mark">
          {marks.join(F.markJoin)}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Spec rev 56 §11: the pairing section of one list (`data-testid="flights-pairing"`, the smoke's selector: preflight
 * A22). `p` is `pairingOf(list, limits)`; the toggle "show all return flights" (a button with `aria-expanded`) lists
 * every return of the pairing's attempt, the pairing's first, in the chooser's order; focus stays on it.
 */
export function PairingSection({
  list,
  p,
  limits,
}: {
  list: FlightList;
  p: PairingView;
  limits: FlightLimits;
}) {
  const [all, setAll] = useState(false);
  const attempt = list.returns?.attempts[p.attempt];
  const returns =
    all && attempt !== undefined ? allReturnsInOrder(attempt.returns, p, limits) : p.returns.shown;
  const mismatch = mismatchOf(p);
  const note = bookingNote(list, COPY);
  const readNote = returnNote(list, COPY);
  const r = list.returns;
  const tried = r?.attempts.filter((a) => a.outboundFits).length ?? 0;
  const within = list.flights.filter((f) => fitsLimits(f, limits, 'outbound')).length;
  const changed = !p.selectedNow || !p.underCurrentLimits;
  return (
    <div data-testid="flights-pairing" className="flights-pairing">
      {p.outboundFits ? null : (
        <p data-testid="pairing-no-outbound-fits" className="flights-line">
          {F.noOutboundFits(list.flights.length)}
        </p>
      )}
      <p data-testid="pairing-head" className="flights-head">
        {sectionHead(p, list)}
      </p>
      {changed ? (
        <p data-testid="pairing-limits-changed" className="flights-line">
          {F.limitsChanged}
        </p>
      ) : null}
      <OutLine p={p} list={list} limits={limits} />
      <ul className="flights-list">
        {returns.map((ret, i) => (
          <ReturnRow
            // why: an attempt's returns have no id; their place in the shown order is stable for one list
            key={i}
            ret={ret}
            list={list}
            limits={limits}
            price={
              ret === p.ret && p.offer !== null
                ? { kind: 'offer', offer: p.offer }
                : { kind: 'from', sellersNotRead: ret === p.ret }
            }
          />
        ))}
      </ul>
      {p.offer !== null ? (
        <>
          <p data-testid="pairing-applies" className="flights-line">
            {F.priceAppliesTo}
          </p>
          <p data-testid="pairing-book" className="flights-line">
            {F.bookOnGoogle}
          </p>
        </>
      ) : null}
      {p.offer !== null && !p.offer.complete ? (
        <p data-testid="pairing-incomplete" className="flights-line">
          {F.offersIncomplete}
        </p>
      ) : null}
      {note !== null ? (
        <p data-testid="pairing-booking-note" className="flights-line">
          {note}
        </p>
      ) : null}
      {mismatch !== null ? (
        <p data-testid="pairing-mismatch" className="flights-line">
          {F.mismatchOffer} <FlightPrice list={list} pence={mismatch.offerMinor} />
          {F.mismatchFrom} {F.from} <FlightPrice list={list} pence={mismatch.fromMinor} />
        </p>
      ) : null}
      {p.returns.moreRead > 0 ? (
        <p data-testid="pairing-more" className="flights-line">
          {all ? null : F.returnMore(p.returns.moreRead, p.returns.moreOutside)}
          {all ? null : F.separator}
          <button type="button" className="btn-text" aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? F.showFewerReturns : F.showAllReturns}
          </button>
        </p>
      ) : null}
      {readNote !== null ? (
        <p data-testid="pairing-read-note" className="flights-line">
          {readNote}
        </p>
      ) : null}
      {r !== null && r !== undefined && !r.triedAll && within > tried ? (
        <p data-testid="pairing-tried" className="flights-line">
          {F.triedSome(tried, within)}
        </p>
      ) : null}
    </div>
  );
}
