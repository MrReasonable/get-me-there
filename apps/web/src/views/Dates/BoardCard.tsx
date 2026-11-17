import { type DatePairPairing, stopDetailClause } from '@gmt/core';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import type { ListsState } from '../../lib/flightReads.js';
import { flightReadLine, type ReadFigure, sellerOf } from './board.js';

// What outlived the board (design 2026-11-08 Ruling 21): a calendar figure's flight read beneath its price, which the
// Trip page's card shows (`FlightRead`). Every amount renders inside PriceCell.

const D = COPY.datesView;
const F = COPY.flights;

/**
 * A price a pairing carries, through PriceCell's compact face with the flight list's provenance (its stale mark, age);
 * `staleSaid` where the line it sits in already says the stale mark's words.
 */
function PairingPrice({
  pairing,
  pence,
  staleSaid = false,
}: {
  pairing: DatePairPairing;
  pence: number;
  staleSaid?: boolean;
}) {
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={pence}
        provenance={pairing.provenance}
        calendar
        stale={pairing.stale}
        sourceLabel={F.sourceLabel}
        compact
        staleSaid={staleSaid}
      />
    </PriceBoundary>
  );
}

/**
 * Spec rev 56 §6.9, §11 Board (R-heads): what a calendar figure (or a stale verified one, ruling 21.2) says of its date
 * pair's flight read, beneath its price: its words ("return leg not read", "no return flight read", "flights couldn't be
 * read: …", "return flights read 9d ago, older than this search's refresh:", …) and the pairing that does not lead,
 * through PriceCell with its own age: an offer with its seller (complete offers only; an over-limit pairing's offer too, as the search's page block shows it: 21.7 code I3), or a "from"
 * price, always with "· sellers not read" ("from £1,180 · sellers not read": final review B-M2); "Google listed from £1,180" beneath an offer
 * that differs from its return's "from" price (21.7 code M12, prov-008). Nothing for a pairing figure or a fresh
 * verified one; "flights not read" by `lists` (21.7 prov-004), "loading flights" while the request is pending.
 */
export function FlightRead({ figure, lists }: { figure: ReadFigure; lists: ListsState }) {
  // why: the 21.6 ruling: a failed list's cause in words, the browser worker named (as the flights block's note does)
  const line = flightReadLine(figure, lists, COPY, (d) => stopDetailClause(d, 'camoufox', true));
  if (line === null) return null;
  const q = line.pairing;
  // why: an older pairing's lead says "older than this search's refresh:" (board.ts), so its prices show the glyph
  const said = figure.pairingRead === 'within-older';
  return (
    <span data-testid="flight-read" className="mt-1.5 block text-xs text-fg-2">
      {line.lead}
      {q !== null ? (
        <span data-testid="flight-read-pairing" className="flex flex-wrap items-baseline gap-1">
          {q.isFrom ? (
            <>
              <span>{D.fromPrice}</span>
              <PairingPrice pairing={q} pence={q.pricePence} staleSaid={said} />
              {/* why: final review B-M2: every "from" price says what was read of the sellers, as the block's Back
              line; design 2026-11-08: none read, or not every one */}
              <span>
                {F.separator}
                {q.offersRead === 0 ? F.sellersNotRead : F.notEverySellerRead}
              </span>
            </>
          ) : (
            <>
              <PairingPrice pairing={q} pence={q.pricePence} staleSaid={said} />
              <span>
                {F.separator}
                {F.sellerLine(sellerOf(q), q.fare, q.offersRead)}
              </span>
            </>
          )}
          <span className="block w-full">{D.pairingTimes(q.departOut, q.departBack)}</span>
        </span>
      ) : null}
      {q?.mismatch ? (
        <span data-testid="flight-read-mismatch" className="flex flex-wrap items-baseline gap-1">
          <span>{D.mismatchMark}</span>
          <PairingPrice pairing={q} pence={q.fromPence} staleSaid={said} />
        </span>
      ) : null}
    </span>
  );
}
