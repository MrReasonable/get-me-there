// A synthetic "Price insights" dialog in the shape the --grid recordings of 2026-10-18 showed (roles, names, text and
// order only; every date and price here is synthetic): a tablist, the stay buttons, the Dates tabpanel holding the
// legend, the left and right scroll buttons, an empty grid "Date grid", the departures line (one element whose text
// runs its seven labels together, holding one element per label), 49 sibling cell buttons in rows of one return date
// (less the pairs whose return precedes the departure), the returns line, "Return", the up and down scroll buttons,
// the selected range and the price line; then Cancel and OK. A scrolled view reuses and rotates its elements.
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
  /** The price in pounds for a pair. */
  price?: (d: string, r: string) => number;
  cheapest?: Array<[string, string]>;
  low?: Array<[string, string]>;
  /** The selected pair; defaults to the view's centre (the query a page load opens). */
  selected?: [string, string];
  /** Overrides one cell's name (a reworded or unpriced cell). */
  names?: (d: string, r: string, i: number) => string | undefined;
  /** Leaves the scroll buttons out. */
  scroll?: boolean;
  /** The dialog as the Price graph click opens it: the Price graph tab selected, no Dates panel. */
  tab?: 'dates' | 'graph';
  /** The labels and cells start this many places in, as after a scroll (run 2, view 3). */
  rotate?: number;
  /** Extra nodes inside the panel (an e-mail address, a challenge line). */
  extra?: FakeNode[];
  /** The year the page leaves out of a range in it (2026 in the recordings). */
  thisYear?: number;
  /**
   * How the selected pair's lines sit in the DOM. `shared` (the default): one element whose text runs the range and the
   * price together ("14 – 24 Mar 2027£462 · Round trip", as the recordings print it), holding the price as its own
   * element and the range as bare text; `separate`: one element each; `spaced`: as shared, with no-break and thin
   * spaces around the dash and the dot.
   */
  selectedForm?: 'shared' | 'separate' | 'spaced';
  /**
   * The cells the page has not drawn yet: each shows as the "0000" placeholder text in its place, as the darwin-x64
   * recordings of 2026-10-26 print one (grid 3's new column after a scroll, grid 4's whole first view). When the
   * selected cell is one of them, its price line is not drawn either.
   */
  undrawn?: (d: string, r: string) => boolean;
}

function selectedLines(range: string, price: string, form: 'shared' | 'separate' | 'spaced'): FakeNode[] {
  if (form === 'separate') return [text(range), text(price)];
  const r = form === 'spaced' ? range.replace(' – ', '\u2009–\u2009') : range;
  const p = form === 'spaced' ? price.replace(' · ', '\u00a0·\u00a0') : price;
  return [n('generic', '', [text(p)], { text: `${r}${p}` })];
}

export function cellName(
  d: string,
  r: string,
  pounds: number,
  marks: { cheapest?: boolean; low?: boolean; selected: boolean },
): string {
  const mark = marks.cheapest === true ? ', cheapest price' : marks.low === true ? ', low price' : '';
  return `£${pounds.toLocaleString('en-GB')}${mark}, ${dm(d)} to ${dm(r)}${marks.selected ? ', selected' : ''}`;
}

/** The selected range: "14 – 24 Mar 2027", "28 Mar – 7 Apr 2027", "27 Dec 2026 – 6 Jan 2027", "20 – 23 Oct". */
export function selectedRange(d: string, r: string, thisYear = 2026): string {
  const [a, b] = [at(d), at(r)];
  const yr = b.getUTCFullYear();
  const left =
    a.getUTCFullYear() !== yr
      ? `${dm(d)} ${a.getUTCFullYear()}`
      : a.getUTCMonth() !== b.getUTCMonth()
        ? dm(d)
        : String(a.getUTCDate());
  return `${left} – ${dm(r)}${yr === thisYear && a.getUTCFullYear() === yr ? '' : ` ${yr}`}`;
}

const has = (list: Array<[string, string]> | undefined, d: string, r: string): boolean =>
  (list ?? []).some(([cd, cr]) => cd === d && cr === r);

export function gridTree(o: GridTreeOptions): FakeNode {
  const price =
    o.price ?? ((d: string, r: string) => 400 + (((at(r).getTime() - at(d).getTime()) / 86_400_000) % 60));
  const sel = o.selected ?? [plusDays(o.depart, 3), plusDays(o.ret, 3)];
  const deps = Array.from({ length: 7 }, (_v, i) => plusDays(o.depart, i));
  const rets = Array.from({ length: 7 }, (_v, i) => plusDays(o.ret, i));
  const cells: FakeNode[] = [];
  for (const [row, r] of rets.entries())
    for (const [col, d] of deps.entries()) {
      // why: the grid shows no pair whose return precedes its departure (run 4: 39 cells); a same-day pair is shown
      if (r < d) continue;
      if (o.undrawn?.(d, r) === true) {
        cells.push(text('0000'));
        continue;
      }
      const p = price(d, r);
      const name =
        o.names?.(d, r, row * 7 + col) ??
        cellName(d, r, p, {
          cheapest: has(o.cheapest, d, r),
          low: has(o.low, d, r),
          selected: sel[0] === d && sel[1] === r,
        });
      cells.push(n('button', name, [text(`£${p}`)]));
    }
  const k = o.rotate ?? 0;
  const turn = <T>(xs: T[]): T[] =>
    xs.length === 0 ? xs : [...xs.slice(k % xs.length), ...xs.slice(0, k % xs.length)];
  const line = (labels: string[]): FakeNode =>
    n('generic', '', labels.map(text), { text: `0000${labels.join('')}0000` });
  const scroll = o.scroll !== false;
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
          line(turn(deps.map(dayLabel))),
          ...turn(cells),
          line(rets.map(dayLabel)),
          text('Return'),
          ...(scroll ? [n('button', 'Scroll up'), n('button', 'Scroll down')] : []),
          ...selectedLines(
            selectedRange(sel[0], sel[1], o.thisYear),
            o.undrawn?.(sel[0], sel[1]) === true
              ? ''
              : `£${price(sel[0], sel[1]).toLocaleString('en-GB')} · Round trip`,
            o.selectedForm ?? 'shared',
          ),
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
