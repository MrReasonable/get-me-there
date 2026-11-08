import { type DatePair, type DatePairFigure, type DecodedDatePairs, rankTierOf } from '@gmt/core';
import {
  Fragment,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatFlapDate, formatIsoDate } from '../../format.js';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  type DatesSortKey,
  type DatesUiState,
  datesPatch,
  detailHref,
  detailPatch,
} from '../../state/datesState.js';
import { navigateTo, updateSearchParams } from '../../state/urlState.js';
import {
  BoardCard,
  CheaperCached,
  FlightRead,
  Journey,
  type LegChanges,
  PairingFigureLines,
  RankFlaps,
  RowPrice,
  rowState,
  StateFlap,
} from './BoardCard.js';
import {
  type BoardModel,
  gridFetchedAtOf,
  type ListsState,
  PAGE_SIZE,
  sellerCoverage,
  setsAirlineOrLayover,
} from './board.js';
import {
  FlightOutcome,
  FlightsBlock,
  FlightsLoadFailed,
  FlightsUnavailable,
  useBoardFlights,
} from './Flights.js';
import {
  boardGroups,
  hasFlightsBlock,
  limitsOf,
  orderedGroups,
  pairKey,
  ranksInOrder,
  requestPages,
  shownOf,
} from './flightLines.js';
import { type Animate, useFlip } from './flip.js';
import { howFarChecked } from './howFar.js';
import { pairingOf } from './pairing.js';
import { TieLine } from './TieLine.js';

const D = COPY.datesView;

export { PHONE_QUERY } from '../../hooks/useMediaQuery.js';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const SORTS: ReadonlyArray<{ key: DatesSortKey; label: string }> = [
  { key: 'departure', label: D.columns.depart },
  { key: 'nights', label: D.columns.nights },
  { key: 'price', label: D.columns.price },
  { key: 'journey', label: D.columns.journey },
];
const sortLabel = (key: DatesSortKey) => SORTS.find((s) => s.key === key)?.label ?? key;

export interface BoardProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  model: BoardModel;
  state: DatesUiState;
  runActive: boolean;
  /** Rows shown: 10, then 10 more per press (component state, not the URL; WP19 §5). */
  visible: number;
  onShowMore: () => void;
  /** The date pair lit from the overview or a row (spec §11 Rings), by index. */
  lit: number | null;
  onLight: (index: number | null) => void;
  /** Changes when a re-read is applied, which runs the one transition. */
  token: number;
  animate: Animate;
  captionRef: RefObject<HTMLElement | null>;
  /** The pointer is over the board or focus is inside it (revision 50: a read is then held). */
  onHold: (held: boolean) => void;
  /** "N changes · Update board", inside the board's region so Tab reaches it from the board. */
  update: ReactNode;
}

/**
 * Spec §11 Dates "Board": a table captioned "Best dates", rows in core's rank (the price rank whatever the sort),
 * sortable by price, departure, nights and journey time with aria-sort; 10 rows, then "Show 10 more"; each row's
 * dates a real link to the date pair detail, and a click anywhere on the row follows it. Below 900 px, stacked cards.
 * WP20 Task 20.10 (spec rev 55 §11 Flights, Ties): the board asks for the flight lists of the tie groups that touch the
 * shown rows, orders each tie by its flights (core's `orderWithinTie`, after the rank and before paging; the rank
 * column stays the price rank), puts each tie's line above it, each read's outcome beside its figure and each date
 * pair's flights block below its row (inside its phone card).
 */
export function BoardTable(props: BoardProps) {
  const { definition, data, model, state, runActive, visible, lit, onLight, token, animate, captionRef } =
    props;
  const phone = useMediaQuery(PHONE_QUERY);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const region = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const detailBase = `${noteId}-flights`;
  // why: ties are runs in the price order, so they are grouped (and reordered) only while the board is sorted by price
  const byPrice = state.sort.key === 'price';
  const groups = useMemo(() => boardGroups(model.rows.map(withFigure), byPrice), [model.rows, byPrice]);
  const pages = useMemo(() => requestPages(groups, visible, PAGE_SIZE), [groups, visible]);
  const limits = useMemo(() => limitsOf(definition), [definition]);
  const flights = useBoardFlights(definition.id, pages, limits);
  const available = flights.meta?.available === true;
  const settings = setsAirlineOrLayover(definition.constraints);
  // why: finding 9: a list that lands moves rows within a tie only while the board is not in use; while the pointer or
  // focus is in it (the board's own hold, revision 50) the order keeps the lists it last applied, and the move is
  // applied when they leave. The flights themselves (each block and outcome) show at once; only the order waits.
  const [held, setHeld] = useState(false);
  // why: finding 9 (FLIP half): `rev` counts each change of the applied lists, in the same state as the lists, so the
  // render that moves rows within a tie also changes the transition's token (below) and the moves animate like any
  // other reorder (none under reduced motion, as useFlip already rules)
  const [orderBy, setOrderBy] = useState({ byKey: flights.byKey, available, rev: 0 });
  useEffect(() => {
    if (!held)
      setOrderBy((o) =>
        o.byKey === flights.byKey && o.available === available
          ? o
          : { byKey: flights.byKey, available, rev: o.rev + 1 },
      );
  }, [held, flights.byKey, available]);
  const { rows, tieAt, ranks } = useMemo(() => {
    const shownFor = (p: DatePair) =>
      shownOf(orderBy.byKey.get(pairKey(p))?.list ?? null, limits, orderBy.available);
    const ordered = orderedGroups(groups, shownFor);
    const rows = ordered.flat().slice(0, visible);
    // why: each tie's line stands above its first shown row (spec rev 55 §11 Ties), counting the whole tie and, when
    // it runs past the shown rows, how many of it are shown (ruling R-tie-count)
    const onPage = new Set(rows.map((p) => p.index));
    const tieAt = new Map<number, { count: number; shown: number; pricePence: number; byFlights: boolean }>();
    for (const g of ordered) {
      const first = g[0];
      if (g.length > 1 && first !== undefined && onPage.has(first.index))
        tieAt.set(first.index, {
          count: g.length,
          shown: g.filter((p) => onPage.has(p.index)).length,
          pricePence: first.figure.price.pricePence,
          byFlights: g.some((p) => (shownFor(p)?.shown.length ?? 0) > 0),
        });
    }
    // why: design 2026-11-08 §5.4 — within a tie the rank follows the order shown, so rank 2 never sits above rank 1
    return { rows, tieAt, ranks: ranksInOrder(ordered, model.rankOf) };
  }, [groups, orderBy, limits, visible, model.rankOf]);
  // why: design 2026-11-08 §5.3 — rows are closed; the date pairs whose flights detail is open, by the wire's pair key
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const toggleOpen = (key: string) =>
    setOpenKeys((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const airportPairs = data.scope.airportPairs;
  const filtered = state.journey !== null;
  // why: both only count up, so their sum changes whenever a read is applied or a tie's flight lists are applied
  useFlip(region, token + orderBy.rev, animate, reduced);
  const table = useRef<HTMLTableElement>(null);
  useExplicitRoles(table);

  // why: spec §11: focus stays on the same date pair's row, or moves to the caption when that row leaves the shown
  // rows; whether focus was inside is read before the commit, while the old row still holds it
  const inside = useRef({ pointer: false, focus: false });
  const focusBefore = useRef(false);
  focusBefore.current = region.current?.contains(document.activeElement) ?? false;
  useLayoutEffect(() => {
    const root = region.current;
    if (root !== null && focusBefore.current && !root.contains(document.activeElement))
      captionRef.current?.focus();
  });
  // why: the hold watches the whole region (rows, Show more, Update board) with native listeners: the region is a
  // container, not a control, so it carries no handler of its own in the markup
  const onHold = useRef(props.onHold);
  onHold.current = props.onHold;
  useEffect(() => {
    const root = region.current;
    if (root === null) return;
    const set = (patch: Partial<{ pointer: boolean; focus: boolean }>) => {
      inside.current = { ...inside.current, ...patch };
      const h = inside.current.pointer || inside.current.focus;
      onHold.current(h);
      setHeld(h);
    };
    const enter = () => set({ pointer: true });
    const leave = () => set({ pointer: false });
    const focusIn = () => set({ focus: true });
    const focusOut = (e: FocusEvent) => {
      if (!(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) set({ focus: false });
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('focusout', focusOut);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('focusout', focusOut);
    };
  }, []);

  const sortBy = (key: DatesSortKey) => {
    const dir = state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc';
    updateSearchParams(datesPatch({ sort: { key, dir } }), 'replace');
  };
  const ariaSort = (key: DatesSortKey) =>
    state.sort.key === key ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
  const sortButton = (key: DatesSortKey) => (
    <button
      type="button"
      className="btn-text min-h-11"
      aria-describedby={key === 'price' ? noteId : undefined}
      onClick={() => sortBy(key)}
    >
      {sortLabel(key)}
    </button>
  );
  // why: the rank's cells: two, or as many as the largest shown rank needs
  const digits = Math.max(2, ...rows.map((p) => String(ranks.get(p.index) ?? 0).length));

  // why: 21.7 persona coverage: the board says for how many of the rows shown a seller's price was read
  const coverage = sellerCoverage(rows);
  const caption = (
    <>
      <span ref={captionRef} tabIndex={-1} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="board-title">{D.boardCaption}</span>
        {runActive ? <span className="tag tag-warn">{D.partial}</span> : null}
      </span>
      <span className="block">{D.boardOrderNote}</span>
      <span className="block">{D.showing(rows.length, model.rows.length)}</span>
      {coverage !== null ? (
        <span data-testid="seller-coverage" className="block">
          {D.sellerCoverage(coverage.read, coverage.shown)}
        </span>
      ) : null}
      {model.weeks !== null ? <span className="block">{D.bestPerWeek(model.weeks)}</span> : null}
    </>
  );

  return (
    // why: the table stays the region's own child, so the hold listeners and a test's pointer events meet the region
    <div ref={region} className="frame board-frame space-y-3">
      <span id={noteId} className="sr-only">
        {D.priceSortNote}
      </span>
      <FlightsLoadFailed lists={flights.lists} />
      {phone ? (
        <div className="flex flex-wrap gap-x-4 text-sm">
          {SORTS.map((s) => (
            <span key={s.key}>{sortButton(s.key)}</span>
          ))}
        </div>
      ) : null}
      {/* why: one semantic table at every width; below 900 px CSS stacks each row as a card, which takes a table's
      implicit roles away in some browsers, so useExplicitRoles writes every part's role out */}
      <table ref={table} className="board">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {/* why: the column is painted "#" (CSS); its name is read as "Rank" */}
            <th scope="col" className="rank-head">
              <span className="sr-only">{D.columns.rank}</span>
            </th>
            <th scope="col" aria-sort={ariaSort('departure')}>
              {sortButton('departure')}
            </th>
            <th scope="col">{D.columns.return}</th>
            <th scope="col" aria-sort={ariaSort('nights')}>
              {sortButton('nights')}
            </th>
            <th scope="col" aria-sort={ariaSort('price')} className="cell-right">
              {sortButton('price')}
            </th>
            <th scope="col">{D.columns.howFar}</th>
            <th scope="col" aria-sort={ariaSort('journey')} className="cell-right">
              {sortButton('journey')}
            </th>
            <th scope="col">{D.columns.airports}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, at) => {
            const entry = flights.byKey.get(pairKey(p));
            const key = pairKey(p);
            const tie = tieAt.get(p.index);
            // why: design 2026-11-08 §5.2 — a labelled break where the current trips with flights read give way to the
            // current dates with only a calendar price (sorted by price). Not-current figures (superseded, not seen)
            // rank after every current one, so a read trip among them never sits under "Calendar prices only", and no break
            // is drawn for them
            const prev = rows[at - 1];
            const isCurrent = (q: DatePair) =>
              q.figure !== null && !q.figure.superseded && q.figure.notSeenInLatest === null;
            const breaks =
              byPrice &&
              prev !== undefined &&
              prev.figure !== null &&
              p.figure !== null &&
              isCurrent(prev) &&
              isCurrent(p) &&
              rankTierOf(prev.figure) < 2 &&
              rankTierOf(p.figure) === 2;
            const outcome = <FlightOutcome entry={entry} available={available} />;
            const hasBlock = hasFlightsBlock(entry, available);
            const open = hasBlock && openKeys.has(key);
            const detailId = `${detailBase}-${p.index}`;
            // why: design 2026-11-08 §5.1 — the pairing's changes each way come from the list the board asked for
            const view = entry?.list == null ? null : pairingOf(entry.list, limits);
            // (only when that list's pairing is the figure's own: its departures are the ones the row's times show)
            const q = p.figure?.pairing ?? null;
            const sameTrip =
              view !== null &&
              q !== null &&
              view.outbound.departsLocal === q.departOut &&
              view.ret.departsLocal === q.departBack;
            const changes = sameTrip
              ? {
                  out: { stops: view.outbound.stops, minutes: view.outbound.durationMinutes },
                  back: { stops: view.ret.stops, minutes: view.ret.durationMinutes },
                }
              : null;
            const toggle = hasBlock ? (
              <FlightsToggle
                open={open}
                controls={detailId}
                onToggle={() => toggleOpen(key)}
                dep={formatIsoDate(p.departureDate)}
                ret={formatIsoDate(p.returnDate)}
              />
            ) : null;
            const detail = open ? (
              <>
                {outcome}
                <FlightsBlock
                  pairOf={p}
                  entry={entry}
                  flights={flights}
                  limits={limits}
                  gridFetchedAt={gridFetchedAtOf(p.figure)}
                  mayLead={p.figure !== null && p.figure.basis !== 'verified'}
                />
              </>
            ) : null;
            const common = {
              pair: p,
              rank: ranks.get(p.index) ?? 0,
              digits,
              howFar: howFarChecked(p, airportPairs, state.journey),
              notes: definition.destinationNotes,
              journeyFiltered: filtered,
              lit: lit === p.index,
              onLight,
              lists: flights.lists,
              settings,
              changes,
              toggle,
            };
            return (
              <Fragment key={p.index}>
                {breaks ? (
                  <tr className="tier-break" data-testid="tier-break">
                    <td colSpan={8}>{D.tierBreak}</td>
                  </tr>
                ) : null}
                {tie !== undefined ? <TieLine {...tie} /> : null}
                {phone ? (
                  <BoardCard
                    {...common}
                    flights={detail === null ? null : <div id={detailId}>{detail}</div>}
                  />
                ) : (
                  <>
                    <BoardRow {...common} />
                    {detail !== null ? (
                      <tr className="flights-row">
                        <td colSpan={8} id={detailId} data-flights-for={p.index}>
                          {detail}
                        </td>
                      </tr>
                    ) : null}
                  </>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        {rows.length < model.rows.length ? (
          <button type="button" className="btn btn-quiet min-h-11" onClick={props.onShowMore}>
            {D.showMore(Math.min(10, model.rows.length - rows.length))}
          </button>
        ) : (
          <span />
        )}
        {props.update}
      </div>
      <FlightsUnavailable meta={flights.meta} />
      {phone ? (
        <div data-testid="phone-key" className="space-y-1 text-xs text-fg-2">
          <p>{D.phoneKey.providers}</p>
          <p>{D.phoneKey.glyphs}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Writes each table part's role on it after every commit: `display: block` (the phone's stacked cards) drops a table's
 * implicit roles in some browsers, so the board names them explicitly and stays a table to assistive technology.
 */
function useExplicitRoles(ref: RefObject<HTMLTableElement | null>): void {
  useLayoutEffect(() => {
    const t = ref.current;
    if (t === null) return;
    t.setAttribute('role', 'table');
    const set = (selector: string, role: string) => {
      for (const el of t.querySelectorAll(selector)) el.setAttribute('role', role);
    };
    set(':scope > thead, :scope > tbody', 'rowgroup');
    set(':scope > thead > tr, :scope > tbody > tr', 'row');
    set('th[scope="col"]', 'columnheader');
    set('th[scope="row"]', 'rowheader');
    set(':scope > tbody > tr > td', 'cell');
  });
}

/** The board shows only date pairs with a figure (rankDatePairs keeps no other); this narrows the type to say so. */
function withFigure(p: DatePair): DatePair & { figure: DatePairFigure } {
  const f = p.figure;
  if (f === null) throw new Error(`board row ${p.index} has no figure`);
  return { ...p, figure: f };
}

function BoardRow({
  pair,
  rank,
  digits,
  howFar,
  notes,
  journeyFiltered,
  lit,
  onLight,
  lists,
  settings,
  changes,
  toggle,
}: {
  pair: DatePair & { figure: DatePairFigure };
  rank: number;
  digits: number;
  howFar: readonly string[];
  notes: DefinitionResponse['destinationNotes'];
  journeyFiltered: boolean;
  lit: boolean;
  onLight: (index: number | null) => void;
  /** The pairing's changes each way (design 2026-11-08 §5.1), or null. */
  changes: { out: LegChanges; back: LegChanges } | null;
  /** The row's button that opens its flights detail (design 2026-11-08 §5.3), or null when it has none. */
  toggle: ReactNode;
  /** What the board knows of its flight-lists request (21.7 prov-004: "flights not read" by it). */
  lists: ListsState;
  /** The search sets an airline or layover setting (a pairing figure says they are not applied). */
  settings: boolean;
}) {
  const f = pair.figure;
  const state = rowState(f);
  const dep = formatIsoDate(pair.departureDate);
  const ret = formatIsoDate(pair.returnDate);
  const open = navigateTo(detailPatch(pair));
  // why: spec §11: a click anywhere on the row follows its link; the link and the buttons inside keep their own
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    if (e.target instanceof Element && e.target.closest('a, button') !== null) return;
    open(e);
  };
  return (
    <tr
      data-pair={pair.index}
      data-state={state}
      data-lit={lit ? '' : undefined}
      onClick={onRowClick}
      onPointerEnter={() => onLight(pair.index)}
      onPointerLeave={() => onLight(null)}
    >
      <td>
        <RankFlaps rank={rank} state={state} digits={digits} />
      </td>
      <td className="nowrap">
        <a
          href={detailHref(pair)}
          onClick={open}
          onFocus={() => onLight(pair.index)}
          onBlur={() => onLight(null)}
          aria-label={D.openDates(dep, ret)}
        >
          <span className="sr-only">{dep}</span>
          <Flaps text={formatFlapDate(pair.departureDate)} slot="dep" />
        </a>
      </td>
      <td className="nowrap">
        <span className="sr-only">{ret}</span>
        <Flaps text={formatFlapDate(pair.returnDate)} slot="ret" />
      </td>
      <td>
        <span className="sr-only">{pair.nights}</span>
        <Flaps text={String(pair.nights)} cells={2} align="right" slot="nights" />
      </td>
      <td className="board-price">
        <RowPrice figure={f} notes={notes} flapSlot="price" />
        <CheaperCached figure={f} notes={notes} />
        <PairingFigureLines figure={f} settings={settings} changes={changes} />
        <FlightRead figure={f} lists={lists} />
        {toggle}
      </td>
      <td className="board-howfar">
        <StateFlap state={state} />
        <span className="words">{howFar.join(' · ')}</span>
      </td>
      <td className="board-journey cell-right">
        <Journey figure={f} filtered={journeyFiltered} />
      </td>
      <td className="nowrap">
        <span className="sr-only">{D.airports(f.origin, f.destination)}</span>
        <Flaps text={`${f.origin}–${f.destination}`} slot="airports" />
      </td>
    </tr>
  );
}

/**
 * Design 2026-11-08 §5.3: the button that opens and closes a row's flights detail. A real button (Enter and Space work
 * as on any), with `aria-expanded` and `aria-controls` naming the detail; its visible words say what it does and its
 * hidden ones, which dates.
 */
function FlightsToggle({
  open,
  controls,
  onToggle,
  dep,
  ret,
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
  dep: string;
  ret: string;
}) {
  return (
    <button
      type="button"
      className="btn btn-quiet min-h-11 mt-1.5"
      data-flights-toggle=""
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? D.flightsToggle.close : D.flightsToggle.open}
      {/* why: the space sits outside the hidden span so the accessible name keeps it ("Show flights for …") */}{' '}
      <span className="sr-only">{D.flightsToggleOf(dep, ret)}</span>
    </button>
  );
}
