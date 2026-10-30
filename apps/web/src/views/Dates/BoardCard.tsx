import type { DatePair, DatePairFigure } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatFlapDate, formatIsoDate, formatIsoDateWords, formatMinutes } from '../../format.js';
import { detailHref, detailPatch } from '../../state/datesState.js';
import { navigateTo } from '../../state/urlState.js';
import { arrival } from './board.js';

// The pieces a board row and a phone card share (spec §11 Board, Phone): the figure through PriceCell, "cached from £X
// (origin → destination)" through PriceCell, the journey time and the arrivals. Every amount renders inside PriceCell.

const D = COPY.datesView;

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
        calendar={figure.basis === 'calendar'}
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
  return f.basis === 'verified' ? 'verified' : 'calendar';
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

/** The state glyph on one flap: ✓ verified, ○ calendar price, ◷ stale, – superseded (each also said in words). */
export function StateFlap({ state }: { state: RowState }) {
  return (
    <span aria-hidden="true" className="flaps howfar-flap">
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
 * it. Point of sale is not on the card (it is not a face item).
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
}: {
  pair: DatePair & { figure: DatePairFigure };
  rank: number;
  digits: number;
  howFar: readonly string[];
  notes: DefinitionResponse['destinationNotes'];
  journeyFiltered: boolean;
  lit: boolean;
  onLight: (index: number | null) => void;
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
      </td>
      <td className="card-rest">
        <span className="flex items-start gap-2">
          <StateFlap state={state} />
          <span>
            {f.price.truncated ? `${COPY.truncatedNote} · ` : null}
            {howFar.join(' · ')}
          </span>
        </span>
        <span className="mt-1 block">
          <Journey figure={f} filtered={journeyFiltered} />
        </span>
        <span className="mt-1 block">{D.airports(f.origin, f.destination)}</span>
      </td>
    </tr>
  );
}
