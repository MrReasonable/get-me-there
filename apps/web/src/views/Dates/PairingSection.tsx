import {
  addDays,
  type FlightLimits,
  fitsLimits,
  type IsoDateTime,
  pairingLeads,
  pairingPrice,
} from '@gmt/core';
import { useId, useState } from 'react';
import type { FlightList } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateWords, formatMinutes } from '../../format.js';
import { FlightPrice } from './FlightRow.js';
import { carriersText, legMarks } from './flightLines.js';
import { allReturnsInOrder, bookingNote, mismatchOf, type PairingView, returnNote } from './pairing.js';
import { ReturnRow } from './ReturnRow.js';

// Spec rev 56 §11 "The pairing section" (WP21 Task 21.7): inside a flights block, after its head, for a list whose
// return read is `read` with returns. It names the outbound the pairing used, shows that outbound ("Out:") with its
// marks and no price, the pairing's return ("Back:") with the cheapest offer's price first and what that price is for,
// then the other returns with their "from" prices, the toggle that shows them all, and the notes that apply. Every
// amount through PriceCell with the list's provenance (FlightPrice); no seller is linked anywhere (booking stays on
// Google, through the date pair's link below the block).

const F = COPY.flights;
const D = COPY.datesView;

/**
 * The section's head (spec rev 56 §11): after a limit edit (the stored limits differ, or today's limits select other
 * outbounds) "With the <which> outbound read, selected under your limits when read, 3d ago:", or "With the cheapest
 * outbound read, over your limits when read, 3d ago:" when no outbound fitted then (21.7 code M13); with no outbound
 * within the limits "With the cheapest outbound read (over your limits):"; with the outbound within them but none of its
 * returns (21.7 code I3, Ian's ruling 2 for returns) "No return flight within your limits for this outbound; the
 * cheapest pairing read is shown, over your limits:"; else "With the cheapest outbound read within your limits:" or the
 * next-cheapest's.
 */
function sectionHead(p: PairingView, list: FlightList, changed: boolean): string {
  const ago = COPY.agoOf(list.ageHours);
  if (changed) return p.outboundFits ? F.pairingHeadWhenRead(p.which, ago) : F.pairingHeadOverWhenRead(ago);
  if (!p.outboundFits) return F.pairingHeadOver;
  return p.fits ? F.pairingHead(p.which) : F.pairingHeadNoReturnFits;
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
 * "1 of the 5 outbounds within your limits were tried; other outbounds not tried", or null (spec rev 56 §11). Every
 * count is judged under the limits the read was made with (21.7 prov-011: the attempts' fits and `triedAll` are the
 * read's), and after a limit edit the line says so ("within your limits when read").
 */
function triedLine(list: FlightList, changed: boolean): string | null {
  const r = list.returns;
  if (r === null || r.triedAll) return null;
  const tried = r.attempts.filter((a) => a.outboundFits).length;
  const within = list.flights.filter((f) => fitsLimits(f, r.limits, 'outbound')).length;
  if (within <= tried) return null;
  return changed ? F.triedSomeWhenRead(tried, within) : F.triedSome(tried, within);
}

/**
 * Spec rev 56 §11: the pairing section of one list (`data-testid="flights-pairing"`, the smoke's selector: preflight
 * A22). `p` is `pairingOf(list, limits)`. The shown "Back:" line comes first, then "this price is for the Out: and Back:
 * flights shown" and the book line (21.7 code M4), then the other returns, in one list named "return flights for the
 * selected outbound"; directly under it "N more returns read, M outside your limits · show all return flights", a
 * button with `aria-expanded` and `aria-controls` whose name never changes (21.7 code M2, ui-007), focus staying on it,
 * and a live region that says how many returns are shown when it is pressed.
 */
export function PairingSection({
  list,
  p,
  limits,
  readNow,
  gridFetchedAt,
  mayLead,
}: {
  list: FlightList;
  p: PairingView;
  limits: FlightLimits;
  /** Final review B-I3: whether a read of this date pair would go now; the notes word what happens next by it. */
  readNow: boolean;
  /** Spec rev 63: when the date pair's grid price was read (null: none to compare), as the board's lead rule reads it. */
  gridFetchedAt: IsoDateTime | null;
  /** Whether the board could lead with this pairing at all (false under a verified figure, as the board keeps it). */
  mayLead: boolean;
}) {
  const [all, setAll] = useState(false);
  // why: 21.7 ui-007: the live region says nothing until the toggle is pressed, then how many returns are shown
  const [pressed, setPressed] = useState(false);
  const listId = useId();
  const attempt = list.returns?.attempts[p.attempt];
  const returns =
    all && attempt !== undefined ? allReturnsInOrder(attempt.returns, p, limits) : p.returns.shown;
  const mismatch = mismatchOf(p);
  const note = bookingNote(list, COPY, readNow);
  // why: 21.7 code M1, prov-010: the counts and more-listed clauses of the view the shown returns come from
  const readNote = returnNote(list, COPY, readNow, p.attempt);
  // why: final review B-I1: the shown seller's price is emphasised as the answer exactly when the board leads with it,
  // by core's one predicate (within the limits, read under today's limits; spec rev 62/63: at any age unless a grid
  // price was read after an older list; design 2026-11-08: whatever its offers, which only decide whose price it is)
  const leads =
    mayLead &&
    pairingLeads(
      {
        fits: p.fits,
        underCurrentLimits: p.underCurrentLimits,
        fresh: list.stale === false,
        fetchedAt: list.fetchedAt,
      },
      gridFetchedAt,
    );
  // why: design 2026-11-08 §4.1: the shown pairing leads with the board's price (`pairingPrice`, the one rule): a
  // seller's when complete offers were read, else Google's "from" price, worded by what was read of the sellers; the
  // incomplete offer's own price stays in the mismatch line below
  const priced = pairingPrice({
    offer: p.offer,
    complete: p.offer?.complete === true,
    fromMinor: p.fromMinor,
  });
  const changed = !p.selectedNow || !p.underCurrentLimits;
  const tried = triedLine(list, changed);
  // why: the price-applies and book lines say what the shown seller's price is for, so they follow its line
  const applies =
    p.offer !== null ? (
      <div className="flight-after">
        <p data-testid="pairing-applies" className="flights-line">
          {F.priceAppliesTo}
        </p>
        <p data-testid="pairing-book" className="flights-line">
          {F.bookOnGoogle}
        </p>
      </div>
    ) : null;
  return (
    <div data-testid="flights-pairing" className="flights-pairing">
      {p.outboundFits || changed ? null : (
        <p data-testid="pairing-no-outbound-fits" className="flights-line">
          {F.noOutboundFits(list.flights.length)}
        </p>
      )}
      <p data-testid="pairing-head" className="flights-head">
        {sectionHead(p, list, changed)}
      </p>
      {changed ? (
        <p data-testid="pairing-limits-changed" className="flights-line">
          {F.limitsChanged}
        </p>
      ) : null}
      <OutLine p={p} list={list} limits={limits} />
      <ul id={listId} className="flights-list" aria-label={F.returnsListName}>
        {returns.map((ret, i) => (
          <ReturnRow
            // why: an attempt's returns have no id; their place in the shown order is stable for one list
            key={i}
            ret={ret}
            list={list}
            limits={limits}
            // why: 21.7 re-review N2, final review B-I1: only the price the board leads with is the lead claim
            lead={ret === p.ret && leads}
            price={
              ret === p.ret && p.offer !== null && priced.kind === 'seller'
                ? { kind: 'offer', offer: p.offer }
                : {
                    kind: 'from',
                    sellers: ret !== p.ret ? null : p.offer === null ? 'unread' : 'incomplete',
                  }
            }
            after={ret === p.ret ? applies : null}
          />
        ))}
      </ul>
      {p.returns.moreRead > 0 ? (
        <p data-testid="pairing-more" className="flights-line">
          {all ? null : F.returnMore(p.returns.moreRead, p.returns.moreOutside)}
          {all ? null : F.separator}
          <button
            type="button"
            className="btn-text"
            aria-expanded={all}
            aria-controls={listId}
            onClick={() => {
              setPressed(true);
              setAll((a) => !a);
            }}
          >
            {F.showAllReturns}
          </button>
          <span data-testid="pairing-returns-status" role="status" className="sr-only">
            {pressed ? F.returnsShown(returns.length, all) : null}
          </span>
        </p>
      ) : null}
      {note !== null ? (
        <p data-testid="pairing-booking-note" className="flights-line">
          {note}
        </p>
      ) : null}
      {mismatch !== null ? (
        <p data-testid="pairing-mismatch" className="flights-line">
          {F.mismatchOffer}{' '}
          <span className="flight-price">
            <FlightPrice list={list} pence={mismatch.offerMinor} />
          </span>
          {F.mismatchFrom}{' '}
          <span className="flight-price">
            {F.from} <FlightPrice list={list} pence={mismatch.fromMinor} />
          </span>
        </p>
      ) : null}
      {readNote !== null ? (
        <p data-testid="pairing-read-note" className="flights-line">
          {readNote}
        </p>
      ) : null}
      {tried !== null ? (
        <p data-testid="pairing-tried" className="flights-line">
          {tried}
        </p>
      ) : null}
    </div>
  );
}
