import { type DecodedDatePairs, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoMonth } from '../../format.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { type DatesUiState, detailPatch } from '../../state/datesState.js';
import { updateSearchParams } from '../../state/urlState.js';
import { PHONE_QUERY } from './BoardTable.js';
import type { BoardModel } from './board.js';
import { type Layout, moveTo, type Pos } from './keys.js';
import { Legend } from './Legend.js';
import { type CellView, OverviewMonth } from './OverviewMonth.js';
import { bandsOf, type Column, cellModel, columnsFor, markCounts, monthsOf, pairsAt } from './overview.js';
import { cellWords, Readout } from './Readout.js';
import { shadeScale } from './shade.js';
import { stayRange } from './stayScope.js';

const O = COPY.datesView.overview;
const M = COPY.datesView.marks;
/** Spec §11 Phone: a sideways swipe of at least this many pixels turns the month. */
export const SWIPE_PX = 50;

/** A cell's key: its departure day and the first stay of its column. */
const keyOf = (date: string, from: number) => `${date}|${from}`;

export interface OverviewProps {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  model: BoardModel;
  state: DatesUiState;
  /** The board's shown rows, by date pair index (spec §11 Rings). */
  ringed: ReadonlySet<number>;
  /** The date pair lit from the board, or null. */
  lit: number | null;
  onLight: (index: number | null) => void;
}

/**
 * Spec §11 Dates "Overview": below the board, the window's months, each day a strip of stay-length cells (or folded
 * bands, at most 12); one scale for current verified and calendar figures; a non-colour mark for every cell without
 * a figure; the numeric legend, always open, and the readout beside it; rings both ways with the board; the keyboard
 * (one tab stop), touch (a first tap shows the readout) and, on a phone, one month at a time with a swipe. At most
 * 400 days × 12 cells are drawn, plus one open band-month.
 */
export function Overview({ definition, data, model, state, ringed, lit, onLight }: OverviewProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const readoutId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ month: IsoMonth; from: number } | null>(null);
  const [focusPos, setFocusPos] = useState<Pos | null>(null);
  const [hoverPos, setHoverPos] = useState<Pos | null>(null);
  const [monthIndex, setMonthIndex] = useState(0);
  const pendingFocus = useRef<string | null>(null);
  const lastPointer = useRef<string>('mouse');

  const scale = useMemo(() => shadeScale(model.inView), [model.inView]);
  const range = stayRange(data.space, state.nights);
  const bands = useMemo(() => bandsOf(range), [range?.min, range?.max]);
  const months = useMemo(() => monthsOf(data.space), [data.space]);
  const counts = useMemo(() => markCounts(model.inView, model.rankOf, scale), [model, scale]);

  // why: every cell is computed once per read, filter or opened band, never on a hover or a focus (WP19 §6: 1.5 s
  // for 50,000 cells and 200 ms for a stay-filter change)
  const grid = useMemo(() => {
    const byMonth = new Map<IsoMonth, Map<IsoDate, CellView[]>>();
    const byKey = new Map<string, CellView>();
    const columnsOfMonth = new Map<IsoMonth, Column[]>();
    for (const m of months) columnsOfMonth.set(m, columnsFor(bands, open?.month === m ? open.from : null));
    for (const p of model.inView) {
      const m = monthOf(p.departureDate);
      let days = byMonth.get(m);
      if (days === undefined) {
        days = new Map();
        byMonth.set(m, days);
      }
      if (days.has(p.departureDate)) continue;
      const cells: CellView[] = (columnsOfMonth.get(m) ?? []).map((column) => {
        const pairs = pairsAt(data.pairs, data.space, p.departureDate, column);
        const cm = cellModel(pairs, model.rankOf, scale);
        const rank = cm.lead === null ? undefined : model.rankOf.get(cm.lead.index);
        const what =
          cm.lead !== null && cm.shade !== null && rank !== undefined
            ? O.rank(rank)
            : cm.marks.map((x) => M.words[x]).join(', ') || (rank !== undefined ? O.rank(rank) : O.noMark);
        const v: CellView = {
          key: keyOf(p.departureDate, column.from),
          date: p.departureDate,
          column,
          model: cm,
          name: O.cellName(
            cellWords(p.departureDate, column, cm),
            O.stay(column.from, column.to),
            column.to > column.from ? `${what}, ${O.openBand}` : what,
          ),
          ringed: pairs.some((x) => ringed.has(x.index)),
        };
        byKey.set(v.key, v);
        return v;
      });
      days.set(p.departureDate, cells);
    }
    return { byMonth, byKey, columnsOfMonth };
  }, [months, bands, open, model, data, scale, ringed]);

  const layout: Layout = {
    columns: (date) => grid.columnsOfMonth.get(monthOf(date)) ?? [],
    has: (date) => grid.byMonth.get(monthOf(date))?.has(date) === true,
  };
  const shownMonths = phone ? months.slice(monthIndex, monthIndex + 1) : months;
  const firstKey = shownMonths
    .map((m) => grid.byMonth.get(m)?.values().next().value?.[0]?.key)
    .find((k) => k !== undefined);
  const focusKey = focusPos === null ? null : keyOf(focusPos.date, focusPos.from);
  const tabStop =
    focusPos !== null &&
    focusKey !== null &&
    grid.byKey.has(focusKey) &&
    shownMonths.includes(monthOf(focusPos.date))
      ? focusKey
      : (firstKey ?? null);
  const litCell =
    lit === null
      ? null
      : ([...grid.byKey.values()].find((c) => c.model.pairs.some((p) => p.index === lit))?.key ?? null);
  const active = hoverPos ?? focusPos;
  const activeCell = active === null ? null : (grid.byKey.get(keyOf(active.date, active.from)) ?? null);

  const focusCell = (key: string) => {
    const el = root.current?.querySelector<HTMLButtonElement>(`[data-cell="${key}"]`);
    if (el) el.focus();
    else pendingFocus.current = key;
  };
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    const el = root.current?.querySelector<HTMLButtonElement>(`[data-cell="${key}"]`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  });

  // why: one set of native listeners for every cell (delegation): thousands of cells carry no handler of their own
  const posOf = (t: EventTarget | null): Pos | null => {
    const el = t instanceof Element ? t.closest<HTMLElement>('[data-cell]') : null;
    const cell = el?.dataset.cell === undefined ? undefined : grid.byKey.get(el.dataset.cell);
    return cell === undefined ? null : { date: cell.date, from: cell.column.from };
  };
  const noop = () => undefined;
  const handlers = useRef<{
    pos: (t: EventTarget | null) => Pos | null;
    key: (e: KeyboardEvent) => void;
    click: (e: MouseEvent) => void;
  }>({ pos: () => null, key: noop, click: noop });
  handlers.current.pos = posOf;
  const act = (pos: Pos) => {
    const cell = grid.byKey.get(keyOf(pos.date, pos.from));
    if (cell === undefined) return;
    if (cell.column.to > cell.column.from) {
      setOpen({ month: monthOf(cell.date), from: cell.column.from });
      return;
    }
    const pair = cell.model.pairs[0];
    if (pair !== undefined) updateSearchParams(detailPatch(pair), 'push');
  };
  handlers.current.key = (e) => {
    const pos = handlers.current.pos(e.target);
    if (pos === null) return;
    if (e.key === 'Escape' && open !== null) {
      // why: spec §11 Folded bands: Escape closes the open band; focus returns to the band's own cell on that day
      e.preventDefault();
      setOpen(null);
      focusCell(keyOf(pos.date, open.from));
      return;
    }
    const next = moveTo(pos, e.key, layout);
    if (next === null) return;
    e.preventDefault();
    setFocusPos(next);
    const nm = monthOf(next.date);
    if (phone && nm !== monthOf(pos.date)) setMonthIndex(Math.max(0, months.indexOf(nm)));
    focusCell(keyOf(next.date, next.from));
  };
  handlers.current.click = (e) => {
    const pos = handlers.current.pos(e.target);
    if (pos === null) return;
    const same = focusPos !== null && focusPos.date === pos.date && focusPos.from === pos.from;
    // why: revision 50 (Ian confirmed): on touch, a first tap shows the readout and a second tap opens the detail
    if (lastPointer.current === 'touch' && !same) {
      setFocusPos(pos);
      return;
    }
    setFocusPos(pos);
    act(pos);
  };

  useEffect(() => {
    const el = root.current;
    if (el === null) return;
    let swipeFrom: number | null = null;
    const over = (e: Event) => {
      const pos = handlers.current.pos(e.target);
      setHoverPos(pos);
      const cell = pos === null ? undefined : grid.byKey.get(keyOf(pos.date, pos.from));
      onLightRef.current(
        cell?.ringed === true
          ? (cell.model.pairs.find((p) => ringedRef.current.has(p.index))?.index ?? null)
          : null,
      );
    };
    const leave = () => {
      setHoverPos(null);
      onLightRef.current(null);
    };
    const focusIn = (e: Event) => {
      const pos = handlers.current.pos(e.target);
      if (pos !== null) setFocusPos(pos);
    };
    const down = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
      swipeFrom = e.clientX;
    };
    const up = (e: PointerEvent) => {
      if (swipeFrom === null) return;
      const dx = e.clientX - swipeFrom;
      swipeFrom = null;
      if (Math.abs(dx) >= SWIPE_PX) swipeRef.current(dx < 0 ? 1 : -1);
    };
    const key = (e: KeyboardEvent) => handlers.current.key(e);
    const click = (e: MouseEvent) => handlers.current.click(e);
    el.addEventListener('pointerover', over);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focusin', focusIn);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('keydown', key);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('keydown', key);
      el.removeEventListener('click', click);
    };
  }, [grid]);
  const onLightRef = useRef(onLight);
  onLightRef.current = onLight;
  const ringedRef = useRef(ringed);
  ringedRef.current = ringed;
  const turn = (d: 1 | -1) => setMonthIndex((i) => Math.min(months.length - 1, Math.max(0, i + d)));
  const swipeRef = useRef(turn);
  swipeRef.current = turn;

  const openMonth = open === null ? null : open.month;
  const openBand = open === null ? null : bands.find((b) => b.from === open.from);
  return (
    <section aria-labelledby={`${readoutId}-h`} className="space-y-3">
      <h3 id={`${readoutId}-h`} className="h-section">
        {O.heading}
      </h3>
      <div className="frame space-y-4">
        <div className="ov-key grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-start">
          <Legend scale={scale} counts={counts} />
          <Readout
            id={readoutId}
            cell={activeCell}
            airportPairs={data.scope.airportPairs}
            journeyLimit={state.journey}
            notes={definition.destinationNotes}
          />
        </div>
        {openMonth !== null && openBand !== undefined && openBand !== null ? (
          <button type="button" className="btn btn-quiet min-h-11" onClick={() => setOpen(null)}>
            {O.closeBand(O.stay(openBand.from, openBand.to), formatIsoMonth(openMonth))}
          </button>
        ) : null}
        {phone ? (
          <nav aria-label={O.monthsLabel} className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn btn-quiet min-h-11"
              disabled={monthIndex === 0}
              onClick={() => turn(-1)}
            >
              {O.previousMonth}
            </button>
            <button
              type="button"
              className="btn btn-quiet min-h-11"
              disabled={monthIndex >= months.length - 1}
              onClick={() => turn(1)}
            >
              {O.nextMonth}
            </button>
          </nav>
        ) : null}
        <div ref={root} className="ov-months" data-testid="dates-overview">
          {shownMonths.map((m) => (
            <OverviewMonth
              key={m}
              month={m}
              days={grid.byMonth.get(m) ?? EMPTY}
              tabStop={tabStop?.startsWith(m) ? tabStop : null}
              lit={litCell?.startsWith(m) ? litCell : null}
              readoutId={readoutId}
              phone={phone}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

const EMPTY: ReadonlyMap<IsoDate, readonly CellView[]> = new Map();
