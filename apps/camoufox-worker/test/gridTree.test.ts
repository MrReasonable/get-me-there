// The synthetic grid builder holds the --grid recordings' shape (WP15 PIE-16): names in the recorded forms, two line
// elements whose text runs their labels together, 14 label elements, the cells as the panel's own buttons, the four
// scroll buttons, the range and price lines as separate elements, and the rotation a scroll leaves.
import { beforeEach, describe, expect, it } from 'vitest';
import { descendants } from './support/fakePage.js';
import { cellName, dayLabel, gridTree, selectedRange } from './support/gridTree.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('gridTree', () => {
  it('builds 49 cells in rows of one return, the lines, the scroll buttons and the selected lines', () => {
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
    const lines = kids
      .filter((x) => x.role === 'generic')
      .map((x) => x.text)
      .slice(0, 2);
    expect(lines).toEqual([
      '0000Thu 11 MarFri 12 MarSat 13 MarSun 14 MarMon 15 MarTue 16 MarWed 17 Mar0000',
      '0000Sun 21 MarMon 22 MarTue 23 MarWed 24 MarThu 25 MarFri 26 MarSat 27 Mar0000',
    ]);
    expect(
      descendants(kids).filter((x) => x.role === 'text' && /^\w{3} \d+ \w{3}$/.test(x.name ?? '')),
    ).toHaveLength(14);
    // why: as the recordings print it: the range runs into the price line's element, which holds the price as its own
    const selected = kids.at(-1);
    expect(selected?.text).toMatch(/^14 – 24 Mar 2027£\d+ · Round trip$/);
    expect(selected?.children?.map((x) => x.name)).toEqual([expect.stringMatching(/^£\d+ · Round trip$/)]);
  });
  it('rotates the departures and the cells as a scrolled view does', () => {
    const t = gridTree({ depart: '2027-03-27', ret: '2027-04-04', rotate: 6 });
    const kids = descendants([t]).find((x) => x.role === 'tabpanel')?.children ?? [];
    expect(kids.find((x) => x.role === 'generic')?.text).toBe(
      '0000Fri 2 AprSat 27 MarSun 28 MarMon 29 MarTue 30 MarWed 31 MarThu 1 Apr0000',
    );
    expect(kids.find((x) => x.role === 'button' && x.name?.startsWith('£'))?.name).toMatch(
      /, 2 Apr to 4 Apr$/,
    );
  });
  it('names the forms the recordings show', () => {
    expect(dayLabel('2027-03-11')).toBe('Thu 11 Mar');
    expect(cellName('2027-03-15', '2027-03-23', 397, { cheapest: true, selected: false })).toBe(
      '£397, cheapest price, 15 Mar to 23 Mar',
    );
    expect(cellName('2027-03-14', '2027-03-24', 1204, { cheapest: false, selected: true })).toBe(
      '£1,204, 14 Mar to 24 Mar, selected',
    );
    expect(selectedRange('2027-03-14', '2027-03-24')).toBe('14 – 24 Mar 2027');
    expect(selectedRange('2026-12-27', '2027-01-06')).toBe('27 Dec 2026 – 6 Jan 2027');
    expect(selectedRange('2027-03-28', '2027-04-07')).toBe('28 Mar – 7 Apr 2027');
    expect(selectedRange('2026-10-20', '2026-10-23')).toBe('20 – 23 Oct');
  });
  it('builds the Price graph tab form and a dialog without scroll buttons', () => {
    const none = gridTree({ depart: '2027-03-11', ret: '2027-03-21', scroll: false });
    const kids = descendants([none]).find((x) => x.role === 'tabpanel')?.children ?? [];
    expect(kids.some((x) => (x.name ?? '').startsWith('Scroll'))).toBe(false);
    const graph = gridTree({ depart: '2027-03-11', ret: '2027-03-21', tab: 'graph' });
    expect(descendants([graph]).some((x) => x.role === 'tabpanel')).toBe(false);
  });
});
