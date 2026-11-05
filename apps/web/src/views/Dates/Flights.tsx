import { type FlightLimits, staleWords, stopDetailClause } from '@gmt/core';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useFlightLists, useFlightRead } from '../../api/flights.js';
import type { FlightList, FlightListsResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import type { ListsState } from './board.js';
import { FlightPrice, FlightRow, StaleSaid } from './FlightRow.js';
import {
  allInOrder,
  cheapestRead,
  datesShort,
  type FlightPair,
  googleFlightsHref,
  hasFlightsBlock,
  headLine,
  listNote,
  outcomeOf,
  pairKey,
  readButtonWords,
  shownOf,
} from './flightLines.js';
import { PairingSection } from './PairingSection.js';
import { type PairingView, pairingOf, readDoneWords, returnNote, returnsWereRead } from './pairing.js';
import { londonDaysAgo, readAt } from './stateLines.js';

// Spec rev 55 §11 "Flights", §6.9 and §2 (WP20 Task 20.10): a search's page's flights. The board asks for the flight
// lists of the date pairs it shows (useBoardFlights), states each read's outcome beside the figure (FlightOutcome) and
// shows each date pair's flights block below its row (FlightsBlock). Spec rev 56 (WP21 Task 21.7): a list whose returns
// were read shows its pairing section (PairingSection), both legs' marks and its status notes; the date pair's figure is
// the api's (a leading pairing is its own basis), so nothing here changes a price, a rank or the coverage.

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
  /** What the board knows of the flight-lists request (21.7 prov-004): pending, failed, or what it answered. */
  lists: ListsState;
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
export function useBoardFlights(
  definitionId: string,
  pages: readonly (readonly string[])[],
  limits: FlightLimits,
): BoardFlights {
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
  // why: final review B-I3: the pressed pair's own readNow, so its live words say what happens next as its note does
  const pressedReadNow = pressed === null ? false : (byKey.get(pressed.key)?.readNow ?? false);
  useEffect(() => setPolling(readingKey !== null), [readingKey]);
  useEffect(() => {
    if (pressed === null || pressed.acceptedAt === null) return;
    // why: the newer list has landed, or an answer read after the press says no read is going (it ended with none)
    const landed = (pressedList?.id ?? null) !== pressed.listId;
    if (!landed && !(lists.fetchedAt > pressed.acceptedAt && apiReading === null)) return;
    const dates = datesShort(pressed.pair.departureDate, pressed.pair.returnDate, F);
    setSaid({
      key: pressed.key,
      // why: spec rev 56 §11: the read's returns in the live region ("…, 2 return flights"), or its status note's words
      words:
        landed && pressedList !== null
          ? readDoneWords(pressedList, dates, COPY, limits, pressedReadNow)
          : F.readNotDone(dates),
    });
    setPressed(null);
  }, [pressed, pressedList, pressedReadNow, lists.fetchedAt, apiReading, limits]);
  const meta =
    newest === null
      ? null
      : {
          available: newest.available,
          unavailableReason: newest.unavailableReason,
          refreshHours: newest.refreshHours,
          monthlyPagesLeft: newest.monthlyPagesLeft,
          runPages: newest.runPages,
          pagesPlanned: newest.pagesPlanned,
          reading: apiReading,
        };
  // why: 21.7 prov-004: the "flights not read" mark is off only when the request succeeded and said flight lists are
  // not read here; pending and failed are their own states
  const listsState: ListsState =
    lists.status === 'loading'
      ? 'loading'
      : lists.status === 'failed'
        ? 'failed'
        : meta?.available === true
          ? 'available'
          : 'unavailable';
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
  return { byKey, meta, lists: listsState, readingKey, said, read };
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
          {F.outcomeFrom}{' '}
          {/* why: the price and its time wrap as one, so ", 06:45" never starts a line on its own */}
          <span className="whitespace-nowrap">
            <FlightPrice list={list} pence={o.minMinor} />
            {F.outcomeAt(o.when)}
          </span>
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
 * Google's lower fare (spec rev 55 §6.9, §11): when the page's Cheapest-tab price is below the cheapest flight read,
 * "Google shows a lower fare it could not read (£x)", through PriceCell. Spec rev 56 §6.9 retired revision 55's
 * difference line around it: the figure's own price now names its source, and a pairing figure's grid price is the
 * line beneath it on the board.
 */
function LowerFareLine({ list }: { list: FlightList }) {
  const min = cheapestRead(list);
  if (min === null || list.tabMinor === null || list.tabMinor >= min) return null;
  return (
    <p data-testid="flights-lower-fare" className="flights-line">
      {F.lowerFare}
      <FlightPrice list={list} pence={list.tabMinor} />
      {F.lowerFareEnd}
    </p>
  );
}

/**
 * The block's head, one sentence (spec rev 56 §11; 21.7 ui-003/004): for a list with a pairing, the outbound it used,
 * and that the first Back price is a seller's stated price only when one is shown (prov-001); after a limit edit the
 * outbound "selected under your limits when read" (or "which was over your limits when read"), as the section head
 * says it, never "within your limits" (code I2, M13); else WP20's "Outbound flights only · …", which never mentions
 * return flights.
 */
function headOf(list: FlightList, p: PairingView | null, now: ReturnType<typeof useNow>): string {
  if (p === null) return headLine(list, now, COPY);
  const ago = COPY.agoOf(list.ageHours);
  const when = londonDaysAgo(list.fetchedAt, now) === 0 ? null : readAt(list.fetchedAt, now, COPY);
  const seller = p.offer !== null;
  if (!p.selectedNow || !p.underCurrentLimits)
    return F.headPairingWhenRead(p.outboundFits ? p.which : 'over', seller, ago, when);
  return p.outboundFits
    ? F.headPairing(p.which, seller, ago, when, p.fits)
    : F.headPairingOver(seller, ago, when);
}

/**
 * One list's flights (spec rev 55 §11, rev 56): its head, the lower fare (the figure's own pair only), the pairing
 * section when its returns were read, up to three flights, "N more read, M outside your limits · show all" and the line saying what was not read; or, for a list
 * that holds no flight, what it says instead.
 */
function ListSection({
  list,
  limits,
  own,
  readNow,
}: {
  list: FlightList;
  limits: FlightLimits;
  /** The figure's own airport pair's list (its lower fare is said); false for another airport pair's list. */
  own: boolean;
  /** Final review B-I3: whether a read of this date pair would go now (the api's `readNow`; false for another pair's). */
  readNow: boolean;
}) {
  const now = useNow();
  const [all, setAll] = useState(false);
  const outboundId = useId();
  // why: finding 6: the note has no source before it, so the clause names the browser worker ("the browser worker's
  // monthly limit is used up")
  const note = listNote(list, now, COPY, (d) => stopDetailClause(d, 'camoufox', true));
  const shown = shownOf(list, limits, true);
  if (note !== null || shown === null) return note === null ? null : <p className="flights-line">{note}</p>;
  const flights = all ? allInOrder(list.flights, limits) : shown.shown;
  const p = pairingOf(list, limits);
  const read = returnsWereRead(list);
  const first = list.returns?.attempts[0];
  // why: spec rev 56 §11 "Status notes": a return read that did not finish says so after the outbound lines; a list
  // read without a return phase (or stored before them) shows as the outbound list, its limits line saying so
  const status = list.returns === null || read ? null : returnNote(list, COPY, readNow);
  const selectedOf = (f: (typeof list.flights)[number]): string | null => {
    if (p === null) return null;
    if (f === list.flights[p.outboundIndex]) return F.selectedMark;
    return p.attempt > 0 && first !== undefined && f === list.flights[first.outboundIndex]
      ? F.triedFirstMark
      : null;
  };
  // why: the stale mark's words once, on the head, for every price of this one list (each then shows the glyph)
  const stale = list.stale === false ? null : staleWords(list.stale);
  return (
    <StaleSaid.Provider value={stale !== null}>
      <p data-testid="flights-head" className="flights-head">
        {headOf(list, p, now)}
        {stale !== null ? `${F.separator}${stale}` : null}
      </p>
      {/* why: 21.7 ui-006: a return read that did not finish says so directly under the head it explains */}
      {status !== null ? (
        <p data-testid="flights-return-note" className="flights-line">
          {status}
        </p>
      ) : null}
      {read && p === null ? (
        <p data-testid="flights-returns-none" className="flights-line">
          {F.returnsNone}
        </p>
      ) : null}
      {own ? <LowerFareLine list={list} /> : null}
      {p !== null ? <PairingSection list={list} p={p} limits={limits} readNow={readNow} /> : null}
      <ul id={outboundId} className="flights-list">
        {flights.map((f, i) => (
          // why: a list's flights have no id; their place in the shown order is stable for one list
          <FlightRow
            key={i}
            flight={f}
            list={list}
            limits={limits}
            returnsRead={read}
            selectedMark={selectedOf(f)}
          />
        ))}
      </ul>
      {shown.moreRead > 0 ? (
        <p data-testid="flights-more" className="flights-line">
          {all ? null : F.more(shown.moreRead, shown.moreOutside)}
          {all ? null : F.separator}
          <button
            type="button"
            className="btn-text"
            aria-expanded={all}
            aria-controls={outboundId}
            onClick={() => setAll((a) => !a)}
          >
            {/* why: spec rev 56 §11: beside "show all return flights" the outbound toggle names its own flights;
            21.7 code M2: one fixed name, aria-expanded alone carries the state */}
            {p === null ? F.showAll : F.showAllOutbound}
          </button>
        </p>
      ) : null}
      <p data-testid="flights-limits" className="flights-line">
        {read
          ? F.limitsWithReturns(F.settingsNotApplied, F.windowsOutboundOnly)
          : F.limitsOutboundOnly(F.returnNotRead, F.settingsNotApplied)}
      </p>
    </StaleSaid.Provider>
  );
}

/**
 * "Read flights for this date (free, up to 2 pages)" (spec rev 56 §11; ui-009; ruling D3: the response's `pagesPlanned`).
 * While this date pair is read the same button
 * stays mounted, saying "Reading flights…" with `aria-disabled`, so a press never loses its focus (finding 3); every
 * other read button is disabled meanwhile.
 */
function ReadButton({
  pairOf,
  flights,
  meta,
}: {
  pairOf: { departureDate: string; returnDate: string };
  flights: BoardFlights;
  /** The answer that says flight lists are read here (the button shows only then), its planned pages with it. */
  meta: NonNullable<BoardFlights['meta']>;
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
          : readButtonWords(
              // why: ruling D3, prov-008: the pages the response plans, never a hard number (21.7 code M8: the button
              // exists only beside an answer, so there is no fallback that could understate them)
              meta.pagesPlanned,
              meta.monthlyPagesLeft,
              meta.runPages,
              F,
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
  entry,
  flights,
  limits,
}: {
  pairOf: { departureDate: string; returnDate: string };
  entry: FlightPair | undefined;
  flights: BoardFlights;
  limits: FlightLimits;
}) {
  const meta = flights.meta;
  const available = meta?.available === true;
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
      {available && list !== null ? (
        <ListSection list={list} limits={limits} own readNow={entry.readNow} />
      ) : null}
      {available && list === null ? <p className="flights-line">{F.notReadYet}</p> : null}
      {/* why: final review B-I3: the button shows exactly when the api says a read would go now (`readNow`) */}
      {meta?.available && entry.readNow ? <ReadButton pairOf={pairOf} flights={flights} meta={meta} /> : null}
      {available && list === null && entry.listOtherPair !== null ? (
        <div className="flights-other">
          <p className="flights-head">
            {F.otherPair(entry.listOtherPair.origin, entry.listOtherPair.destination)}
          </p>
          <ListSection list={entry.listOtherPair} limits={limits} own={false} readNow={false} />
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
 * The one line above the board when its flight-lists request failed (21.7 prov-004): "flights couldn't be loaded;
 * prices shown without flights", so a row with no flight line is not read as one with nothing to say.
 */
export function FlightsLoadFailed({ lists }: { lists: ListsState }) {
  if (lists !== 'failed') return null;
  return (
    <p data-testid="flights-load-failed" role="status" className="text-sm text-fg-2">
      {COPY.datesView.flightsLoadFailed}
    </p>
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
