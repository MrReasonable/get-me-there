// WP15 Task 15.2: one settled grid view read through locators and checked (spec §2 rev 34; the --grid recordings of
// 2026-10-18): cells by their own names, the lines as a set check, the cell count less the impossible pairs, duplicates
// and set mismatches structural, drift a stop, weekdays and years checked, and the first view's selected pair.
import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cellsCalledFor,
  changeKeyOf,
  interpretView,
  type RawView,
  readRawView,
  stillDrawing,
  viewCounts,
} from '../src/gridView.js';
import { SELECTORS } from '../src/selectors.js';
import { FakeLocator, FakePage, n } from './support/fakePage.js';
import { cellName, dayLabel, gridTree, plusDays, selectedRange } from './support/gridTree.js';
import { fakeTimers } from './support/timers.js';

beforeEach(() => {
  expect.hasAssertions();
});

const days = (from: string, k = 7): string[] => Array.from({ length: k }, (_v, i) => plusDays(from, i));
/** A raw view in the recordings' shape; `cells` overrides the names. */
function raw(o: {
  depart: string;
  ret: string;
  names?: Array<string | null>;
  sel?: [string, string];
  price?: number;
  range?: string;
  rotate?: number;
}): RawView {
  const deps = days(o.depart);
  const rets = days(o.ret);
  const sel = o.sel ?? [plusDays(o.depart, 3), plusDays(o.ret, 3)];
  const names: Array<string | null> = [];
  for (const r of rets)
    for (const d of deps)
      if (r >= d)
        names.push(
          cellName(d, r, d === sel[0] && r === sel[1] ? (o.price ?? 462) : 450, {
            selected: d === sel[0] && r === sel[1],
          }),
        );
  const k = o.rotate ?? 0;
  const depLabels = deps.map(dayLabel);
  const rotated = [...depLabels.slice(k), ...depLabels.slice(0, k)];
  return {
    lines: [`0000${rotated.join('')}0000`, `0000${rets.map(dayLabel).join('')}0000`],
    candidates: o.names ?? names,
    ranges: [o.range ?? selectedRange(sel[0], sel[1])],
    prices: [`£${o.price ?? 462} · Round trip`],
    datesGrid: { dialog: 1, datesSelected: 1, grid: 1, scrollButtons: 4 },
  };
}
const Q = { dep: asIsoDate('2027-03-14'), ret: asIsoDate('2027-03-24') };

describe('interpretView', () => {
  it('reads 49 cells by their names, with the lines as sets, and checks the first view against the query', () => {
    const v = interpretView(raw({ depart: '2027-03-11', ret: '2027-03-21' }), Q.dep, Q);
    if (v.kind !== 'view') throw new Error(v.why);
    expect(v.departures).toEqual(days('2027-03-11'));
    expect(v.returns).toEqual(days('2027-03-21'));
    expect(v.cells).toHaveLength(49);
    expect(v.cells[0]).toEqual({
      status: 'price',
      departureDate: '2027-03-11',
      returnDate: '2027-03-21',
      amountMinor: 45_000,
      mark: 'none',
    });
    expect([v.unparsed, v.structural]).toEqual([0, 'ok']);
  });
  it('a rotated view reads the same (dates come from the names, never positions)', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21', rotate: 6 });
    const v = interpretView(
      { ...r, candidates: [...r.candidates.slice(6), ...r.candidates.slice(0, 6)] },
      Q.dep,
    );
    expect(v.kind === 'view' && v.cells.length).toBe(49);
  });
  it('near today: 39 cells (no pair returns before it departs), a same-day pair priced', () => {
    const v = interpretView(
      raw({ depart: '2026-10-18', ret: '2026-10-20', sel: ['2026-10-20', '2026-10-23'] }),
      asIsoDate('2026-10-20'),
      {
        dep: asIsoDate('2026-10-20'),
        ret: asIsoDate('2026-10-23'),
      },
    );
    if (v.kind !== 'view') throw new Error(v.why);
    expect(v.cells).toHaveLength(39);
    expect(v.cells.some((c) => c.departureDate === '2026-10-20' && c.returnDate === '2026-10-20')).toBe(true);
  });
  it('across the year: December departures, January returns', () => {
    const v = interpretView(
      raw({ depart: '2026-12-24', ret: '2027-01-03', range: '27 Dec 2026 – 6 Jan 2027' }),
      asIsoDate('2026-12-27'),
      {
        dep: asIsoDate('2026-12-27'),
        ret: asIsoDate('2027-01-06'),
      },
    );
    if (v.kind !== 'view') throw new Error(v.why);
    expect(v.returns[0]).toBe('2027-01-03');
    expect(v.cells.find((c) => c.returnDate === '2027-01-03')?.departureDate).toBe('2026-12-24');
  });
  it('the marks are Google’s: cheapest and low', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const names = [...r.candidates];
    names[0] = '£397, cheapest price, 11 Mar to 21 Mar';
    names[1] = '£485, low price, 12 Mar to 21 Mar';
    const v = interpretView({ ...r, candidates: names }, Q.dep);
    expect(v.kind === 'view' && v.cells.slice(0, 2).map((c) => [c.amountMinor, c.mark])).toEqual([
      [39_700, 'cheapest'],
      [48_500, 'low'],
    ]);
  });
  it('a cell that fails is unparsed and counted, never guessed', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const names = [...r.candidates];
    names[2] = '—, 13 Mar to 21 Mar';
    names[3] = '£450, 14 Mar to 29 Mar';
    names[4] = null;
    const v = interpretView({ ...r, candidates: names }, Q.dep);
    expect(v.kind === 'view' && [v.cells.length, v.unparsed, v.structural]).toEqual([46, 3, 'ok']);
  });
  it('a view with a cell missing from its count is structurally unparsed', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const v = interpretView({ ...r, candidates: r.candidates.slice(1) }, Q.dep);
    expect(v.kind === 'view' && [v.cells.length, v.structural]).toEqual([0, 'unparsed']);
  });
  it('a pair named twice makes the view structurally unparsed: nothing from it is stored (PA-06)', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const names = [...r.candidates];
    names[1] = names[0] ?? '';
    const v = interpretView({ ...r, candidates: names }, Q.dep);
    expect(v.kind === 'view' && [v.cells.length, v.structural]).toEqual([0, 'unparsed']);
  });
  it('more than half of the priced-looking cells failing is drift: unrecognised', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const drifted = r.candidates.map((x, i) => (i < 25 ? `${x ?? ''}, from` : x));
    expect(interpretView({ ...r, candidates: drifted }, Q.dep)).toEqual({
      kind: 'unrecognised',
      why: 'selector-drift',
    });
    const fine = r.candidates.map((x, i) => (i < 24 ? `${x ?? ''}, from` : x));
    expect(interpretView({ ...r, candidates: fine }, Q.dep).kind).toBe('view');
  });
  it('exactly half of the priced-looking cells failing is not drift (the boundary)', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    // why: 48 priced-looking names (the last is unnamed), 24 of them failing: half, not more than half
    const half = r.candidates.map((x, i) => (i === 48 ? null : i < 24 ? `${x ?? ''}, from` : x));
    expect(interpretView({ ...r, candidates: half }, Q.dep).kind).toBe('view');
  });
  it('a departure whose seven names all fail leaves a line date no cell names: structural `sets`, nothing kept', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    // why: 7 of 49 fail (under the drift half) and the count holds, so only the set check can catch it
    const names = r.candidates.map((x, i) =>
      i % 7 === 6 ? `—, 17 Mar to ${21 + Math.floor(i / 7)} Mar` : x,
    );
    expect(interpretView({ ...r, candidates: names }, Q.dep)).toMatchObject({
      kind: 'view',
      structural: 'unparsed',
      structuralCheck: 'sets',
      cells: [],
      unparsed: 7,
    });
  });
  it('a cell whose return precedes its departure, both on the lines, is unparsed and never a cell', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-15' });
    const names = [...r.candidates];
    names[0] = '£450, 17 Mar to 15 Mar';
    const v = interpretView({ ...r, candidates: names }, Q.dep);
    if (v.kind !== 'view') throw new Error(v.why);
    expect([v.unparsed, v.structural, v.cells.length]).toEqual([1, 'ok', r.candidates.length - 1]);
    expect(v.cells.some((c) => c.departureDate === '2027-03-17' && c.returnDate === '2027-03-15')).toBe(
      false,
    );
  });
  it('no-break and thin spaces in the names and the lines read as spaces', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const odd = (t: string) => t.replace(/ /g, '\u00a0');
    const v = interpretView(
      { ...r, lines: r.lines.map(odd), candidates: r.candidates.map((x) => (x === null ? x : odd(x))) },
      Q.dep,
    );
    expect(v.kind === 'view' && [v.cells.length, v.unparsed]).toEqual([49, 0]);
    expect(changeKeyOf({ lines: r.lines.map(odd) })).toBe(changeKeyOf(r));
  });
  it('the change key is the lines’ dates: a re-render that only reorders the labels is no change', () => {
    const a = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const b = raw({ depart: '2027-03-11', ret: '2027-03-21', rotate: 3 });
    expect(b.lines).not.toEqual(a.lines);
    expect(changeKeyOf(b)).toBe(changeKeyOf(a));
    expect(changeKeyOf(raw({ depart: '2027-03-12', ret: '2027-03-21' }))).not.toBe(changeKeyOf(a));
  });
  it.each([
    [
      'not the dates-grid view',
      (r: RawView): RawView => ({ ...r, datesGrid: { ...r.datesGrid, scrollButtons: 3 } }),
      'not-dates-grid',
    ],
    ['one line', (r: RawView): RawView => ({ ...r, lines: r.lines.slice(0, 1) }), 'lines'],
    ['three lines', (r: RawView): RawView => ({ ...r, lines: [...r.lines, r.lines[1] ?? ''] }), 'lines'],
    [
      'two dialogs',
      (r: RawView): RawView => ({ ...r, datesGrid: { ...r.datesGrid, dialog: 2 } }),
      'not-dates-grid',
    ],
    [
      'the Dates tab not selected',
      (r: RawView): RawView => ({ ...r, datesGrid: { ...r.datesGrid, datesSelected: 0 } }),
      'not-dates-grid',
    ],
    [
      'no date grid',
      (r: RawView): RawView => ({ ...r, datesGrid: { ...r.datesGrid, grid: 0 } }),
      'not-dates-grid',
    ],
    [
      'a day twice on a line, spanning a week',
      (r: RawView): RawView => ({
        ...r,
        lines: [r.lines[0]?.replace('Fri 12 Mar', 'Thu 11 Mar') ?? '', r.lines[1] ?? ''],
      }),
      'lines',
    ],
    [
      'a wrong weekday',
      (r: RawView): RawView => ({
        ...r,
        lines: [r.lines[0]?.replace('Thu 11 Mar', 'Fri 11 Mar') ?? '', r.lines[1] ?? ''],
      }),
      'lines',
    ],
    [
      'seven labels with the right weekdays that are not consecutive days',
      (r: RawView): RawView => ({
        ...r,
        lines: [r.lines[0]?.replace('Wed 17 Mar', 'Thu 18 Mar') ?? '', r.lines[1] ?? ''],
      }),
      'lines',
    ],
    [
      'six days on a line',
      (r: RawView): RawView => ({
        ...r,
        lines: [r.lines[0]?.replace('Wed 17 Mar', '') ?? '', r.lines[1] ?? ''],
      }),
      'lines',
    ],
  ])('%s is unrecognised', (_l, f, why) => {
    expect(interpretView(f(raw({ depart: '2027-03-11', ret: '2027-03-21' })), Q.dep)).toEqual({
      kind: 'unrecognised',
      why,
    });
  });
  it.each([
    [
      'a selected pair that is not the query',
      raw({ depart: '2027-03-11', ret: '2027-03-21', sel: ['2027-03-13', '2027-03-24'] }),
    ],
    [
      'a range that is not the query',
      raw({ depart: '2027-03-11', ret: '2027-03-21', range: '14 – 25 Mar 2027' }),
    ],
    ['a range in another year', raw({ depart: '2027-03-11', ret: '2027-03-21', range: '14 – 24 Mar 2028' })],
    [
      'a price line that is not the selected cell’s',
      { ...raw({ depart: '2027-03-11', ret: '2027-03-21' }), prices: ['£463 · Round trip'] },
    ],
    ['no range line', { ...raw({ depart: '2027-03-11', ret: '2027-03-21' }), ranges: [] }],
    [
      'two distinct range lines',
      {
        ...raw({ depart: '2027-03-11', ret: '2027-03-21' }),
        ranges: ['14 – 24 Mar 2027', '15 – 24 Mar 2027'],
      },
    ],
    [
      'two distinct price lines',
      {
        ...raw({ depart: '2027-03-11', ret: '2027-03-21' }),
        prices: ['£462 · Round trip', '£463 · Round trip'],
      },
    ],
  ])('the first view: %s is unrecognised (PA-11)', (label, r) => {
    const check = label.includes('price') ? 'price' : label.includes('selected') ? 'selected-cell' : 'range';
    expect(interpretView(r, Q.dep, Q)).toEqual({ kind: 'unrecognised', why: 'first-view', check });
  });
});

// why: the darwin-x64 recordings of 2026-10-26 (grid 3 and 4): a view held still for two polls with 42 of its 49 cells,
// or none, drawn; each undrawn cell printed "0000" in its place. A view is taken only once every cell its lines call
// for has drawn (spec §2 rev 46)
describe('cellsCalledFor and stillDrawing', () => {
  const whole = raw({ depart: '2027-03-11', ret: '2027-03-21' });
  it('the lines call for 49 cells, 39 near today, and the pairs across the year', () => {
    expect(cellsCalledFor(whole.lines, Q.dep)).toBe(49);
    expect(
      cellsCalledFor(raw({ depart: '2026-10-18', ret: '2026-10-20' }).lines, asIsoDate('2026-10-20')),
    ).toBe(39);
    expect(cellsCalledFor(raw({ depart: '2027-03-11', ret: '2027-03-11' }).lines, Q.dep)).toBe(28);
    expect(
      cellsCalledFor(raw({ depart: '2026-12-28', ret: '2027-01-01' }).lines, asIsoDate('2026-12-30')),
    ).toBe(46);
  });
  it.each([
    ['one line', whole.lines.slice(0, 1)],
    ['three lines', [...whole.lines, whole.lines[1] ?? '']],
    ['six days on a line', [whole.lines[0]?.replace('Wed 17 Mar', '') ?? '', whole.lines[1] ?? '']],
    ['a wrong weekday', [whole.lines[0]?.replace('Thu 11 Mar', 'Fri 11 Mar') ?? '', whole.lines[1] ?? '']],
    ['six days on the returns line', [whole.lines[0] ?? '', whole.lines[1]?.replace('Sat 27 Mar', '') ?? '']],
    ['no lines', []],
  ])('lines that do not read (%s) call for no count', (_l, lines) => {
    expect(cellsCalledFor(lines, Q.dep)).toBeNull();
  });
  it('a view naming fewer cells than its lines call for is still drawing; a whole one is not', () => {
    expect(stillDrawing(whole.lines, 49, Q.dep)).toBe(false);
    expect(stillDrawing(whole.lines, 48, Q.dep)).toBe(true);
    expect(stillDrawing(whole.lines, 42, Q.dep)).toBe(true);
    expect(stillDrawing(whole.lines, 0, Q.dep)).toBe(true);
    const near = raw({ depart: '2026-10-18', ret: '2026-10-20' });
    expect(stillDrawing(near.lines, 39, asIsoDate('2026-10-20'))).toBe(false);
    expect(stillDrawing(near.lines, 38, asIsoDate('2026-10-20'))).toBe(true);
  });
  it('more cells than called for, or lines that do not read, are not waited on: the reading refuses them as it is', () => {
    expect(stillDrawing(whole.lines, 50, Q.dep)).toBe(false);
    expect(stillDrawing(whole.lines.slice(0, 1), 0, Q.dep)).toBe(false);
  });
});

describe('viewCounts', () => {
  it('counts the candidates, the priced-looking ones, the lines and their labels, and the selected lines', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    const names = [...r.candidates];
    names[0] = null;
    names[1] = 'No flights, 12 Mar to 21 Mar';
    expect(viewCounts({ ...r, candidates: names })).toEqual({
      candidates: 49,
      pricedLooking: 47,
      lines: 2,
      labelsLine1: 7,
      labelsLine2: 7,
      ranges: 1,
      prices: 1,
      dialog: 1,
      datesSelected: 1,
      grid: 1,
      scrollButtons: 4,
    });
  });
  it('counts a view with no lines as no labels', () => {
    const r = raw({ depart: '2027-03-11', ret: '2027-03-21' });
    expect(viewCounts({ ...r, lines: [] })).toMatchObject({ lines: 0, labelsLine1: 0, labelsLine2: 0 });
  });
});

describe('readRawView over the synthetic dialog', () => {
  it('a missing scroll button is counted out of the dates-grid check', async () => {
    const page = new FakePage(null);
    page.setTrees([
      n('document', '', [gridTree({ depart: '2027-03-11', ret: '2027-03-21', scroll: false })]),
    ]);
    page.url();
    const dialog = page.getByRole('dialog', { name: 'Price insights', exact: true });
    const r = await readRawView(
      dialog,
      dialog.getByRole('tabpanel').nth(0),
      fakeTimers().deadline(10_000),
      SELECTORS,
    );
    expect(r.datesGrid.scrollButtons).toBe(0);
  });
  it('an element whose text reads as null is read as no text, and matches nothing', async () => {
    const page = new FakePage(null);
    page.setTrees([n('document', '', [gridTree({ depart: '2027-03-11', ret: '2027-03-21' })])]);
    page.url();
    const dialog = page.getByRole('dialog', { name: 'Price insights', exact: true });
    const spy = vi.spyOn(FakeLocator.prototype, 'textContent').mockResolvedValue(null);
    try {
      const r = await readRawView(
        dialog,
        dialog.getByRole('tabpanel').nth(0),
        fakeTimers().deadline(10_000),
        SELECTORS,
      );
      expect([r.lines, r.ranges, r.prices]).toEqual([['', ''], [], []]);
    } finally {
      spy.mockRestore();
    }
  });
  // why: the live run of 2026-10-18 on 8885ba8 stopped at the first view: the range line is not an element of its own
  // (the recordings print it run together with the price, which is), so an anchored lookup found no range
  it.each(['shared', 'separate', 'spaced'] as const)(
    'reads the selected range and price when they sit %s',
    async (selectedForm) => {
      const page = new FakePage(null);
      page.setTrees([
        n('document', '', [gridTree({ depart: '2027-03-08', ret: '2027-03-18', selectedForm })]),
      ]);
      page.url();
      const t = fakeTimers();
      const dialog = page.getByRole('dialog', { name: 'Price insights', exact: true }).nth(0);
      const r = await readRawView(dialog, dialog.getByRole('tabpanel').nth(0), t.deadline(10_000), SELECTORS);
      expect(r.ranges).toEqual(['11 – 21 Mar 2027']);
      expect(r.prices).toHaveLength(1);
      const v = interpretView(r, asIsoDate('2027-03-11'), {
        dep: asIsoDate('2027-03-11'),
        ret: asIsoDate('2027-03-21'),
      });
      expect(v.kind).toBe('view');
    },
  );
  it('reads the lines, the candidates, the selected lines and the dates-grid check through locators', async () => {
    const page = new FakePage(null);
    page.setTrees([n('document', '', [gridTree({ depart: '2027-03-11', ret: '2027-03-21', rotate: 2 })])]);
    page.url();
    const t = fakeTimers();
    const dialog = page.getByRole('dialog', { name: 'Price insights', exact: true }).nth(0);
    const panel = dialog.getByRole('tabpanel').nth(0);
    const r = await readRawView(dialog, panel, t.deadline(10_000), SELECTORS);
    expect(r.lines).toEqual([
      '0000Sat 13 MarSun 14 MarMon 15 MarTue 16 MarWed 17 MarThu 11 MarFri 12 Mar0000',
      '0000Sun 21 MarMon 22 MarTue 23 MarWed 24 MarThu 25 MarFri 26 MarSat 27 Mar0000',
    ]);
    expect(r.candidates).toHaveLength(49);
    expect(r.ranges).toEqual(['14 – 24 Mar 2027']);
    expect(r.prices).toHaveLength(1);
    expect(r.datesGrid).toEqual({ dialog: 1, datesSelected: 1, grid: 1, scrollButtons: 4 });
    expect(interpretView(r, asIsoDate('2027-03-14'), Q).kind).toBe('view');
  });
});
