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
import { formatIsoDate } from '../../format.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  type DatesSortKey,
  type DatesUiState,
  datesPatch,
  detailHref,
  detailPatch,
} from '../../state/datesState.js';
import { navigateTo, updateSearchParams } from '../../state/urlState.js';
import { BoardCard, CheaperCached, FigurePrice, Journey } from './BoardCard.js';
import type { BoardModel } from './board.js';
import { type Animate, useFlip } from './flip.js';
import { howFarChecked } from './howFar.js';

const D = COPY.datesView;

/** Spec §11 Phone: below 900 px the board is stacked cards and the overview one month at a time. */
export const PHONE_QUERY = '(max-width: 899px)';
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
      className="min-h-11 font-semibold underline"
      aria-describedby={key === 'price' ? noteId : undefined}
      onClick={() => sortBy(key)}
    >
      {sortLabel(key)}
    </button>
  );

  const caption = (
    <>
      <span
        ref={captionRef}
        tabIndex={-1}
        className="block text-lg font-semibold focus-visible:outline focus-visible:outline-2"
      >
        {D.boardCaption}
        {runActive ? <span className="ml-2 text-sm font-normal">{D.partial}</span> : null}
      </span>
      <span className="block text-sm font-normal">{D.boardOrderNote}</span>
      <span className="block text-sm font-normal">{D.showing(rows.length, model.rows.length)}</span>
      {model.weeks !== null ? (
        <span className="block text-sm font-normal">{D.bestPerWeek(model.weeks)}</span>
      ) : null}
    </>
  );

  return (
    <div ref={region} className="space-y-2">
      <span id={noteId} className="sr-only">
        {D.priceSortNote}
      </span>
      {phone ? (
        <section aria-labelledby={`${noteId}-cap`}>
          <h3 id={`${noteId}-cap`}>{caption}</h3>
          <div className="flex flex-wrap gap-2 py-1 text-sm">
            {SORTS.map((s) => (
              <span key={s.key}>{sortButton(s.key)}</span>
            ))}
          </div>
          <ol className="space-y-2">
            {rows.map((p) => (
              <BoardCard
                key={p.index}
                pair={withFigure(p)}
                rank={model.rankOf.get(p.index) ?? 0}
                howFar={howFarChecked(p, airportPairs, state.journey)}
                notes={definition.destinationNotes}
                journeyFiltered={filtered}
                lit={lit === p.index}
                onLight={onLight}
              />
            ))}
          </ol>
        </section>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="text-left">{caption}</caption>
          <thead>
            <tr className="text-left">
              <th scope="col" className="p-1">
                {D.columns.rank}
              </th>
              <th scope="col" className="p-1" aria-sort={ariaSort('departure')}>
                {sortButton('departure')}
              </th>
              <th scope="col" className="p-1">
                {D.columns.return}
              </th>
              <th scope="col" className="p-1" aria-sort={ariaSort('nights')}>
                {sortButton('nights')}
              </th>
              <th scope="col" className="p-1" aria-sort={ariaSort('price')}>
                {sortButton('price')}
              </th>
              <th scope="col" className="p-1">
                {D.columns.howFar}
              </th>
              <th scope="col" className="p-1" aria-sort={ariaSort('journey')}>
                {sortButton('journey')}
              </th>
              <th scope="col" className="p-1">
                {D.columns.airports}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <BoardRow
                key={p.index}
                pair={withFigure(p)}
                rank={model.rankOf.get(p.index) ?? 0}
                howFar={howFarChecked(p, airportPairs, state.journey)}
                notes={definition.destinationNotes}
                journeyFiltered={filtered}
                lit={lit === p.index}
                onLight={onLight}
              />
            ))}
          </tbody>
        </table>
      )}
      {rows.length < model.rows.length ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={props.onShowMore}
        >
          {D.showMore(Math.min(10, model.rows.length - rows.length))}
        </button>
      ) : null}
      {props.update}
    </div>
  );
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
      data-lit={lit ? '' : undefined}
      onClick={onRowClick}
      onPointerEnter={() => onLight(pair.index)}
      onPointerLeave={() => onLight(null)}
      className={`cursor-pointer border-t border-slate-200 align-top ${lit ? 'outline outline-2 outline-black' : ''}`}
    >
      <td className="p-1 tabular-nums">{rank}</td>
      <td className="p-1">
        <a
          href={detailHref(pair)}
          onClick={open}
          onFocus={() => onLight(pair.index)}
          onBlur={() => onLight(null)}
          aria-label={D.openDates(dep, ret)}
          className="underline"
        >
          {dep}
        </a>
      </td>
      <td className="p-1">{ret}</td>
      <td className="p-1 tabular-nums">{pair.nights}</td>
      <td className="p-1">
        <FigurePrice figure={f} notes={notes} />
        <CheaperCached figure={f} notes={notes} />
      </td>
      <td className="p-1 text-xs">{howFar.join(' · ')}</td>
      <td className="p-1 text-xs">
        <Journey figure={f} filtered={journeyFiltered} />
      </td>
      <td className="p-1 text-xs">{D.airports(f.origin, f.destination)}</td>
    </tr>
  );
}
