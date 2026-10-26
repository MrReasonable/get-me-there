import type { DatePair, DatePairFigure } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatIsoDateWords, formatMinutes } from '../../format.js';
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
}: {
  figure: DatePairFigure;
  notes: DefinitionResponse['destinationNotes'];
  face?: boolean;
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
    <span className="flex flex-wrap items-baseline gap-1 text-xs" data-testid="cheaper-cached">
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
    <span className="block text-xs" data-testid="arrives">
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
  return (
    <>
      <span className="block">
        {figure.journeyMinutes !== null
          ? formatMinutes(figure.journeyMinutes)
          : filtered
            ? D.journeyNotKnownFiltered
            : D.journeyNotKnown}
      </span>
      <Arrives label={D.directionOut} depart={figure.departOut} arrive={figure.arriveOut} />
      <Arrives label={D.directionBack} depart={figure.departBack} arrive={figure.arriveBack} />
    </>
  );
}

/**
 * Spec §11 Phone: a stacked card, the whole card a link to the detail: the dates and the price lead (PriceCell's phone
 * face: provider mark, destination, short age, "not checked" on a calendar price, "≈" on a converted one), then how
 * far checked ("cheapest of the rows read" on a truncated figure), then journey time and arrivals, then airports.
 * Point of sale is not on the card (it is not a face item).
 */
export function BoardCard({
  pair,
  rank,
  howFar,
  notes,
  journeyFiltered,
  lit,
  onLight,
}: {
  pair: DatePair & { figure: DatePairFigure };
  rank: number;
  howFar: readonly string[];
  notes: DefinitionResponse['destinationNotes'];
  journeyFiltered: boolean;
  lit: boolean;
  onLight: (index: number | null) => void;
}) {
  const f = pair.figure;
  return (
    <li data-pair={pair.index} data-testid="board-card" data-lit={lit ? '' : undefined}>
      <a
        href={detailHref(pair)}
        onClick={navigateTo(detailPatch(pair))}
        onFocus={() => onLight(pair.index)}
        onBlur={() => onLight(null)}
        className={`block rounded border border-slate-400 p-2 ${lit ? 'outline outline-2 outline-black' : ''}`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold">
            <span className="mr-1 text-slate-700">{rank}</span>
            {COPY.dateRange(formatIsoDate(pair.departureDate), formatIsoDate(pair.returnDate), pair.nights)}
          </span>
          <FigurePrice figure={f} notes={notes} face />
        </span>
        <span className="block text-xs">
          {f.price.truncated ? `${COPY.truncatedNote} · ` : null}
          {howFar.join(' · ')}
        </span>
        <span className="block text-xs">
          <Journey figure={f} filtered={journeyFiltered} />
        </span>
        <span className="block text-xs">{D.airports(f.origin, f.destination)}</span>
      </a>
    </li>
  );
}
