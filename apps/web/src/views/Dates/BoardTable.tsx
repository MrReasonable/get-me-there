import type { DatePair, DatePairFigure, DecodedDatePairs } from '@gmt/core';
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
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
  FigurePrice,
  Journey,
  RankFlaps,
  rowState,
  StateFlap,
} from './BoardCard.js';
import type { BoardModel } from './board.js';
import { type Animate, useFlip } from './flip.js';
import { howFarChecked } from './howFar.js';

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
 */
export function BoardTable(props: BoardProps) {
  const { definition, data, model, state, runActive, visible, lit, onLight, token, animate, captionRef } =
    props;
  const phone = useMediaQuery(PHONE_QUERY);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const region = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const rows = model.rows.slice(0, visible);
  const airportPairs = data.scope.airportPairs;
  const filtered = state.journey !== null;
  useFlip(region, token, animate, reduced);
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
      onHold.current(inside.current.pointer || inside.current.focus);
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
  const digits = Math.max(2, ...rows.map((p) => String(model.rankOf.get(p.index) ?? 0).length));

  const caption = (
    <>
      <span ref={captionRef} tabIndex={-1} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="board-title">{D.boardCaption}</span>
        {runActive ? <span className="tag tag-warn">{D.partial}</span> : null}
      </span>
      <span className="block">{D.boardOrderNote}</span>
      <span className="block">{D.showing(rows.length, model.rows.length)}</span>
      {model.weeks !== null ? <span className="block">{D.bestPerWeek(model.weeks)}</span> : null}
    </>
  );

  return (
    // why: the table stays the region's own child, so the hold listeners and a test's pointer events meet the region
    <div ref={region} className="frame board-frame space-y-3">
      <span id={noteId} className="sr-only">
        {D.priceSortNote}
      </span>
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
          {rows.map((p) =>
            phone ? (
              <BoardCard
                key={p.index}
                pair={withFigure(p)}
                rank={model.rankOf.get(p.index) ?? 0}
                digits={digits}
                howFar={howFarChecked(p, airportPairs, state.journey)}
                notes={definition.destinationNotes}
                journeyFiltered={filtered}
                lit={lit === p.index}
                onLight={onLight}
              />
            ) : (
              <BoardRow
                key={p.index}
                pair={withFigure(p)}
                rank={model.rankOf.get(p.index) ?? 0}
                digits={digits}
                howFar={howFarChecked(p, airportPairs, state.journey)}
                notes={definition.destinationNotes}
                journeyFiltered={filtered}
                lit={lit === p.index}
                onLight={onLight}
              />
            ),
          )}
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
        <FigurePrice figure={f} notes={notes} flapSlot="price" />
        <CheaperCached figure={f} notes={notes} />
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
