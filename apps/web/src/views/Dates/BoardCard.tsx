import { type DatePair, type DatePairFigure, type DatePairPairing, stopDetailClause } from '@gmt/core';
import type { ReactNode } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatFlapDate, formatIsoDate, formatIsoDateWords, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';
import { detailHref, detailPatch } from '../../state/datesState.js';
import { navigateTo } from '../../state/urlState.js';
import { arrival, calendarStyled, flightReadLine } from './board.js';
import { figureSource } from './flightLines.js';
import { readAt } from './stateLines.js';

// The pieces a board row and a phone card share (spec §11 Board, Phone): the figure through PriceCell, "cached from £X
// (origin → destination)" through PriceCell, the journey time and the arrivals; spec rev 56 (WP21 Task 21.7) a pairing
// figure's own lines (its seller, its times, which outbound it used, the mismatch mark and the grid price it replaced)
// and a calendar figure's flight read with the pairing beneath it. Every amount renders inside PriceCell.

const D = COPY.datesView;
const F = COPY.flights;

/** The figure's price in PriceCell's row form (or its phone face), with decision 54's marks and the destination note. */
export function FigurePrice({
  figure,
  notes,
  face = false,
  flapSlot,
}: {
  figure: DatePairFigure;
  notes: DefinitionResponse['destinationNotes'];
  face?: boolean;
  /** On the board: the amount on flap cells that flip in this slot. */
  flapSlot?: string;
}) {
  const p = figure.price;
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={p.pricePence}
        provenance={p.provenance}
        calendar={calendarStyled(figure.basis)}
        // why: spec rev 56 §6.9: a pairing figure's source is the browser worker's flight list, the lowest seller price
        // read for these two flights
        {...(figure.basis === 'pairing' ? { sourceLabel: D.pairingSource } : {})}
        stale={p.stale}
        truncated={p.truncated}
        superseded={figure.superseded}
        notSeenInLatestHours={figure.notSeenInLatest?.ageHours ?? null}
        destination={figure.destination}
        destinationNote={notes[figure.destination] ?? null}
        face={face}
        flaps={flapSlot !== undefined}
        flapSlot={flapSlot}
      />
    </PriceBoundary>
  );
}

/**
 * Decision 38: a verified figure that hides a cheaper current calendar price says "cached from £X", through PriceCell
 * with its own destination, truncated and stale marks, and its own airport pair named (revision 50).
 */
export function CheaperCached({
  figure,
  notes,
}: {
  figure: DatePairFigure;
  notes: DefinitionResponse['destinationNotes'];
}) {
  const c = figure.cheaperCached;
  if (c === null) return null;
  return (
    <span
      className="mt-1.5 flex flex-wrap items-baseline gap-1 text-xs text-fg-2"
      data-testid="cheaper-cached"
    >
      <span>{D.cachedFrom}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={c.pricePence}
          provenance={c.provenance}
          calendar
          stale={c.stale}
          truncated={c.truncated}
          destination={c.destination}
          destinationNote={notes[c.destination] ?? null}
          compact
        />
      </PriceBoundary>
      <span>{D.cachedFromPair(c.origin, c.destination)}</span>
    </span>
  );
}

/** A price a pairing carries, through PriceCell's compact face with the flight list's provenance (its stale mark, age). */
function PairingPrice({ pairing, pence }: { pairing: DatePairPairing; pence: number }) {
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={pence}
        provenance={pairing.provenance}
        calendar
        stale={pairing.stale}
        sourceLabel={F.sourceLabel}
        compact
      />
    </PriceBoundary>
  );
}

/**
 * Spec rev 56 §6.9, §11 Board (R-board, R-grid): a pairing figure's own lines beneath its price, labelled once by which
 * outbound it used ("cheapest of 3 offers read, next-cheapest outbound read within your limits (…)"): the seller line
 * "QQ Travel · cheapest of 3 offers read", the two departure times "Out 07:15 · Back 14:20", "Google listed from £1,180"
 * where the cheapest offer differs from the return's "from" price, the date-grid price it replaced through PriceCell
 * with its own source, age and stale mark ("date grid showed £564 · the date grid, 10 Mar 09:30"), and "airline settings
 * not applied to flights read" when the search sets any airline or layover setting (`settings`). Null on another basis.
 */
export function PairingFigureLines({ figure, settings }: { figure: DatePairFigure; settings: boolean }) {
  const now = useNow();
  const q = figure.pairing;
  if (figure.basis !== 'pairing' || q === null) return null;
  const which = D.pairingWhich[q.which];
  const g = figure.gridPrice;
  return (
    // why: a group of the pairing's own lines, named once by which outbound it used (R-board); a fieldset is the
    // semantic group element, its form-control styling reset
    <fieldset
      aria-label={D.pairingLabel(q.offersRead, which)}
      data-testid="pairing-figure"
      className="m-0 mt-1.5 block min-w-0 space-y-0.5 border-0 p-0 text-xs text-fg-2"
    >
      <span data-testid="pairing-seller" className="block">
        {/* why: seller and fare are page text, rendered as text only; the figure is never a seller link */}
        {F.sellerLine(q.seller ?? '', q.fare, q.offersRead)}
      </span>
      <span className="block">{which}</span>
      <span data-testid="pairing-times" className="block">
        {D.pairingTimes(q.departOut, q.departBack)}
      </span>
      {q.mismatch ? (
        <span data-testid="pairing-mismatch" className="flex flex-wrap items-baseline gap-1">
          <span>{D.mismatchMark}</span>
          <PairingPrice pairing={q} pence={q.fromPence} />
        </span>
      ) : null}
      {g !== null ? (
        <span data-testid="pairing-grid" className="flex flex-wrap items-baseline gap-1">
          <span>{D.gridShowed}</span>
          <PriceBoundary>
            <PriceCell
              pricePence={g.pricePence}
              provenance={g.provenance}
              calendar
              stale={g.stale}
              truncated={g.truncated}
              compact
            />
          </PriceBoundary>
          <span>
            {D.gridShowedAt(figureSource(g.provenance, F), readAt(g.provenance.fetchedAt, now, COPY))}
          </span>
        </span>
      ) : null}
      {settings ? (
        <span data-testid="pairing-settings" className="block">
          {F.settingsNotApplied}
        </span>
      ) : null}
    </fieldset>
  );
}

/**
 * Spec rev 56 §6.9, §11 Board (R-heads): what a calendar figure (or a stale verified one, ruling 21.2) says of its date
 * pair's flight read, beneath its price: its words ("return leg not read", "no return flight read", "flights couldn't be
 * read: …", "return flights read 9d ago, older than this search's refresh:", …) and the pairing that does not lead,
 * through PriceCell with its own age: an offer with its seller ("a cheaper seller may not have been read" when its offers
 * may be incomplete), or a "from" price ("from £1,180 · sellers not read" when no seller was read for it). Nothing for a
 * pairing figure or a fresh verified one; "flights not read" only where flight lists are read for this search.
 */
export function FlightRead({ figure, available }: { figure: DatePairFigure; available: boolean }) {
  // why: the 21.6 ruling: a failed list's cause in words, the browser worker named (as the flights block's note does)
  const line = flightReadLine(figure, available, COPY, (d) => stopDetailClause(d, 'camoufox', true));
  if (line === null) return null;
  const q = line.pairing;
  return (
    <span data-testid="flight-read" className="mt-1.5 block text-xs text-fg-2">
      {line.lead}
      {q !== null ? (
        <span data-testid="flight-read-pairing" className="flex flex-wrap items-baseline gap-1">
          {q.isFrom ? (
            <>
              <span>{D.fromPrice}</span>
              <PairingPrice pairing={q} pence={q.pricePence} />
              {figure.pairingRead === 'sellers-not-read' ? (
                <span>
                  {F.separator}
                  {F.sellersNotRead}
                </span>
              ) : null}
            </>
          ) : (
            <>
              <PairingPrice pairing={q} pence={q.pricePence} />
              <span>
                {F.separator}
                {F.sellerLine(q.seller ?? '', q.fare, q.offersRead)}
                {q.complete ? null : `${F.separator}${F.offersIncomplete}`}
              </span>
            </>
          )}
          <span className="block w-full">{D.pairingTimes(q.departOut, q.departBack)}</span>
        </span>
      ) : null}
    </span>
  );
}

/** One direction's "arrives HH:MM", with "+1" and the date in words for assistive technology when it is a later day. */
export function Arrives({
  label,
  depart,
  arrive,
}: {
  label: string;
  depart: string | null;
  arrive: string | null;
}) {
  const a = arrival(depart, arrive);
  if (a === null) return null;
  return (
    <span className="block text-xs text-fg-2" data-testid="arrives">
      {label}
      {': '}
      {D.arrives(a.time, a.dayOffset)}
      {a.dayOffset > 0 ? (
        <span className="sr-only">{` ${D.arrivesOn(formatIsoDateWords(a.date))}`}</span>
      ) : null}
    </span>
  );
}

/** Journey time (the figure's own, else "not known") and the arrivals the figure's segments state. */
export function Journey({ figure, filtered }: { figure: DatePairFigure; filtered: boolean }) {
  const m = figure.journeyMinutes;
  return (
    <>
      {m !== null ? (
        <span className="block">
          <span className="sr-only">{formatMinutes(m)}</span>
          <Flaps text={formatMinutes(m)} cells={7} align="right" slot="journey" />
        </span>
      ) : (
        <span className="block text-fg-2">{filtered ? D.journeyNotKnownFiltered : D.journeyNotKnown}</span>
      )}
      <Arrives label={D.directionOut} depart={figure.departOut} arrive={figure.arriveOut} />
      <Arrives label={D.directionBack} depart={figure.departBack} arrive={figure.arriveBack} />
    </>
  );
}

/** A row's state on the board: its lamp, its glyph flap and its ink; the words beside it say the same. */
export type RowState = 'verified' | 'calendar' | 'stale' | 'superseded';
export function rowState(f: DatePairFigure): RowState {
  if (f.superseded || f.notSeenInLatest !== null) return 'superseded';
  if (f.price.stale) return 'stale';
  // why: spec rev 56 §6.9: a pairing figure is never checked with the airline, so it burns as a calendar price does
  return calendarStyled(f.basis) ? 'calendar' : 'verified';
}
const LAMP: Readonly<Record<RowState, string>> = {
  verified: 'white',
  calendar: 'amber',
  stale: 'amber',
  superseded: 'hollow',
};

/** The row's lamp and its rank on flaps; the rank in words is beside them. */
export function RankFlaps({ rank, state, digits }: { rank: number; state: RowState; digits: number }) {
  return (
    <span className="row-head">
      <span aria-hidden="true" className="lamp-dot" data-lamp={LAMP[state]} />
      <span className="sr-only">{rank}</span>
      <Flaps text={String(rank).padStart(2, '0')} cells={digits} align="right" slot="rank" />
    </span>
  );
}

/**
 * The row's state on the board's flaps: its glyph, then its word (VERIFIED, NOT CHECKED, STALE, SUPERSEDED), in the
 * state's own ink; how far checked says it in full beside them, so the flaps are decorative.
 */
export function StateFlap({ state }: { state: RowState }) {
  return (
    <span aria-hidden="true" className="state-flaps howfar-flap">
      <StateGlyph state={state} />
      <Flaps text={D.stateFlap[state]} cells={11} slot="state" />
    </span>
  );
}

/** The state glyph on one flap: ✓ verified, ○ calendar price, ◷ stale, – superseded. */
function StateGlyph({ state }: { state: RowState }) {
  return (
    <span className="flaps">
      <span className="f f-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          {state === 'verified' ? <polyline points="5 12.5 10 17.5 19.5 6.5" /> : null}
          {state === 'calendar' ? <circle cx="12" cy="12" r="6.5" /> : null}
          {state === 'stale' ? (
            <>
              <circle cx="12" cy="12" r="7.5" />
              <polyline points="12 7.5 12 12 15 14" />
            </>
          ) : null}
          {state === 'superseded' ? <line x1="5" y1="12" x2="19" y2="12" /> : null}
        </svg>
      </span>
    </span>
  );
}

/**
 * Spec §11 Phone: a stacked card, the board's row below 900 px (the same table, its roles kept explicitly): the dates
 * and the price lead (PriceCell's phone face: provider mark, destination, short age, "not checked" on a calendar
 * price, "≈" on a converted one), then how far checked ("cheapest of the rows read" on a truncated figure), then
 * journey time and arrivals, then airports. Its dates are the link to the detail; a tap anywhere on the card follows
 * it. Point of sale is not on the card (it is not a face item). WP20 Task 20.10: the flight read's outcome sits beside
 * the price (`outcome`) and the date pair's flights block is the card's last part (`flights`), spec rev 55 §11.
 */
export function BoardCard({
  pair,
  rank,
  digits,
  howFar,
  notes,
  journeyFiltered,
  lit,
  onLight,
  outcome = null,
  flights = null,
  available = false,
  settings = false,
}: {
  pair: DatePair & { figure: DatePairFigure };
  rank: number;
  digits: number;
  howFar: readonly string[];
  notes: DefinitionResponse['destinationNotes'];
  journeyFiltered: boolean;
  lit: boolean;
  onLight: (index: number | null) => void;
  /** The flight read's outcome beside the price (spec rev 55 §6.9), or null. */
  outcome?: ReactNode;
  /** The date pair's flights block (spec rev 55 §11), or null when there is none. */
  flights?: ReactNode;
  /** Flight lists are read for this search (spec rev 56 §11: "flights not read" is said only then). */
  available?: boolean;
  /** The search sets an airline or layover setting (a pairing figure says they are not applied). */
  settings?: boolean;
}) {
  const f = pair.figure;
  const state = rowState(f);
  const open = navigateTo(detailPatch(pair));
  return (
    <tr
      data-pair={pair.index}
      data-testid="board-card"
      data-state={state}
      data-lit={lit ? '' : undefined}
      onClick={(e) => {
        if (e.target instanceof Element && e.target.closest('a, button') !== null) return;
        open(e);
      }}
    >
      <th scope="row" className="card-dates">
        <span className="flex items-center gap-2">
          <RankFlaps rank={rank} state={state} digits={digits} />
          <a
            href={detailHref(pair)}
            onClick={open}
            onFocus={() => onLight(pair.index)}
            onBlur={() => onLight(null)}
            className="card-link"
          >
            <span className="sr-only">
              {COPY.dateRange(formatIsoDate(pair.departureDate), formatIsoDate(pair.returnDate), pair.nights)}
            </span>
            <span aria-hidden="true" className="card-flap-dates">
              <Flaps text={formatFlapDate(pair.departureDate)} slot="dep" />
              <Flaps text={formatFlapDate(pair.returnDate)} slot="ret" />
            </span>
          </a>
        </span>
      </th>
      <td className="card-price">
        <FigurePrice figure={f} notes={notes} face />
        <PairingFigureLines figure={f} settings={settings} />
        <FlightRead figure={f} available={available} />
        {outcome}
      </td>
      <td className="card-rest">
        <StateFlap state={state} />
        <span className="mt-1 block">
          {f.price.truncated ? `${COPY.truncatedNote} · ` : null}
          {howFar.join(' · ')}
        </span>
        <span className="mt-1 block">
          <Journey figure={f} filtered={journeyFiltered} />
        </span>
        <span className="mt-1 block">{D.airports(f.origin, f.destination)}</span>
      </td>
      {flights !== null ? (
        <td className="card-flights" data-flights-for={pair.index}>
          {flights}
        </td>
      ) : null}
    </tr>
  );
}
