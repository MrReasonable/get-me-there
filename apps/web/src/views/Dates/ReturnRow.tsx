import { addDays, type FlightLimits, type IsoDate, type ListedReturn } from '@gmt/core';
import type { FlightList } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDateWords, formatMinutes } from '../../format.js';
import { FlightPrice } from './FlightRow.js';
import { carriersText, legMarks } from './flightLines.js';
import type { PairingOffer } from './pairing.js';

// Spec rev 56 §11 "The pairing section" (WP21 Task 21.7): one return flight a return view listed, as FlightRow is one
// outbound, with its price FIRST: the shown pairing's cheapest offer (a seller's stated price, never worded "from"), or
// the return's "from" price (the lowest round-trip price Google listed for the outbound above and this return). Every
// amount through PriceCell with the list's provenance; seller, fare and carrier names are text only.

const F = COPY.flights;
const D = COPY.datesView;

/** What a "Back:" line leads with: an offer's stated price, or the return's "from" price (with "sellers not read"). */
export type BackPrice = { kind: 'offer'; offer: PairingOffer } | { kind: 'from'; sellersNotRead: boolean };

/** The arrival's calendar date: the return date plus the page's day offset, −1 admitted (dates as strings, no zone). */
function arrivalDate(returnDate: IsoDate, r: ListedReturn): IsoDate {
  return addDays(returnDate, r.arrivesDayOffset);
}

/**
 * One return (spec rev 56 §11): "Back: £1,180 · QQ Travel · cheapest of 3 offers read · depart 14:20, arrive 06:25 +1 ·
 * 12h 05m · 1 change · QQ Air" for the shown pairing with an offer read, "Back: from £1,180 · sellers not read · …" for
 * it with none, "Back: from £1,250 · depart …" for every other; an arrival on another day than the return date carries
 * its full date for assistive technology (a "−1" too); its marks against the limits on the line below (no window mark:
 * the definition has no return windows).
 */
export function ReturnRow({
  ret: r,
  list,
  limits,
  price,
}: {
  ret: ListedReturn;
  list: FlightList;
  limits: FlightLimits;
  price: BackPrice;
}) {
  const marks = legMarks('return', r, limits, F);
  return (
    <li data-testid="return" className="flight">
      <span data-testid="return-line">
        {F.back}{' '}
        {price.kind === 'offer' ? (
          <>
            <FlightPrice list={list} pence={price.offer.priceMinor} />
            {F.separator}
            {F.sellerLine(price.offer.seller, price.offer.fare, price.offer.offersRead)}
          </>
        ) : (
          <>
            {F.from} <FlightPrice list={list} pence={r.fromMinor} />
            {price.sellersNotRead ? (
              <>
                {F.separator}
                {F.sellersNotRead}
              </>
            ) : null}
          </>
        )}
        {F.separator}
        {F.returnTimes(r.departsLocal, r.arrivesLocal, r.arrivesDayOffset)}
        {r.arrivesDayOffset !== 0 ? (
          <span className="sr-only">{` ${D.arrivesOn(formatIsoDateWords(arrivalDate(list.returnDate, r)))}`}</span>
        ) : null}
        {F.separator}
        {formatMinutes(r.durationMinutes)}
        {F.separator}
        {F.changes(r.stops)}
        {F.separator}
        {carriersText(r, F)}
      </span>
      {marks.length > 0 ? (
        <span data-testid="return-mark" className="flight-mark">
          {marks.join(F.markJoin)}
        </span>
      ) : null}
    </li>
  );
}
