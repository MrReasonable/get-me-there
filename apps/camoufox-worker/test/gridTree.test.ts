// The synthetic grid builder holds recording 2's shape (WP15 PIE-16): the names in the recorded forms, the two lines,
// the four scroll buttons and the cells as the panel's own buttons, never the grid's.
import { beforeEach, describe, expect, it } from 'vitest';
import { descendants } from './support/fakePage.js';
import { cellName, dayLabel, gridTree, selectedLine } from './support/gridTree.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('gridTree', () => {
  it('builds 49 cells in rows of one return, the lines, the scroll buttons and the selected line', () => {
    const t = gridTree({ depart: '2027-03-11', ret: '2027-03-21', cheapest: [['2027-03-15', '2027-03-23']] });
    const panel = descendants([t]).find((x) => x.role === 'tabpanel');
    const kids = panel?.children ?? [];
    const buttons = kids.filter((x) => x.role === 'button').map((x) => x.name ?? '');
    expect(buttons.filter((b) => b.startsWith('Scroll'))).toEqual([
      'Scroll left',
      'Scroll right',
      'Scroll up',
      'Scroll down',
    ]);
    const cells = buttons.filter((b) => !b.startsWith('Scroll'));
    expect(cells).toHaveLength(49);
    expect(cells[0]).toMatch(/^£\d+, 11 Mar to 21 Mar$/);
    expect(cells[7]).toMatch(/^£\d+, 11 Mar to 22 Mar$/);
    expect(cells.filter((c) => c.includes(', cheapest price, '))).toHaveLength(1);
    expect(cells.find((c) => c.endsWith(', selected'))).toMatch(/, 14 Mar to 24 Mar, selected$/);
    expect(descendants([t]).find((x) => x.role === 'grid')?.children).toEqual([]);
    expect(kids.map((x) => x.name).filter((x) => x?.includes('Return'))).toEqual([
      'Sun 21 Mar Mon 22 Mar Tue 23 Mar Wed 24 Mar Thu 25 Mar Fri 26 Mar Sat 27 Mar 0000 Return',
    ]);
  });
  it('names the forms the recording shows', () => {
    expect(dayLabel('2027-03-11')).toBe('Thu 11 Mar');
    expect(cellName('2027-03-15', '2027-03-23', 397, { cheapest: true, selected: false })).toBe(
      '£397, cheapest price, 15 Mar to 23 Mar',
    );
    expect(cellName('2027-03-14', '2027-03-24', 1204, { cheapest: false, selected: true })).toBe(
      '£1,204, 14 Mar to 24 Mar, selected',
    );
    expect(selectedLine('2027-03-14', '2027-03-24', 462)).toBe('14 – 24 Mar 2027£462 · Round trip');
    expect(selectedLine('2026-12-27', '2027-01-06', 500)).toBe('27 Dec 2026 – 6 Jan 2027£500 · Round trip');
    expect(selectedLine('2027-03-28', '2027-04-07', 500)).toBe('28 Mar – 7 Apr 2027£500 · Round trip');
  });
  it('builds the labels form, the Price graph tab form and a dialog without scroll buttons', () => {
    const labels = gridTree({ depart: '2027-03-11', ret: '2027-03-21', labels: 'labels', scroll: false });
    const kids = descendants([labels]).find((x) => x.role === 'tabpanel')?.children ?? [];
    expect(kids.filter((x) => x.role === 'text' && /^\w{3} \d+ \w{3}$/.test(x.name ?? ''))).toHaveLength(14);
    expect(kids.some((x) => (x.name ?? '').startsWith('Scroll'))).toBe(false);
    const graph = gridTree({ depart: '2027-03-11', ret: '2027-03-21', tab: 'graph' });
    expect(descendants([graph]).some((x) => x.role === 'tabpanel')).toBe(false);
  });
});
