import { type DatePair, type DatePairFigure, pairingKindOf, resultBasisOf } from '@gmt/core';
import { COPY } from '../../copy.js';
import { figureLabelKind, labelDetail } from '../../lib/figureLabel.js';
import { rowDay } from '../../lib/legWords.js';
import { PriceBoundary } from '../PriceBoundary.js';
import { PriceCell } from '../PriceCell.js';
import { PriceLabel } from '../PriceLabel.js';
import { assertProvenance } from '../Provenance.js';
import '../../views/Trip/trip.css';
import './rows.css';

// Ruling 20: the parts a trip row and a calendar row share, so a pair of dates reads the same on both.

const R = COPY.rows;

/** The board's figure of a date pair, or a card's (the wire's, less its airport-pair index): what a row reads. */
export type RowFigure = Omit<DatePairFigure, 'airportPair'>;

/** What a row shows of its date pair. */
export type RowPair = Pick<DatePair, 'departureDate' | 'returnDate' | 'nights'>;

/** The figure's amount alone, calendar-styled for a calendar price (the label beside it says the source and age). */
export function RowAmount({
  figure,
  destinationNote,
}: {
  figure: RowFigure;
  destinationNote: string | null;
}) {
  const p = figure.price;
  return (
    <PriceBoundary>
      <PriceCell
        bare
        pricePence={p.pricePence}
        provenance={p.provenance}
        calendar={resultBasisOf(figure.basis) === 'calendar'}
        stale={p.stale}
        truncated={p.truncated}
        superseded={figure.superseded}
        notSeenInLatestHours={figure.notSeenInLatest?.ageHours ?? null}
        destination={figure.destination}
        destinationNote={destinationNote}
      />
    </PriceBoundary>
  );
}

/**
 * The one label of the figure's price (`figureLabelKind`), its tap detail naming the seller where one was read. A
 * provenance that is not one withholds this row's label (and its price: `RowAmount` has its own boundary), never the page.
 */
export function RowLabel({ figure, note }: { figure: RowFigure; note?: string | undefined }) {
  return (
    <PriceBoundary>
      <ValidLabel figure={figure} note={note} />
    </PriceBoundary>
  );
}

function ValidLabel({ figure, note }: { figure: RowFigure; note: string | undefined }) {
  const q = figure.pairing;
  const kind = figureLabelKind(figure);
  const p = figure.price;
  assertProvenance(p.provenance);
  return (
    <PriceLabel
      kind={kind}
      ageHours={p.ageHours}
      stale={p.stale}
      provenance={p.provenance}
      detail={[
        labelDetail(
          kind,
          kind === 'seller' && figure.basis === 'pairing' && q !== null && q.seller !== null
            ? { name: q.seller, offersRead: q.offersRead }
            : null,
          // why: only a pairing figure's price is its pairing's; a verified figure's pairing is another trip's
          figure.basis === 'pairing' && q !== null ? pairingKindOf(q) : null,
        ),
        // why: an earlier search's trip says so in its detail (the card's, while another search runs)
        ...(note === undefined ? [] : [note]),
      ].join(' ')}
    />
  );
}

/** "Wed 11 Nov → Sat 28 Nov", the stay's dates as a row and its links name it. */
export function stayDates(pair: Pick<RowPair, 'departureDate' | 'returnDate'>): string {
  return COPY.trip.heading(rowDay(pair.departureDate), rowDay(pair.returnDate));
}

/** The dates cell: the airport pair first on a search with several (Ruling 20), the dates, and the nights inline on a phone. */
export function DatesCell({
  pair,
  figure,
  multiAirport,
}: {
  pair: RowPair;
  /** The figure whose airports a multi-airport row names; null for a stay with no price (it names none). */
  figure: Pick<DatePairFigure, 'origin' | 'destination'> | null;
  multiAirport: boolean;
}) {
  return (
    <div className="row-dates">
      {multiAirport && figure !== null ? (
        <span className="row-airports" data-testid="row-airports">
          {R.pair(figure.origin, figure.destination)}
        </span>
      ) : null}
      <b>{stayDates(pair)}</b> <span className="row-nights-inline">{R.nightsInline(pair.nights)}</span>
    </div>
  );
}

/** The nights column (a desktop's own column; a phone has them inline in the dates). */
export function NightsCell({ nights }: { nights: number }) {
  return (
    <div className="row-nights">
      <span className="row-vh">{R.nights} </span>
      {nights}
    </div>
  );
}
