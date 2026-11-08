import {
  type DatePair,
  type DatePairFigure,
  type DatePairPairing,
  rankTierOf,
  stopDetailClause,
} from '@gmt/core';
import { type ReactNode, useId } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatFlapDate, formatIsoDate, formatIsoDateWords, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';
import { detailHref, detailPatch } from '../../state/datesState.js';
import { navigateTo } from '../../state/urlState.js';
import {
  arrival,
  calendarStyled,
  flightReadLine,
  type ListsState,
  pairingKindOf,
  sellerOf,
} from './board.js';
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
  flapSlot?: string | undefined;
}) {
  const p = figure.price;
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={p.pricePence}
        provenance={p.provenance}
        calendar={calendarStyled(figure.basis)}
        // why: spec rev 56 §6.9, design 2026-11-08 §4.1: a pairing figure's source is the browser worker's flight list;
        // its price is a seller's or Google's, said by the kind of the figure's own pairing group
        {...(figure.basis === 'pairing' && figure.pairing !== null
          ? { sourceLabel: D.pairingSource[pairingKindOf(figure.pairing)] }
          : {})}
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
 * Design 2026-11-08 §5.1: a calendar price stands in the secondary style, said as "calendar £565", so a date whose
 * flights were never read does not look like a trip. Other bases show their figure as it is.
 */
export function RowPrice({
  figure,
  notes,
  face = false,
  flapSlot,
}: {
  figure: DatePairFigure;
  notes: DefinitionResponse['destinationNotes'];
  face?: boolean;
  flapSlot?: string | undefined;
}) {
  const price = <FigurePrice figure={figure} notes={notes} face={face} flapSlot={flapSlot} />;
  if (figure.basis !== 'calendar') return price;
  return (
    <span data-testid="calendar-price" className="price-secondary">
      <span className="calendar-word">{D.calendarPrice}</span> {price}
    </span>
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
 * Spec rev 56 §6.9, §11 Board (R-board, R-grid; 21.7 persona H2, ui-005): a pairing figure's own short lines beneath its
 * price: the seller line "QQ Travel · cheapest of 3 offers read", "2nd outbound tried" when the pairing used the second
 * outbound, the two departure times "Out: 07:15 · Back: 14:20", "Google listed from £1,180" where the cheapest offer
 * differs from the return's "from" price, the calendar price it replaced through PriceCell with its own source named
 * first, age and stale mark ("the date grid showed £564 · 10 Mar 09:30", "the Aviasales cache showed …": 21.7
 * prov-003), and "airline settings not applied to flights read" when the search sets any airline or layover setting
 * (`settings`). The group is named by its visible seller and outbound lines, said once (21.7 code M3), and described by
 * the long words of which outbound it used, which the search's page block says in full. Null on another basis.
 */
export function PairingFigureLines({
  figure,
  settings,
  changes = null,
}: {
  figure: DatePairFigure;
  settings: boolean;
  /** The pairing's changes each way, from the flight list the board asked for, or null while there is none. */
  changes?: { out: number; back: number } | null;
}) {
  const now = useNow();
  const id = useId();
  const q = figure.pairing;
  if (figure.basis !== 'pairing' || q === null) return null;
  const second = q.which === 'next-cheapest';
  const g = figure.gridPrice;
  const kind = pairingKindOf(q);
  return (
    // why: a group of the pairing's own lines (R-board); a fieldset is the semantic group element (lint), its
    // form-control styling reset; its name is its own visible lines, so it is said once and seen
    <fieldset
      aria-labelledby={second ? `${id}-seller ${id}-which` : `${id}-seller`}
      aria-describedby={`${id}-long`}
      data-testid="pairing-figure"
      className="m-0 mt-1.5 block min-w-0 space-y-0.5 border-0 p-0 text-xs text-fg-2"
    >
      {kind === 'seller' ? (
        <span id={`${id}-seller`} data-testid="pairing-seller" className="block">
          {/* why: seller and fare are page text, rendered as text only; the figure is never a seller link */}
          {F.sellerLine(sellerOf(q), q.fare, q.offersRead)}
        </span>
      ) : null}
      {/* why: design 2026-11-08 §4.1: whose price it is, in words; a "from" price names no seller, so this branch never
      calls `sellerOf`, and the words are the group's name when there is no seller line */}
      <span id={kind === 'seller' ? undefined : `${id}-seller`} data-testid="pairing-kind" className="block">
        {D.priceKind[kind]}
      </span>
      {second ? (
        <span id={`${id}-which`} data-testid="pairing-which" className="block">
          {D.secondOutboundTried}
        </span>
      ) : null}
      <span hidden id={`${id}-long`}>
        {D.pairingWhich[q.which]}
      </span>
      {/* why: design 2026-11-08 §5.1: when it was read, visible without hover; an older trip that still leads shows it as
      a mark (its age label), so it is never taken for a fresh one */}
      <span
        data-testid="read-age"
        data-older={rankTierOf(figure) === 1 ? '' : undefined}
        className={rankTierOf(figure) === 1 ? 'tag tag-warn block w-fit' : 'block'}
      >
        {D.readAgo(figure.price.ageHours)}
      </span>
      <span data-testid="pairing-times" className="block">
        {D.pairingTimes(q.departOut, q.departBack)}
      </span>
      {changes !== null ? (
        <span data-testid="pairing-changes" className="block">
          {D.pairingChanges(F.changes(changes.out), F.changes(changes.back))}
        </span>
      ) : null}
      {q.mismatch ? (
        <span data-testid="pairing-mismatch" className="flex flex-wrap items-baseline gap-1">
          <span>{D.mismatchMark}</span>
          <PairingPrice pairing={q} pence={q.fromPence} />
        </span>
      ) : null}
      {g !== null ? (
        <span data-testid="pairing-grid" className="flex flex-wrap items-baseline gap-1">
          <span>{D.gridShowed(figureSource(g.provenance, F))}</span>
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
          <span>{D.gridShowedAt(readAt(g.provenance.fetchedAt, now, COPY))}</span>
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
 * through PriceCell with its own age: an offer with its seller (complete offers only; an over-limit pairing's offer too, as the search's page block shows it: 21.7 code I3), or a "from"
 * price, always with "· sellers not read" ("from £1,180 · sellers not read": final review B-M2); "Google listed from £1,180" beneath an offer
 * that differs from its return's "from" price (21.7 code M12, prov-008). Nothing for a pairing figure or a fresh
 * verified one; "flights not read" by `lists` (21.7 prov-004), "loading flights" while the request is pending.
 */
export function FlightRead({ figure, lists }: { figure: DatePairFigure; lists: ListsState }) {
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

/**
 * Journey time (the figure's own, else "not known") and the arrivals the figure's segments state. The phone card
 * (`card`) has no column head, so its unknown time is worded "journey time not known", as a filtered board's is.
 */
export function Journey({
  figure,
  filtered,
  card = false,
}: {
  figure: DatePairFigure;
  filtered: boolean;
  card?: boolean;
}) {
  const m = figure.journeyMinutes;
  return (
    <>
      {m !== null ? (
        <span className="block">
          <span className="sr-only">{formatMinutes(m)}</span>
          <Flaps text={formatMinutes(m)} cells={7} align="right" slot="journey" />
        </span>
      ) : (
        <span className="block text-fg-2">
          {filtered || card ? D.journeyNotKnownFiltered : D.journeyNotKnown}
        </span>
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
 * it. Point of sale is not on the card (it is not a face item). Design 2026-11-08 §5.3: the date pair's flights are the
 * card's last part (`flights`) and show only once the card's button (`toggle`) opens them; the flight read's outcome
 * ("Google's list: from …") sits in that detail, not on the closed card.
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
  flights = null,
  toggle = null,
  lists = 'unavailable',
  settings = false,
  changes = null,
}: {
  pair: DatePair & { figure: DatePairFigure };
  rank: number;
  digits: number;
  howFar: readonly string[];
  notes: DefinitionResponse['destinationNotes'];
  journeyFiltered: boolean;
  lit: boolean;
  onLight: (index: number | null) => void;
  /** The date pair's flights detail (spec rev 55 §11), shown only once opened (design 2026-11-08 §5.3), or null. */
  flights?: ReactNode;
  /** The button that opens and closes the flights detail, or null when there is none to open. */
  toggle?: ReactNode;
  /** The pairing's changes each way (design 2026-11-08 §5.1), or null. */
  changes?: { out: number; back: number } | null;
  /** What the board knows of its flight-lists request (21.7 prov-004: "flights not read" by it). */
  lists?: ListsState;
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
        <RowPrice figure={f} notes={notes} face />
        <PairingFigureLines figure={f} settings={settings} changes={changes} />
        <FlightRead figure={f} lists={lists} />
        {toggle}
      </td>
      <td className="card-rest">
        <StateFlap state={state} />
        <span className="mt-1 block">
          {f.price.truncated ? `${COPY.truncatedNote} · ` : null}
          {howFar.join(' · ')}
        </span>
        <span className="mt-1 block">
          <Journey figure={f} filtered={journeyFiltered} card />
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
