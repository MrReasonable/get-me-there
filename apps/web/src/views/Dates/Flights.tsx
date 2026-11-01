import { type DatePairFigure, type FlightLimits, stopDetailClause } from '@gmt/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useFlightLists, useFlightRead } from '../../api/flights.js';
import type { FlightList, FlightListsResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { FlightPrice, FlightRow } from './FlightRow.js';
import {
  allInOrder,
  cheapestRead,
  datesShort,
  type FlightPair,
  figureSource,
  googleFlightsHref,
  hasFlightsBlock,
  headLine,
  listNote,
  offersRead,
  outcomeOf,
  pagesLeftClause,
  pairKey,
  shownOf,
} from './flightLines.js';
import { readAt } from './stateLines.js';

// Spec rev 55 §11 "Flights", §6.9 and §2 (WP20 Task 20.10): a search's page's flights. The board asks for the flight
// lists of the date pairs it shows (useBoardFlights), states each read's outcome beside the figure (FlightOutcome) and
// shows each date pair's flights block below its row (FlightsBlock). A flight read never changes a date pair's price,
// rank or coverage: nothing here touches the figure.

const F = COPY.flights;

/** A date pair being read on demand: the press's, or the one the api says it is reading. */
interface Reading {
  key: string;
  pair: { departureDate: string; returnDate: string };
  /** The figure's list id when pressed (null: none), so the newer list is seen when it lands. */
  listId: number | null;
  /** When the press was accepted (ms), or null while the POST is in flight; null too for the api's own reading. */
  acceptedAt: number | null;
}

/** What the board knows of its flights: every asked pair's entry, the answer's facts, and the read controls. */
export interface BoardFlights {
  byKey: ReadonlyMap<string, FlightPair>;
  /** The newest answer's facts (spec rev 55 §10), or null before any answer. */
  meta: Omit<FlightListsResponse, 'pairs'> | null;
  /** The date pair being read now (the press's or the api's), by key, or null. */
  readingKey: string | null;
  /**
   * What a block's live region says, by the key it is for (finding 3): a refused press's words, or that the pressed read
   * ended ("Flights read for 14 → 24 Mar").
   */
  said: { key: string; words: string } | null;
  read: (pair: { departureDate: string; returnDate: string }) => void;
}

/**
 * Why flight lists cannot be read here, in words (spec rev 55 §11; rulings A33, R-cabin): the economy-only line for a
 * search in another cabin, else the worker's line.
 */
function unavailableWords(reason: unknown): string {
  return reason === 'cabin' ? F.unavailableCabin : F.unavailable;
}

/** A refused read's words (spec rev 55 §11; finding 5): the api's code and its reason, never its message text. */
export function refusalWords(e: unknown): string {
  if (!(e instanceof ApiError)) return F.readFailed;
  switch (e.code) {
    case 'browser_busy':
      return F.busy;
    case 'fresh':
      return F.fresh;
    case 'not_available':
      return unavailableWords(e.details?.reason);
    case 'outside_space':
      return F.outsideSpace;
    case 'no_price':
      return F.noPrice;
    default:
      return F.readFailed;
  }
}

/**
 * Spec rev 55 §11: the board's flight lists, one request per page of `pages`, and the read on demand. While a read is
 * going (pressed here, or the api's `reading`) every page is re-read each POLL_MS; the press clears when the pair's
 * newer list lands, or when an answer after the press says nothing is being read (the read ended with no list).
 */
export function useBoardFlights(definitionId: string, pages: readonly (readonly string[])[]): BoardFlights {
  const [pressed, setPressed] = useState<Reading | null>(null);
  const [said, setSaid] = useState<{ key: string; words: string } | null>(null);
  const [polling, setPolling] = useState(false);
  const lists = useFlightLists(definitionId, pages, polling);
  const mutation = useFlightRead(definitionId);
  const byKey = useMemo(() => {
    const m = new Map<string, FlightPair>();
    for (const a of lists.answers) for (const p of a.pairs) m.set(pairKey(p), p);
    return m;
  }, [lists.answers]);
  const newest = lists.answers.at(-1) ?? null;
  const apiReading = lists.answers.find((a) => a.reading !== null)?.reading ?? null;
  const readingKey = pressed?.key ?? (apiReading === null ? null : pairKey(apiReading));
  const pressedList = pressed === null ? null : (byKey.get(pressed.key)?.list ?? null);
  useEffect(() => setPolling(readingKey !== null), [readingKey]);
  useEffect(() => {
    if (pressed === null || pressed.acceptedAt === null) return;
    // why: the newer list has landed, or an answer read after the press says no read is going (it ended with none)
    const landed = (pressedList?.id ?? null) !== pressed.listId;
    if (!landed && !(lists.fetchedAt > pressed.acceptedAt && apiReading === null)) return;
    const dates = datesShort(pressed.pair.departureDate, pressed.pair.returnDate, F);
    setSaid({
      key: pressed.key,
      words: landed && pressedList?.status === 'read' ? F.readDone(dates) : F.readNotDone(dates),
    });
    setPressed(null);
  }, [pressed, pressedList, lists.fetchedAt, apiReading]);
  const meta =
    newest === null
      ? null
      : {
          available: newest.available,
          unavailableReason: newest.unavailableReason,
          refreshHours: newest.refreshHours,
          monthlyPagesLeft: newest.monthlyPagesLeft,
          runPages: newest.runPages,
          reading: apiReading,
        };
  const read = (of: { departureDate: string; returnDate: string }) => {
    // why: the request body is exactly the contract's two dates (a strict object), never the board's whole row
    const pair = { departureDate: of.departureDate, returnDate: of.returnDate };
    const key = pairKey(pair);
    const listId = byKey.get(key)?.list?.id ?? null;
    setSaid(null);
    setPressed({ key, pair, listId, acceptedAt: null });
    mutation.mutate(pair, {
      onSuccess: () => setPressed({ key, pair, listId, acceptedAt: Date.now() }),
      onError: (e) => {
        setPressed(null);
        setSaid({ key, words: refusalWords(e) });
      },
    });
  };
  return { byKey, meta, readingKey, said, read };
}

/**
 * The read's outcome on the date pair's main line, beside the figure (spec rev 55 §6.9; ruling persona-003): "Google's
 * list: from £92, 11:44", "not in Google's list" or "Google's list showed no flights", from the figure's own airport
 * pair's list only (prov-r2-004); nothing when flight lists are not available here, or the pair has no read list.
 */
export function FlightOutcome({ entry, available }: { entry: FlightPair | undefined; available: boolean }) {
  const now = useNow();
  const list = entry?.list ?? null;
  const o = available ? outcomeOf(list, now, COPY) : null;
  if (o === null || list === null) return null;
  return (
    <span data-testid="flight-outcome" className="flight-outcome">
      {o.kind === 'from' ? (
        <>
          {F.outcomeFrom} <FlightPrice list={list} pence={o.minMinor} />
          {F.outcomeAt(o.when)}
        </>
      ) : o.kind === 'not-in' ? (
        F.notInList
      ) : (
        F.showedNone
      )}
    </span>
  );
}

/**
 * The difference line (spec rev 55 §6.9; po-012, prov-r2-005): when the list's cheapest flight read differs from the
 * figure, both amounts through PriceCell, both instants in the one form, the figure's side named from its own
 * provenance; and when Google's Cheapest tab showed less than was read, that it showed a lower fare it could not read.
 */
function DifferenceLine({ list, figure }: { list: FlightList; figure: DatePairFigure }) {
  const now = useNow();
  const min = cheapestRead(list);
  if (min === null || min === figure.price.pricePence) return null;
  const p = figure.price.provenance;
  return (
    <p data-testid="flights-difference" className="flights-line">
      {F.differenceRead} <FlightPrice list={list} pence={min} />{' '}
      {F.differenceCheapest(readAt(list.fetchedAt, now, COPY))} {F.differenceSource(figureSource(p, F))}{' '}
      <PriceBoundary>
        <PriceCell
          pricePence={figure.price.pricePence}
          provenance={p}
          calendar={figure.basis === 'calendar'}
          stale={figure.price.stale}
          truncated={figure.price.truncated}
          destination={figure.destination}
          compact
        />
      </PriceBoundary>
      {F.differenceAt(readAt(p.fetchedAt, now, COPY))}
      {list.tabMinor !== null && list.tabMinor < min ? (
        <>
          {' '}
          {F.lowerFare}
          <FlightPrice list={list} pence={list.tabMinor} />
          {F.lowerFareEnd}
        </>
      ) : null}
    </p>
  );
}

/**
 * One list's flights (spec rev 55 §11): its provenance note, the difference line (the figure's own pair only), up to
 * three flights, "N more read, M outside your limits · show all" and the line saying what was not read; or, for a list
 * that holds no flight, what it says instead.
 */
function ListSection({
  list,
  limits,
  figure,
}: {
  list: FlightList;
  limits: FlightLimits;
  /** The figure, for the difference line; null for another airport pair's list (no difference line). */
  figure: DatePairFigure | null;
}) {
  const now = useNow();
  const [all, setAll] = useState(false);
  // why: finding 6: the note has no source before it, so the clause names the browser worker ("the browser worker's
  // monthly limit is used up")
  const note = listNote(list, now, COPY, (d) => stopDetailClause(d, 'camoufox', true));
  const shown = shownOf(list, limits, true);
  if (note !== null || shown === null) return note === null ? null : <p className="flights-line">{note}</p>;
  const flights = all ? allInOrder(list.flights, limits) : shown.shown;
  return (
    <>
      <p data-testid="flights-head" className="flights-head">
        {headLine(list, now, COPY)}
      </p>
      {figure !== null ? <DifferenceLine list={list} figure={figure} /> : null}
      <ul className="flights-list">
        {flights.map((f, i) => (
          // why: a list's flights have no id; their place in the shown order is stable for one list
          <FlightRow key={i} flight={f} list={list} limits={limits} />
        ))}
      </ul>
      {shown.moreRead > 0 ? (
        <p data-testid="flights-more" className="flights-line">
          {all ? null : F.more(shown.moreRead, shown.moreOutside)}
          {all ? null : F.separator}
          <button type="button" className="btn-text" onClick={() => setAll((a) => !a)}>
            {all ? F.showFewer : F.showAll}
          </button>
        </p>
      ) : null}
      <p data-testid="flights-limits" className="flights-line">
        {F.limits}
      </p>
    </>
  );
}

/**
 * "Read flights for this date (free, 1 page)" (spec rev 55 §11; ui-009). While this date pair is read the same button
 * stays mounted, saying "Reading flights…" with `aria-disabled`, so a press never loses its focus (finding 3); every
 * other read button is disabled meanwhile.
 */
function ReadButton({
  pairOf,
  flights,
}: {
  pairOf: { departureDate: string; returnDate: string };
  flights: BoardFlights;
}) {
  const reading = flights.readingKey === pairKey(pairOf);
  return (
    <p className="flights-line">
      <button
        type="button"
        className="btn btn-quiet min-h-11"
        disabled={flights.readingKey !== null && !reading}
        aria-disabled={reading ? true : undefined}
        onClick={() => {
          if (!reading) flights.read(pairOf);
        }}
      >
        {reading
          ? F.reading
          : F.readButton(
              pagesLeftClause(flights.meta?.monthlyPagesLeft ?? null, flights.meta?.runPages ?? null),
            )}
      </button>
    </p>
  );
}

/**
 * A date pair's flights block (spec rev 55 §11), below its row (or inside its phone card): the figure's own airport
 * pair's list; with none, "Flights not read yet" and the read button, then another airport pair's list under its label;
 * and every date pair's "Open in Google Flights ↗" with its search-link label beside it, whatever the flight lists'
 * availability (none without a link, or for a link that is not Google's https page). When flight lists are not
 * available here only the link shows. Null when there is nothing to show.
 */
export function FlightsBlock({
  pairOf,
  figure,
  entry,
  flights,
  limits,
}: {
  pairOf: { departureDate: string; returnDate: string };
  figure: DatePairFigure;
  entry: FlightPair | undefined;
  flights: BoardFlights;
  limits: FlightLimits;
}) {
  const available = flights.meta?.available === true;
  const block = useRef<HTMLDivElement>(null);
  // why: finding 3: a read that lands takes its button away; when focus was inside the block it stays there, on the
  // block itself, never dropped to the page. Whether it was inside is read before the commit, while the button holds it
  const hadFocus = useRef(false);
  hadFocus.current = block.current?.contains(document.activeElement) ?? false;
  useLayoutEffect(() => {
    const el = block.current;
    if (el !== null && hadFocus.current && !el.contains(document.activeElement)) el.focus();
  });
  if (!hasFlightsBlock(entry, available)) return null;
  const href = googleFlightsHref(entry.link);
  const list = entry.list;
  const dates = datesShort(pairOf.departureDate, pairOf.returnDate, F);
  const key = pairKey(pairOf);
  return (
    <div ref={block} tabIndex={-1} data-testid="flights-block" className="flights-block">
      {/* why: finding 3: one live region per block, there before anything is said in it */}
      {available ? (
        <p role="status" data-testid="flights-status" className="flights-line">
          {flights.said?.key === key ? flights.said.words : null}
        </p>
      ) : null}
      {available && list !== null ? <ListSection list={list} limits={limits} figure={figure} /> : null}
      {available && list === null ? <p className="flights-line">{F.notReadYet}</p> : null}
      {available && offersRead(list) ? <ReadButton pairOf={pairOf} flights={flights} /> : null}
      {available && list === null && entry.listOtherPair !== null ? (
        <div className="flights-other">
          <p className="flights-head">
            {F.otherPair(entry.listOtherPair.origin, entry.listOtherPair.destination)}
          </p>
          <ListSection list={entry.listOtherPair} limits={limits} figure={null} />
        </div>
      ) : null}
      {href !== null && entry.link !== null ? (
        <p data-testid="flights-link" className="flights-line flex flex-wrap items-baseline gap-x-2">
          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={F.openLinkName(dates)}>
            {F.openLink}
          </a>
          <span className="text-fg-2">{entry.link.label}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The one line under the board when flight lists cannot be read here (spec rev 55 §11): "Flight times need the browser
 * worker; set it up in Providers", or, for a search in another cabin, that flight times are read for economy only.
 */
export function FlightsUnavailable({ meta }: { meta: BoardFlights['meta'] }) {
  if (meta === null || meta.available) return null;
  return (
    <p data-testid="flights-unavailable" className="text-sm text-fg-2">
      {unavailableWords(meta.unavailableReason)}
    </p>
  );
}
