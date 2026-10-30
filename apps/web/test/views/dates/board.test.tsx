import { decodeDatePairs } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { parseDatesState } from '../../../src/state/datesState.js';
import { BoardTable } from '../../../src/views/Dates/BoardTable.js';
import { boardModel } from '../../../src/views/Dates/board.js';
import { at, datesResponse, priced, pricedPair, verifiedFig, workedDates } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import { expectConsoleErrors, poundsOutsidePrices } from '../../guards.js';
import { NOW, renderWithProviders } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';
import { boardRows, cellsOf, findBoard, renderDates } from './render.js';

// Spec §11 Dates "Board" and "Phone", and §9's provenance rule: every amount through PriceCell.

const search = (q = '') => `?view=dates&def=def-0001${q}`;

describe('the board (spec §11 Board)', () => {
  it('is a table captioned "Best dates", with the order note, the columns, and 10 rows then "Show 10 more"', async () => {
    const { user } = renderDates({ body: workedDates() });
    const table = await findBoard();
    expect(table.querySelector('caption')).toHaveTextContent(
      'Prices a later search no longer found rank after current ones.',
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Rank', 'Depart', 'Return', 'Nights', 'Price', 'How far checked', 'Journey time', 'Airports']);
    expect(boardRows(table)).toHaveLength(10);
    expect(table).toHaveTextContent('showing 10 of 11 date pairs with a price');
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(boardRows(table)).toHaveLength(11);
    expect(table).toHaveTextContent('showing 11 of 11 date pairs with a price');
    expect(screen.queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('rows are in rankDatePairs order: cheapest first, prices a later search no longer found after current ones', async () => {
    const { user } = renderDates({ body: workedDates() });
    const table = await findBoard();
    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    const rows = boardRows(table);
    expect(rows.map((r) => cellsOf(r)[0])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    expect(cellsOf(rows[0] ?? table).slice(1, 4)).toEqual(['14 Mar 2027', '24 Mar 2027', '10']);
    // the superseded (31000) and not-seen (32000) figures are cheaper than most, and rank last
    expect(rows[9]).toHaveTextContent('superseded by a later search');
    expect(rows[10]).toHaveTextContent('not seen in latest search (30h ago)');
  });

  it('sorts by departure, nights, price and journey time with aria-sort; a second press reverses; the rank stays', async () => {
    const { user } = renderDates({ body: workedDates() });
    const table = await findBoard();
    const header = (name: string) => within(table).getByRole('button', { name }).closest('th');
    expect(header('Price')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(table).getByRole('button', { name: 'Nights' }));
    expect(new URLSearchParams(window.location.search).get('d.sort')).toBe('nights.asc');
    expect(header('Nights')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Price')).not.toHaveAttribute('aria-sort');
    const nights = boardRows(table).map((r) => Number(cellsOf(r)[3]));
    expect(nights).toEqual([...nights].sort((a, b) => a - b));
    // the rank column keeps each date pair's price rank
    expect(boardRows(table).map((r) => cellsOf(r)[0])).not.toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
    await user.click(within(table).getByRole('button', { name: 'Nights' }));
    expect(new URLSearchParams(window.location.search).get('d.sort')).toBe('nights.desc');
    expect(header('Nights')).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(table).getByRole('button', { name: 'Price' }));
    expect(new URLSearchParams(window.location.search).get('d.sort')).toBeNull();
  });

  it('the price sort says, in its accessible description, that current prices come first', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    expect(within(table).getByRole('button', { name: 'Price' })).toHaveAccessibleDescription(
      'current prices first, then by price',
    );
  });

  it('a journey-time sort puts an unknown journey time last, reversed or not', async () => {
    renderDates({ body: workedDates(), search: search('&d.sort=journey.desc') });
    const table = await findBoard();
    const journeys = boardRows(table).map((r) => cellsOf(r)[6] ?? '');
    // the two verified figures state 14h 10m; every calendar figure's journey time is not known, and sorts last
    expect(journeys.slice(0, 2).every((j) => j.startsWith('14h 10m'))).toBe(true);
    expect(journeys.slice(2).every((j) => j.startsWith('not known'))).toBe(true);
  });

  it('"cached from £X (LGW → EWR)" through PriceCell, with its own destination, beside the verified figure', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    const row = boardRows(table).find((r) => cellsOf(r)[1] === '14 Mar 2027' && cellsOf(r)[3] === '11');
    const cached = within(row ?? table).getByTestId('cheaper-cached');
    expect(cached).toHaveTextContent(/^cached from/);
    expect(cached).toHaveTextContent('(LGW → EWR)');
    expect(within(cached).getByTestId('price-cell')).toHaveTextContent('£299');
    expect(within(cached).getByTestId('price-cell')).toHaveTextContent('EWR');
  });

  it('marks a truncated figure "cheapest of the rows read" and its how far checked says the read was cut short', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    const row = boardRows(table).find((r) => cellsOf(r)[1] === '22 Mar 2027');
    expect(row).toHaveTextContent('cheapest of the rows read');
    expect(cellsOf(row ?? table)[5]).toContain('read was cut short');
    expect(cellsOf(row ?? table)[7]).toBe('LGW → JFK');
  });

  it('point of sale in words on each row, from the price’s provenance', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    for (const r of boardRows(table))
      expect(within(r).getAllByTestId('point-of-sale')[0]).toHaveTextContent('market not stated');
  });

  it('journey time "not known", and "journey time not known" on a kept row under a journey filter', async () => {
    renderDates({ body: workedDates({ maxJourneyMinutes: 900 }), search: search('&d.journey=900') });
    const table = await findBoard();
    const calendar = boardRows(table)[0];
    expect(cellsOf(calendar ?? table)[6]).toBe('journey time not known');
  });

  it('"arrives HH:MM" for each direction, "+1" and the date in words for assistive technology on an overnight arrival', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    const row = boardRows(table).find((r) => cellsOf(r)[3] === '11' && cellsOf(r)[1] === '14 Mar 2027');
    const [out, back] = within(row ?? table).getAllByTestId('arrives');
    expect(out).toHaveTextContent('out: arrives 06:40 +1');
    expect(out?.querySelector('.sr-only')).toHaveTextContent('(arrives on Monday 15 March 2027)');
    expect(back).toHaveTextContent('back: arrives 21:05');
    expect(back?.querySelector('.sr-only')).toBeNull();
  });

  it('no arrival on a figure whose data does not carry one', async () => {
    renderDates({ body: workedDates() });
    const table = await findBoard();
    expect(within(boardRows(table)[0] ?? table).queryAllByTestId('arrives')).toEqual([]);
  });

  it('each row’s dates are a real link to the detail carrying the figure’s basis, and a click on the row follows it', async () => {
    const { user } = renderDates({ body: workedDates(), search: search('&d.to=JFK') });
    const table = await findBoard();
    const link = within(boardRows(table)[0] ?? table).getByRole('link', {
      name: 'Open 14 Mar 2027 to 24 Mar 2027',
    });
    const href = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(Object.fromEntries(href.searchParams)).toMatchObject({
      view: 'results',
      def: 'def-0001',
      'd.to': 'JFK',
      depart: '2027-03-14',
      return: '2027-03-24',
      basis: 'calendar',
    });
    const before = window.history.length;
    // a click on the second row's "how far checked" cell, away from its link
    await user.click(boardRows(table)[1]?.querySelectorAll('td')[5] ?? table);
    expect(window.history.length).toBe(before + 1);
    const p = new URLSearchParams(window.location.search);
    expect([p.get('view'), p.get('depart'), p.get('return')]).toEqual([
      'results',
      '2027-03-15',
      '2027-03-25',
    ]);
  });

  it('the week switch shows one row per departure week and says how many weeks', async () => {
    renderDates({ body: workedDates(), search: search('&d.week=best') });
    const table = await findBoard();
    expect(table).toHaveTextContent('best per departure week: 6 weeks');
    expect(boardRows(table)).toHaveLength(6);
  });

  it('every amount on the board renders inside a PriceCell', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(poundsOutsidePrices()).toEqual([]);
  });
});

describe('the phone board (spec §11 Phone: below 900 px)', () => {
  it('ends with the phone key naming the face’s provider marks and glyphs in words', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    await screen.findAllByTestId('board-card');
    const key = screen.getByTestId('phone-key');
    expect(key).toHaveTextContent(COPY.datesView.phoneKey.providers);
    expect(key).toHaveTextContent(COPY.datesView.phoneKey.glyphs);
  });

  it('the desktop board shows no phone key', async () => {
    setViewportWidth(1280);
    renderDates({ body: workedDates() });
    await findBoard();
    expect(screen.queryByTestId('phone-key')).toBeNull();
  });

  it('is stacked cards, each a link to the detail: dates and the PriceCell face lead, then how far checked, journey, airports; no point of sale', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    const cards = await screen.findAllByTestId('board-card');
    // the departure board: the cards are the same table's rows, its roles kept explicitly for the stacked layout
    const table = screen.getByRole('table', { name: /^Best dates/ });
    expect(boardRows(table)).toEqual(cards);
    for (const c of cards) expect(c).toHaveAttribute('role', 'row');
    expect(cards).toHaveLength(10);
    const first = cards[0] ?? document.body;
    const link = within(first).getByRole('link');
    expect(link.getAttribute('href')).toContain('depart=2027-03-14');
    const face = within(first).getByTestId('price-cell');
    expect(face).toHaveAttribute('data-face');
    expect(within(face).getByTestId('face-provider')).toHaveTextContent('syn JFK');
    expect(within(face).getByTestId('face-unchecked')).toHaveTextContent('not checked');
    expect(first.textContent?.indexOf('14 Mar 2027')).toBeLessThan(
      first.textContent?.indexOf('calendar price') ?? 0,
    );
    expect(first).toHaveTextContent('LHR → JFK');
    expect(first).not.toHaveTextContent('market');
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('a truncated figure’s card says "cheapest of the rows read" and that the read was cut short', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    const cards = await screen.findAllByTestId('board-card');
    const card = cards.find((c) => c.textContent?.includes('22 Mar 2027'));
    expect(card).toHaveTextContent('cheapest of the rows read');
    expect(card).toHaveTextContent('read was cut short');
  });
});

describe('provenance on every price (spec §9 item 6: two seams)', () => {
  it('a figure whose provenance lacks a required field renders the price boundary’s message and no amount', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance|The above error occurred/);
    const decoded = decodeDatePairs(
      datesResponse({ pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) } }),
    );
    // why: the decoded type carries a full Provenance; the seam is what PriceCell does with one that is not, so the
    // field is removed at runtime from a copy, never through a cast
    const broken = structuredClone(decoded.pairs);
    for (const p of broken)
      if (p.figure !== null) Reflect.deleteProperty(p.figure.price.provenance, 'fetchedAt');
    const state = parseDatesState(new URLSearchParams(), definition());
    renderWithProviders(
      <BoardTable
        definition={definition()}
        data={{ ...decoded, pairs: broken }}
        model={boardModel(broken, state, NOW)}
        state={state}
        runActive={false}
        visible={10}
        onShowMore={() => undefined}
        lit={null}
        onLight={() => undefined}
        token={0}
        animate={vi.fn()}
        captionRef={createRef()}
        onHold={() => undefined}
        update={null}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('price withheld: provenance missing or invalid');
    expect(document.body.textContent).not.toContain('£300');
  });

  it('a body whose provenance index is out of range fails the contract: the view shows its load error and no amount', async () => {
    const body = datesResponse({ pairs: { [at('2027-03-14', 10)]: pricedPair(priced(30_000)) } });
    renderDates({ body: { ...body, figures: { ...body.figures, provenance: [99] } } });
    expect(await screen.findByText(/^Could not load:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('£');
  });
});

describe('a verified figure without a cheaper calendar price shows none', () => {
  it('no "cached from" line', async () => {
    renderDates({ body: { pairs: { [at('2027-03-14', 10)]: pricedPair(verifiedFig()) } } });
    const table = await findBoard();
    expect(within(table).queryByTestId('cheaper-cached')).toBeNull();
    expect(cellsOf(boardRows(table)[0] ?? table)[5]).toMatch(/^verified/);
  });
});
