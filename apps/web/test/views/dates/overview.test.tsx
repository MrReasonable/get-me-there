import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  at,
  bucketsOf,
  DATES_SPACE,
  type DatesOptions,
  priced,
  pricedPair,
  workedDates,
} from '../../fixtures.dates.js';
import { poundsOutsidePrices } from '../../guards.js';
import { setViewportWidth } from '../../viewport.js';
import { boardRows, findBoard, renderDates } from './render.js';

// Spec §11 Dates "Overview": months, strips, the one scale, the numeric legend, the readout, rings both ways, folded
// bands, touch and the phone layout.

const overview = () => screen.getByTestId('dates-overview');
const cell = (date: string, from: number) => {
  const el = overview().querySelector<HTMLButtonElement>(`[data-cell="${date}|${from}"]`);
  if (el === null) throw new Error(`no cell ${date}|${from}`);
  return el;
};
const readout = () => screen.getByTestId('dates-readout');
const url = () => new URLSearchParams(window.location.search);

/** Twelve current calendar figures (£300–£410, so the scale is banded), one superseded, the rest no cached data. */
const twelve: DatesOptions = {
  rest: { no_data: 4 },
  pairs: {
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_x, i) => [
        at(`2027-03-${String(14 + i).padStart(2, '0')}`, 10),
        pricedPair(priced(30_000 + i * 1_000)),
      ]),
    ),
    [at('2027-03-31', 11)]: pricedPair(priced(10_000, { superseded: true })),
  },
};
/** The worked window with 13 stays (10–22 nights): seven bands of two nights and the last of one. */
const WIDE = { ...DATES_SPACE, maxNights: 22 };

describe('the overview (spec §11 Overview)', () => {
  it('draws the window’s months in order, each a table captioned by its name, with a strip of stay cells per day', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    const tables = within(overview()).getAllByRole('table');
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['Mar 2027', 'Apr 2027']);
    expect(overview().querySelectorAll('[data-cell]')).toHaveLength(93);
    expect(
      [...(cell('2027-03-14', 10).parentElement?.children ?? [])].map((c) => c.getAttribute('data-from')),
    ).toEqual(['10', '11', '12']);
  });

  it('no cell prints an amount', async () => {
    renderDates({ body: twelve });
    await findBoard();
    for (const c of overview().querySelectorAll('[data-cell]')) expect(c.textContent).not.toMatch(/£|\d/);
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('shades current figures on one scale by rank quintile; the legend prints each band’s range', async () => {
    renderDates({ body: twelve });
    await findBoard();
    expect(cell('2027-03-14', 10)).toHaveAttribute('data-shade', '0');
    expect(cell('2027-03-25', 10)).toHaveAttribute('data-shade', '4');
    const legend = screen.getByTestId('dates-legend');
    expect(legend).toHaveTextContent(
      'Shade: 12 current prices in view, in five bands by rank, darkest cheapest',
    );
    expect(legend).toHaveTextContent('band 1: £300–£320 (3 date pairs)');
    expect(legend).toHaveTextContent('band 5: £400–£410 (2 date pairs)');
  });

  it('a superseded figure is off the scale: no shade, its mark, counted in the legend', async () => {
    renderDates({ body: twelve });
    await findBoard();
    expect(cell('2027-03-31', 11)).toHaveAttribute('data-shade', 'none');
    expect(cell('2027-03-31', 11).getAttribute('data-marks')).toContain('superseded');
    expect(screen.getByTestId('dates-legend')).toHaveTextContent('superseded by a later search: 1');
  });

  it('fewer than ten figures give the flat shade, and the legend says so', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(cell('2027-03-14', 10)).toHaveAttribute('data-shade', 'flat');
    expect(screen.getByTestId('dates-legend')).toHaveTextContent(
      'One shade for 9 current prices: fewer than 10 are too few for price bands',
    );
  });

  it('the stay filter applies first: only the stays in view are drawn, and the shading is over them', async () => {
    renderDates({ body: twelve, search: '?view=dates&def=def-0001&d.nights=11-12' });
    await findBoard();
    expect(overview().querySelectorAll('[data-cell]')).toHaveLength(62);
    expect(overview().querySelector('[data-from="10"]')).toBeNull();
    expect(screen.getByTestId('dates-legend')).toHaveTextContent('No current price in view to shade');
  });

  it('a calendar figure carries the "not checked" glyph', async () => {
    renderDates({ body: twelve });
    await findBoard();
    expect(cell('2027-03-14', 10).getAttribute('data-marks')).toBe('notChecked');
    expect(within(cell('2027-03-14', 10)).getByTestId('cell-glyphs')).toHaveTextContent('◫');
  });
});

describe('the readout and the cell’s names (spec §11 Overview)', () => {
  it('pointing at a cell shows its date pair beside the legend: dates, nights, the figure through PriceCell with point of sale, how far checked, airports', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(readout()).toHaveTextContent('Point at or focus a cell to read its date pair here.');
    fireEvent.pointerOver(cell('2027-03-22', 11));
    const r = readout();
    expect(r).toHaveTextContent('22 Mar 2027–2 Apr 2027 (11n)');
    expect(within(r).getByTestId('price-cell')).toHaveTextContent('£330');
    expect(within(r).getByTestId('point-of-sale')).toHaveTextContent('market not stated');
    expect(r).toHaveTextContent('cheapest of the rows read');
    expect(r).toHaveTextContent('read was cut short');
    expect(r).toHaveTextContent('LGW → JFK');
  });

  it('a cell without a figure reads its marks with their counts by bucket', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    fireEvent.pointerOver(cell('2027-03-18', 10));
    expect(readout()).toHaveTextContent('error');
    expect(readout()).toHaveTextContent('3 no cached data · 1 error');
    expect(within(readout()).queryByTestId('price-cell')).toBeNull();
  });

  it('a cell’s accessible name gives its dates, nights and rank or mark in words, and its description is the readout', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(cell('2027-03-14', 10)).toHaveAccessibleName('14 Mar 2027–24 Mar 2027, 10 nights: rank 1');
    expect(cell('2027-03-17', 10)).toHaveAccessibleName('17 Mar 2027–27 Mar 2027, 10 nights: no fares');
    const described = cell('2027-03-14', 10).getAttribute('aria-describedby');
    expect(described).toBe(readout().id);
    fireEvent.focus(cell('2027-03-14', 10));
    expect(within(readout()).getByTestId('price-cell')).toBeInTheDocument();
  });
});

describe('rings both ways (spec §11 Rings)', () => {
  it('the board’s shown rows are ringed by an outline; hovering a row lights its cell and a ringed cell lights its row; nothing scrolls', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderDates({ body: workedDates() });
    const table = await findBoard();
    const ringed = [...overview().querySelectorAll('[data-ringed]')];
    expect(ringed).toHaveLength(10);
    expect(ringed[0]?.className).toContain('shadow-[inset_0_0_0_2px_#000,inset_0_0_0_3px_#fff]');
    // the 11th-ranked date pair (not seen, 20 Mar) is not on the shown board
    expect(cell('2027-03-20', 10)).not.toHaveAttribute('data-ringed');
    fireEvent.pointerEnter(boardRows(table)[0] ?? table);
    expect(cell('2027-03-14', 10)).toHaveAttribute('data-lit');
    fireEvent.pointerLeave(boardRows(table)[0] ?? table);
    expect(cell('2027-03-14', 10)).not.toHaveAttribute('data-lit');
    fireEvent.pointerOver(cell('2027-03-15', 10));
    expect(boardRows(table)[1]).toHaveAttribute('data-lit');
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe('folded bands (spec §11 Folded bands)', () => {
  const wide: DatesOptions = {
    space: WIDE,
    rest: { no_data: 4 },
    pairs: {
      [at('2027-03-14', 13)]: pricedPair(priced(30_000)),
      [at('2027-03-15', 20)]: { buckets: bucketsOf({ no_data: 3 }) },
    },
  };

  it('a stay range of 13 folds into seven bands, each named by its range; a band shows its cheapest figure’s shade and the stripes when any date pair in it has a cell not searched', async () => {
    renderDates({ body: wide });
    await findBoard();
    expect(cell('2027-03-14', 12).parentElement?.children).toHaveLength(7);
    expect(cell('2027-03-14', 12)).toHaveAttribute('data-band', '12-13');
    expect(cell('2027-03-14', 12)).toHaveAttribute('data-shade', 'flat');
    expect(cell('2027-03-15', 20).getAttribute('data-marks')).toBe('partly');
    expect(cell('2027-03-14', 12)).toHaveAccessibleName(
      'departing 14 Mar 2027, 12–13 nights: rank 1, opens its stay lengths',
    );
  });

  it('a click opens the band into its stays for that month; the band’s header button and Escape close it', async () => {
    const { user } = renderDates({ body: wide });
    await findBoard();
    await user.click(cell('2027-03-14', 12));
    expect(cell('2027-03-14', 12).parentElement?.children).toHaveLength(8);
    expect(cell('2027-03-14', 13)).toHaveAccessibleName('14 Mar 2027–27 Mar 2027, 13 nights: rank 1');
    // April stays folded
    expect(cell('2027-04-01', 12).parentElement?.children).toHaveLength(7);
    expect(url().get('view')).toBe('dates');
    await user.click(screen.getByRole('button', { name: 'Close 12–13 nights in Mar 2027' }));
    expect(cell('2027-03-14', 12).parentElement?.children).toHaveLength(7);
    await user.click(cell('2027-03-14', 12));
    cell('2027-03-14', 13).focus();
    await user.keyboard('{Escape}');
    expect(cell('2027-03-14', 12).parentElement?.children).toHaveLength(7);
    expect(document.activeElement).toBe(cell('2027-03-14', 12));
  });

  it('a band cell without a figure reads its marks and its buckets summed', async () => {
    renderDates({ body: wide });
    await findBoard();
    fireEvent.pointerOver(cell('2027-03-15', 20));
    expect(readout()).toHaveTextContent('departing 15 Mar 2027, 20–21 nights');
    expect(readout()).toHaveTextContent('partly not searched');
    expect(readout()).toHaveTextContent('by airport pair: 7 no cached data, 1 not searched');
  });

  it('a ring on a date pair inside a closed band rings the band', async () => {
    renderDates({ body: wide });
    await findBoard();
    expect(cell('2027-03-14', 12)).toHaveAttribute('data-ringed');
  });
});

describe('opening the detail', () => {
  it('a click on a cell opens the detail with the date pair in the URL', async () => {
    const { user } = renderDates({ body: workedDates() });
    await findBoard();
    await user.click(cell('2027-03-17', 10));
    expect([url().get('view'), url().get('depart'), url().get('return')]).toEqual([
      'results',
      '2027-03-17',
      '2027-03-27',
    ]);
  });

  it('touch: a first tap shows the readout, a second tap on the same cell opens the detail', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    const c = cell('2027-03-15', 10);
    fireEvent.pointerDown(c, { pointerType: 'touch' });
    fireEvent.click(c);
    expect(url().get('view')).toBe('dates');
    expect(readout()).toHaveTextContent('15 Mar 2027–25 Mar 2027 (10n)');
    fireEvent.pointerDown(c, { pointerType: 'touch' });
    fireEvent.click(c);
    expect(url().get('depart')).toBe('2027-03-15');
  });

  it('the readout’s "Open these dates" link opens the detail', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    fireEvent.pointerDown(cell('2027-03-15', 10), { pointerType: 'touch' });
    fireEvent.click(cell('2027-03-15', 10));
    const link = screen.getByRole('link', { name: 'Open these dates' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('depart')).toBe(
      '2027-03-15',
    );
  });
});

describe('the phone overview (spec §11 Phone)', () => {
  it('one month at a time with Previous and Next, each day a row with its strip; the legend and readout present', async () => {
    setViewportWidth(375);
    const { user } = renderDates({ body: workedDates() });
    await screen.findAllByTestId('board-card');
    expect(within(overview()).getByRole('region', { name: 'Mar 2027' })).toBeInTheDocument();
    expect(within(overview()).queryByRole('region', { name: 'Apr 2027' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(within(overview()).getByRole('region', { name: 'Apr 2027' })).toBeInTheDocument();
    expect(within(overview()).getAllByRole('listitem')).toHaveLength(13);
    expect(screen.getByTestId('dates-legend')).toBeInTheDocument();
    expect(readout()).toBeInTheDocument();
  });

  it('a swipe turns the month; the readout stays while it does', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    await screen.findAllByTestId('board-card');
    fireEvent.pointerDown(cell('2027-03-14', 10), { pointerType: 'touch' });
    fireEvent.click(cell('2027-03-14', 10));
    expect(readout()).toHaveTextContent('14 Mar 2027');
    fireEvent.pointerDown(overview().firstElementChild ?? overview(), { pointerType: 'touch', clientX: 300 });
    fireEvent.pointerUp(overview().firstElementChild ?? overview(), { pointerType: 'touch', clientX: 100 });
    await waitFor(() =>
      expect(within(overview()).getByRole('region', { name: 'Apr 2027' })).toBeInTheDocument(),
    );
    expect(readout()).toHaveTextContent('14 Mar 2027');
  });
});
