// A synthetic "Price insights" dialog in the shape the 2026-10-18 graph exploration 2 recorded (roles, names and order
// only; every date and price here is synthetic): a tablist, the stay buttons, the Dates tabpanel holding the legend, the
// left and right scroll buttons, an empty grid "Date grid", the departures, 49 sibling cell buttons in rows of one
// return date, the returns, the up and down scroll buttons and the selected-pair line; then Cancel and OK.
import { type FakeNode, n, text } from './fakePage.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const at = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const plusDays = (iso: string, k: number): string => {
  const d = at(iso);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
const dm = (iso: string): string => `${at(iso).getUTCDate()} ${MONS[at(iso).getUTCMonth()] ?? ''}`;
/** "Thu 11 Mar", the label form both lines use. */
export const dayLabel = (iso: string): string => `${DAYS[at(iso).getUTCDay()] ?? ''} ${dm(iso)}`;

export interface GridTreeOptions {
  /** The first departure and the first return the view shows. */
  depart: string;
  ret: string;
  /** The price in pounds for a pair, or null for a cell named by `unpriced`. */
  price?: (d: string, r: string) => number | null;
  cheapest?: Array<[string, string]>;
  /** The selected pair; defaults to the view's centre (the query a page load opens). */
  selected?: [string, string];
  /** The departures and returns as one text line each (recording 2's printed form), or one node per label. */
  labels?: 'lines' | 'labels';
  /** Overrides one cell's name (a reworded or unpriced cell). */
  names?: (d: string, r: string, i: number) => string | undefined;
  /** Leaves the scroll buttons out. */
  scroll?: boolean;
  /** The dialog as the Price graph click opens it: the Price graph tab selected, no Dates panel. */
  tab?: 'dates' | 'graph';
  /** Extra nodes inside the panel (an e-mail address, a challenge line). */
  extra?: FakeNode[];
}

export function cellName(
  d: string,
  r: string,
  pounds: number | null,
  marks: { cheapest: boolean; selected: boolean },
): string {
  if (pounds === null) return `No price, ${dm(d)} to ${dm(r)}`;
  return `£${pounds.toLocaleString('en-GB')}${marks.cheapest ? ', cheapest price' : ''}, ${dm(d)} to ${dm(r)}${marks.selected ? ', selected' : ''}`;
}

/** The selected-pair line: "14 – 24 Mar 2027£462 · Round trip" (other month and year forms are hypotheses). */
export function selectedLine(d: string, r: string, pounds: number): string {
  const [a, b] = [at(d), at(r)];
  const yr = b.getUTCFullYear();
  const left =
    a.getUTCFullYear() !== yr
      ? `${dm(d)} ${a.getUTCFullYear()}`
      : a.getUTCMonth() !== b.getUTCMonth()
        ? dm(d)
        : String(a.getUTCDate());
  return `${left} – ${dm(r)} ${yr}£${pounds} · Round trip`;
}

export function gridTree(o: GridTreeOptions): FakeNode {
  const price =
    o.price ?? ((d: string, r: string) => 400 + (((at(r).getTime() - at(d).getTime()) / 86_400_000) % 60));
  const sel = o.selected ?? [plusDays(o.depart, 3), plusDays(o.ret, 3)];
  const deps = Array.from({ length: 7 }, (_v, i) => plusDays(o.depart, i));
  const rets = Array.from({ length: 7 }, (_v, i) => plusDays(o.ret, i));
  const cells: FakeNode[] = [];
  for (const [row, r] of rets.entries())
    for (const [col, d] of deps.entries()) {
      const p = price(d, r);
      const marks = {
        cheapest: (o.cheapest ?? []).some(([cd, cr]) => cd === d && cr === r),
        selected: sel[0] === d && sel[1] === r,
      };
      const name = o.names?.(d, r, row * 7 + col) ?? cellName(d, r, p, marks);
      cells.push(n('button', name, p === null ? [] : [text(`£${p}`)]));
    }
  const depLabels = deps.map(dayLabel);
  const retLabels = rets.map(dayLabel);
  const lines = (o.labels ?? 'lines') === 'lines';
  const scroll = o.scroll !== false;
  const selPrice = price(sel[0], sel[1]) ?? 0;
  const tabs = n('tablist', '', [
    n('tab', 'Dates', [], { selected: o.tab !== 'graph' }),
    n('tab', 'Price graph', [], { selected: o.tab === 'graph' }),
  ]);
  const panel =
    o.tab === 'graph'
      ? n('region', 'Price graph')
      : n('tabpanel', 'Dates', [
          n('img', ''),
          text('Cheapest Compared with other prices shown Departure'),
          ...(scroll ? [n('button', 'Scroll left'), n('button', 'Scroll right')] : []),
          n('grid', 'Date grid'),
          ...(lines ? [text(`0000 ${depLabels.join(' ')}`)] : depLabels.map(text)),
          ...cells,
          ...(lines
            ? [text(`${retLabels.join(' ')} 0000 Return`)]
            : [...retLabels.map(text), text('Return')]),
          ...(scroll ? [n('button', 'Scroll up'), n('button', 'Scroll down')] : []),
          text(selectedLine(sel[0], sel[1], selPrice)),
          ...(o.extra ?? []),
        ]);
  return n('dialog', 'Price insights', [
    tabs,
    text('10-day trip'),
    n('button', 'Reduce your stay by one day'),
    n('button', 'Extend your stay by one day'),
    panel,
    n('button', 'Cancel'),
    n('button', 'OK'),
  ]);
}
