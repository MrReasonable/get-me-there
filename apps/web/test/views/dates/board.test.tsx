import { decodeDatePairs } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { parseDatesState } from '../../../src/state/datesState.js';
import { BoardTable } from '../../../src/views/Dates/BoardTable.js';
import { boardModel } from '../../../src/views/Dates/board.js';
import {
  at,
  calendarFig,
  datesResponse,
  figurePairing,
  pairingFig,
  priced,
  pricedPair,
  provCached,
  provGrid,
  verifiedFig,
  workedDates,
} from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import {
  flightList,
  flightListsResponse,
  flightPair,
  listedFlight,
  pairingList,
} from '../../fixtures.searches.js';
import { expectConsoleErrors, poundsOutsidePrices } from '../../guards.js';
import { askedPairs, FLIGHT_LISTS_URL, serveFlightLists } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { NOW, renderWithProviders } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';
import { boardRows, cellsOf, findBoard, renderDates, tierBreak } from './render.js';

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
    // why: design 2026-11-08 §5.1: the fresh verified figure (a trip with flights read) leads the cheaper calendar prices,
    // which follow by price
    expect(cellsOf(rows[0] ?? table).slice(1, 4)).toEqual(['14 Mar 2027', '25 Mar 2027', '11']);
    expect(cellsOf(rows[1] ?? table).slice(1, 4)).toEqual(['14 Mar 2027', '24 Mar 2027', '10']);
    // the superseded (31000) and not-seen (32000) figures are cheaper than most, and rank last; between the two, the tier
    // (design 2026-11-08 §5.1) puts the not-seen verified figure before the superseded calendar price
    expect(rows[9]).toHaveTextContent('not seen in latest search (30h ago)');
    expect(rows[10]).toHaveTextContent('superseded by a later search');
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
    // why: the first row is now the verified figure (design 2026-11-08 §5.1); the calendar price is the second
    const calendar = boardRows(table)[1];
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
    // why: the first row is the verified figure, which carries its times; the calendar price is the second
    expect(within(boardRows(table)[1] ?? table).queryAllByTestId('arrives')).toEqual([]);
  });

  it('each row’s dates are a real link to the detail carrying the figure’s basis, and a click on the row follows it', async () => {
    const { user } = renderDates({ body: workedDates(), search: search('&d.to=JFK') });
    const table = await findBoard();
    // why: design 2026-11-08 §5.1: the calendar price is the second row, after the verified figure
    const link = within(boardRows(table)[1] ?? table).getByRole('link', {
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
    // a click on the third row's "how far checked" cell, away from its link
    await user.click(boardRows(table)[2]?.querySelectorAll('td')[5] ?? table);
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
    // why: design 2026-11-08 §5.1: the first card is the verified figure; the second is the calendar price whose face
    // says "not checked"
    const first = cards[1] ?? document.body;
    const link = within(first).getByRole('link');
    expect(link.getAttribute('href')).toContain('depart=2027-03-14');
    const face = within(first).getByTestId('price-cell');
    expect(face).toHaveAttribute('data-face');
    expect(within(face).getByTestId('face-provider')).toHaveTextContent('syn JFK');
    expect(within(face).getByTestId('face-unchecked')).toHaveTextContent('not checked');
    expect(first.textContent?.indexOf('14 Mar 2027')).toBeLessThan(
      first.textContent?.indexOf('constraints not checked') ?? 0,
    );
    expect(first).toHaveTextContent('LHR → JFK');
    expect(first).not.toHaveTextContent('market');
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('a card, which has no column heads, words an unknown journey time "journey time not known"', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    const cards = await screen.findAllByTestId('board-card');
    const card = cards.find((c) => c.textContent?.includes('22 Mar 2027'));
    expect(card).toHaveTextContent('journey time not known');
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
    expect(cellsOf(boardRows(table)[0] ?? table)[5]).toMatch(/^checked fares, verified/);
  });
});

// --- WP21 Task 21.7: the pairing figure and the flight read beneath a calendar figure (spec rev 56 §6.9, §11 Board) ---

describe('a pairing figure on the board (spec rev 56 §6.9, §11 Board; R-board, R-grid)', () => {
  /** One date pair (14 → 24 Mar, index 0) with `figure`, a real cached figure's neighbour cheaper below it. */
  const board = (figure: ReturnType<typeof pairingFig>, def = definition()) => {
    renderDates({
      body: {
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(figure),
          [at('2027-03-15', 10)]: pricedPair(
            priced(130_000, { price: { ...priced(130_000).price, provenance: provCached() } }),
          ),
        },
      },
      def,
    });
    return findBoard();
  };
  const rowOf = (table: HTMLElement) => {
    const row = table.querySelector<HTMLElement>('tr[data-pair="0"]');
    if (row === null) throw new Error('no row');
    return row;
  };

  it('its price through PriceCell with the flight-list source, its age and "not checked"; the seller line and times beneath', async () => {
    const row = rowOf(await board(pairingFig()));
    const price = within(row).getAllByTestId('price-cell')[0];
    if (price === undefined) throw new Error('no price');
    expect(price).toHaveTextContent('£1,180');
    expect(within(price).getByTestId('provenance')).toHaveTextContent(
      "the browser worker's flight list, the cheapest of the sellers read for these two flights",
    );
    expect(within(price).getByTestId('provenance')).toHaveTextContent('constraints not checked');
    expect(within(price).getByTestId('provenance')).toHaveTextContent(/4h/);
    expect(within(row).getByTestId('pairing-seller')).toHaveTextContent(
      'QQ Travel · cheapest of 3 offers read',
    );
    expect(within(row).getByTestId('pairing-times')).toHaveTextContent('Out: 07:15 · Back: 14:20');
    expect(row).not.toHaveTextContent(/verified/i);
  });

  // why: design 2026-11-08 §4.1 (operator ruling 2026-11-08): a pairing leads at the seller's price when complete offers
  // were read, else at Google's price, and says which; a "from" price names no seller (sellerOf would throw on one)
  it("a complete pairing words its price as the seller's, with the seller line", async () => {
    const row = rowOf(await board(pairingFig()));
    expect(within(row).getByTestId('pairing-kind')).toHaveTextContent("seller's price");
    expect(within(row).getByTestId('pairing-seller')).toHaveTextContent('QQ Travel');
  });

  it.each([
    [0, "Google's price, sellers not read"],
    [3, "Google's price, not every seller read"],
  ])(
    'a pairing leading at the from price (%i offers read) words it %s, with no seller line',
    async (offersRead, words) => {
      const pairing = figurePairing({
        isFrom: true,
        seller: null,
        fare: null,
        complete: false,
        offersRead,
        mismatch: false,
      });
      const row = rowOf(await board(pairingFig({ pairing })));
      expect(within(row).getByTestId('pairing-kind')).toHaveTextContent(words);
      expect(within(row).queryByTestId('pairing-seller')).toBeNull();
      expect(row).not.toHaveTextContent('cheapest of 3 offers read');
      const price = within(row).getAllByTestId('price-cell')[0];
      expect(within(price ?? row).getByTestId('provenance')).toHaveTextContent(
        "Google's price for these two flights",
      );
      expect(row).toHaveTextContent(words);
    },
  );

  // why: spec rev 62 (Ian, 2026-11-06): a date keeps its last real round trip after the refresh, marked older
  it('an older pairing still leads its row, marked older than the refresh, with its seller line', async () => {
    const older = figurePairing({ stale: 'refresh', ageHours: 40 });
    const row = rowOf(
      await board(
        pairingFig({ pairing: older, price: { ...pairingFig().price, stale: 'refresh', ageHours: 40 } }),
      ),
    );
    expect(row).toHaveAttribute('data-state', 'stale');
    const price = within(row).getAllByTestId('price-cell')[0];
    expect(price).toHaveTextContent('£1,180');
    expect(price).toHaveTextContent("older than this search's refresh");
    expect(within(row).getByTestId('pairing-seller')).toHaveTextContent(
      'QQ Travel · cheapest of 3 offers read',
    );
  });

  it('21.7 persona H2 / ui-005, code M3: a short row, named once by its visible lines, the long words its description', async () => {
    const row = rowOf(await board(pairingFig()));
    // why: the name is the visible seller line and "2nd outbound tried", said once (aria-labelledby)
    const group = within(row).getByRole('group', {
      name: 'QQ Travel · cheapest of 3 offers read 2nd outbound tried',
    });
    expect(group).toHaveAccessibleDescription(
      "next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits)",
    );
    expect(within(row).getByTestId('pairing-which')).toHaveTextContent('2nd outbound tried');
    // the long explanation is not a visible line of the row
    expect(within(row).getByTestId('pairing-which')).not.toHaveTextContent('next-cheapest');
    expect(within(row).getAllByRole('group')).toHaveLength(1);
  });

  it('the one-attempt read: no "2nd outbound tried"; its description the cheapest outbound', async () => {
    const row = rowOf(await board(pairingFig({ pairing: figurePairing({ which: 'cheapest' }) })));
    const group = within(row).getByRole('group', { name: 'QQ Travel · cheapest of 3 offers read' });
    expect(group).toHaveAccessibleDescription('cheapest outbound read within your limits');
    expect(within(row).queryByTestId('pairing-which')).toBeNull();
  });

  it('"Google listed from £1,180" through PriceCell when the group says the offer differs from the "from" price', async () => {
    const p = figurePairing({ pricePence: 119_500, mismatch: true });
    const row = rowOf(await board(pairingFig({ pairing: p })));
    const mark = within(row).getByTestId('pairing-mismatch');
    expect(mark).toHaveTextContent(/^Google listed from/);
    expect(within(mark).getByTestId('price-cell')).toHaveTextContent('£1,180');
  });

  it('no mismatch mark when they agree', async () => {
    const row = rowOf(await board(pairingFig()));
    expect(within(row).queryByTestId('pairing-mismatch')).toBeNull();
  });

  it('the grid price beneath through PriceCell compact, with its own source, time, age and stale mark', async () => {
    const row = rowOf(
      await board(
        pairingFig({
          gridPrice: { pricePence: 56_400, provenance: provGrid(), stale: 'refresh', truncated: false },
        }),
      ),
    );
    const grid = within(row).getByTestId('pairing-grid');
    // why: 21.7 prov-003: the line names its own source ("<source> showed £N")
    expect(grid).toHaveTextContent(/^the date grid showed/);
    expect(grid).toHaveTextContent(/· 10 Oct 09:30$/);
    const cell = within(grid).getByTestId('price-cell');
    expect(cell).toHaveTextContent('£564');
    expect(cell).toHaveTextContent("older than this search's refresh");
    expect(within(cell).getByTestId('face-age')).toHaveTextContent('not checked');
  });

  it('a grid price from another source names it ("the Aviasales cache")', async () => {
    const row = rowOf(
      await board(
        pairingFig({
          gridPrice: { pricePence: 56_400, provenance: provCached(), stale: false, truncated: false },
        }),
      ),
    );
    const grid = within(row).getByTestId('pairing-grid');
    expect(grid).toHaveTextContent(/^the Aviasales cache showed/);
    expect(grid).toHaveTextContent(/· 14:00$/);
    expect(grid).not.toHaveTextContent('date grid');
  });

  it('"airline settings not applied to flights read" when the search sets airlines or layovers, nothing when none', async () => {
    const airlines = definition({
      constraints: { maxJourneyMinutes: 1500, includeAirlines: ['VS'] },
    });
    expect(
      within(rowOf(await board(pairingFig(), airlines))).getByTestId('pairing-settings'),
    ).toHaveTextContent('airline settings not applied to flights read');
  });

  it('a layover setting says it too', async () => {
    const layovers = definition({ constraints: { maxJourneyMinutes: 1500, maxLayoverMinutes: 240 } });
    expect(
      within(rowOf(await board(pairingFig(), layovers))).getByTestId('pairing-settings'),
    ).toBeInTheDocument();
  });

  it('no airline or layover setting: no settings line', async () => {
    expect(within(rowOf(await board(pairingFig()))).queryByTestId('pairing-settings')).toBeNull();
  });

  // why: design 2026-11-08 §5.1 (operator ruling 2026-11-08): a pairing figure is a trip with flights read, so it ranks
  // before a cheaper calendar price; this replaces "ranks below a cheaper calendar one"
  it('the rank puts the pairing figure (£1,180) before a cheaper calendar one', async () => {
    renderDates({
      body: {
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(pairingFig()),
          [at('2027-03-15', 10)]: pricedPair(
            priced(100_000, { price: { ...priced(100_000).price, provenance: provCached() } }),
          ),
        },
      },
    });
    const table = await findBoard();
    expect(boardRows(table).map((r) => [cellsOf(r)[0], cellsOf(r)[1]])).toEqual([
      ['1', '14 Mar 2027'],
      ['2', '15 Mar 2027'],
    ]);
  });

  it('the phone card says the same: the seller line, the times, the grid price beneath', async () => {
    setViewportWidth(375);
    try {
      const table = await board(pairingFig());
      const card = rowOf(table);
      expect(card).toHaveAttribute('data-testid', 'board-card');
      expect(within(card).getByTestId('pairing-seller')).toHaveTextContent(
        'QQ Travel · cheapest of 3 offers read',
      );
      expect(within(card).getByTestId('pairing-times')).toHaveTextContent('Out: 07:15 · Back: 14:20');
      expect(within(within(card).getByTestId('pairing-grid')).getByTestId('price-cell')).toHaveTextContent(
        '£564',
      );
      expect(within(card).getAllByTestId('price-cell')[0]).toHaveTextContent('not checked');
    } finally {
      setViewportWidth(1280);
    }
  });

  it('every amount in the row renders inside a PriceCell', async () => {
    await board(pairingFig({ pairing: figurePairing({ pricePence: 119_500, mismatch: true }) }));
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it("21.7 persona coverage: the board's head says for how many of the date pairs shown a seller price was read", async () => {
    const table = await board(pairingFig());
    expect(within(table).getByTestId('seller-coverage')).toHaveTextContent(
      'seller prices read for 1 of the 2 date pairs shown',
    );
  });

  it('no seller-price line when no pairing figure is shown', async () => {
    renderDates({
      body: {
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(
            calendarFig({ pairingRead: 'within-older', pairing: figurePairing({ stale: 'refresh' }) }),
          ),
        },
      },
    });
    const table = await findBoard();
    expect(within(table).queryByTestId('seller-coverage')).toBeNull();
  });
});

describe('a calendar figure says its flight read (spec rev 56 §6.9, §11 Board; R-heads)', () => {
  const D = COPY.datesView;
  const figureRow = async (over: Parameters<typeof calendarFig>[0], available = false) => {
    if (available) server.use(serveFlightLists((d, r) => flightPair(d, r), { pagesPlanned: 2 }));
    renderDates({
      body: {
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(
            calendarFig({ price: { ...calendarFig().price, provenance: provCached() }, ...over }),
          ),
        },
      },
    });
    const table = await findBoard();
    const row = table.querySelector<HTMLElement>('tr[data-pair="0"]');
    if (row === null) throw new Error('no row');
    return row;
  };
  const older = figurePairing({ stale: 'refresh', ageHours: 216 });

  it('within-older: "return flights read 9d ago, older than this search\'s refresh:" and the pairing beneath with its age', async () => {
    const row = await figureRow({ pairingRead: 'within-older', pairing: older });
    const beneath = within(row).getByTestId('flight-read');
    expect(beneath).toHaveTextContent("return flights read 9d ago, older than this search's refresh:");
    const cell = within(beneath).getByTestId('price-cell');
    expect(cell).toHaveTextContent('£1,180');
    // why: the lead says the stale words, so the price beneath it carries the glyph (its words for screen readers)
    expect(within(cell).getByTestId('stale-glyph')).toBeInTheDocument();
    expect(within(cell).getByText("older than this search's refresh")).toHaveClass('sr-only');
    expect(beneath).toHaveTextContent('QQ Travel · cheapest of 3 offers read');
    expect(beneath).toHaveTextContent('Out: 07:15 · Back: 14:20');
  });

  // why: final review B-M2: the board leads with the block's own words for a limit edit
  it('within-other-limits: "your limits have changed since these return flights were read:" with the pairing beneath', async () => {
    const row = await figureRow({ pairingRead: 'within-other-limits', pairing: figurePairing() });
    const beneath = within(row).getByTestId('flight-read');
    expect(beneath).toHaveTextContent(/^your limits have changed since these return flights were read:/);
    expect(within(beneath).getByTestId('price-cell')).toHaveTextContent('£1,180');
  });

  const from = figurePairing({
    pricePence: 118_000,
    fromPence: 118_000,
    isFrom: true,
    seller: null,
    offersRead: 0,
    complete: false,
  });

  it('21.7 code I3: over-limit with an offer read: the same offer beneath (never the "from" price), as the block shows it', async () => {
    const row = await figureRow({
      pairingRead: 'over-limit',
      pairing: figurePairing({
        which: 'over-limit',
        pricePence: 121_000,
        fromPence: 120_400,
        mismatch: true,
        offersRead: 1,
      }),
    });
    const beneath = within(row).getByTestId('flight-read');
    expect(beneath).toHaveTextContent(/^no pairing within your limits read/);
    const line = within(beneath).getByTestId('flight-read-pairing');
    expect(line).not.toHaveTextContent(/^from/);
    expect(line).toHaveTextContent('QQ Travel · cheapest of 1 offer read');
    expect(within(line).getAllByTestId('price-cell')[0]).toHaveTextContent('£1,210');
  });

  it('21.7 code M12 / prov-008: a pairing beneath whose offer differs from its "from" price names both', async () => {
    const row = await figureRow({
      pairingRead: 'offers-incomplete',
      pairing: figurePairing({ pricePence: 119_500, mismatch: true }),
    });
    const mark = within(row).getByTestId('flight-read-mismatch');
    expect(mark).toHaveTextContent(/^Google listed from/);
    expect(within(mark).getByTestId('price-cell')).toHaveTextContent('£1,180');
    expect(
      within(within(row).getByTestId('flight-read-pairing')).getAllByTestId('price-cell')[0],
    ).toHaveTextContent('£1,195');
  });

  it('over-limit: "no pairing within your limits read" with the pairing beneath as its "from" price', async () => {
    const row = await figureRow({
      pairingRead: 'over-limit',
      pairing: { ...from, which: 'over-limit', pricePence: 120_400, fromPence: 120_400 },
    });
    const beneath = within(row).getByTestId('flight-read');
    expect(beneath).toHaveTextContent(/^no pairing within your limits read/);
    // why: final review B-M2: "sellers not read" on every "from" price, as the block's Back line says it
    expect(within(beneath).getByTestId('flight-read-pairing')).toHaveTextContent(/^from.*· sellers not read/);
    expect(within(beneath).getByTestId('price-cell')).toHaveTextContent('£1,204');
  });

  it('sellers-not-read: "from £1,180 · sellers not read" beneath the grid price', async () => {
    const row = await figureRow({ pairingRead: 'sellers-not-read', pairing: from });
    const line = within(row).getByTestId('flight-read-pairing');
    expect(line).toHaveTextContent(/^from.*£1,180.*· sellers not read/);
    // the grid price leads: the row's first PriceCell is the calendar figure's own
    expect(within(row).getAllByTestId('price-cell')[0]).toHaveTextContent('£312');
  });

  // why: design 2026-11-08 §4.1: offers that may be incomplete show Google's "from" price beneath, never an offer's
  it('incomplete offers beneath: the from price, "not every seller read", no seller named', async () => {
    const row = await figureRow({
      pairingRead: 'within-older',
      pairing: figurePairing({
        isFrom: true,
        seller: null,
        fare: null,
        complete: false,
        offersRead: 2,
        stale: 'refresh',
      }),
    });
    const line = within(row).getByTestId('flight-read-pairing');
    expect(line).toHaveTextContent(/^from.*not every seller read/);
    expect(line).not.toHaveTextContent('cheapest of');
  });

  it.each([
    ['no-pairing-read', 'no return flight read'],
    ['outbound-only', 'return leg not read'],
  ] as const)('%s: "%s"', async (read, words) => {
    const row = await figureRow({ pairingRead: read });
    expect(within(row).getByTestId('flight-read')).toHaveTextContent(words);
    expect(within(within(row).getByTestId('flight-read')).queryByTestId('price-cell')).toBeNull();
  });

  it('the 21.6 ruling: a failed newest list reads "flights couldn\'t be read: <its reason in words>", never "return leg not read"', async () => {
    const row = await figureRow({ pairingRead: 'list-failed', listReason: 'monthly-cap' });
    const line = within(row).getByTestId('flight-read');
    expect(line).toHaveTextContent(/^flights couldn't be read: /);
    expect(line).toHaveTextContent("flights couldn't be read: the browser worker's monthly limit is used up");
    expect(line).not.toHaveTextContent(D.pairingRead['outbound-only']);
  });

  it('not-read: "flights not checked" where flight lists are read for this search, nothing where they are not', async () => {
    const row = await figureRow({}, true);
    await waitFor(() =>
      expect(within(row).getByTestId('flight-read')).toHaveTextContent('flights not checked'),
    );
  });

  it('not-read where flight lists are not read here says nothing (once the flight-lists answer says so)', async () => {
    const row = await figureRow({});
    await screen.findByTestId('flights-unavailable');
    expect(within(row).queryByTestId('flight-read')).toBeNull();
  });

  it('21.7 prov-004: while the flight-lists request is pending a not-read row says "loading flights", then its mark', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get(FLIGHT_LISTS_URL, async ({ request }) => {
        await gate;
        const pairs = askedPairs(new URL(request.url)).map((k) => {
          const [dep = '', ret = ''] = k.split('_');
          return flightPair(dep, ret);
        });
        return HttpResponse.json(flightListsResponse(pairs, { pagesPlanned: 2 }));
      }),
    );
    let row: HTMLElement | null = null;
    try {
      row = await figureRow({});
      expect(within(row).getByTestId('flight-read')).toHaveTextContent('loading flights');
      expect(within(row).getByTestId('flight-read')).not.toHaveTextContent('flights not checked');
    } finally {
      release();
    }
    const shown = row;
    if (shown === null) throw new Error('no row');
    await waitFor(() =>
      expect(within(shown).getByTestId('flight-read')).toHaveTextContent('flights not checked'),
    );
  });

  it('21.7 prov-004: a failed flight-lists request says so once above the board, and every not-read row keeps its mark', async () => {
    server.use(
      http.get(FLIGHT_LISTS_URL, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'failed' } }, { status: 500 }),
      ),
    );
    const row = await figureRow({});
    const line = await screen.findByTestId('flights-load-failed');
    expect(line).toHaveTextContent("flights couldn't be loaded; prices shown without flights");
    expect(within(row).getByTestId('flight-read')).toHaveTextContent('flights not checked');
    // why: above the board: the line comes before the table
    const table = row.closest('table');
    if (table === null) throw new Error('no table');
    expect(line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the phone card says the same', async () => {
    setViewportWidth(375);
    try {
      const row = await figureRow({ pairingRead: 'within-older', pairing: older });
      expect(row).toHaveAttribute('data-testid', 'board-card');
      expect(within(row).getByTestId('flight-read')).toHaveTextContent(
        "return flights read 9d ago, older than this search's refresh:",
      );
    } finally {
      setViewportWidth(1280);
    }
  });
});

// Design 2026-11-08 §5.1: one real price per row. A trip with flights read shows its price, whose it is, when it was read,
// its times, journey time and changes each way; a calendar price stands in the secondary style, with what is known of
// its flights; Google's list "from" figure is in the opened detail, not on the closed row.
describe('one price per row (design 2026-11-08 §5.1)', () => {
  const D = COPY.datesView;
  /** One date pair (index 0) with `figure`; flight lists are served so the row's button and changes can appear. */
  const rowFor = async (figure: ReturnType<typeof calendarFig>, lists = false) => {
    if (lists) server.use(serveFlightLists((d, r) => flightPair(d, r), { pagesPlanned: 2 }));
    const r = renderDates({
      body: {
        discoveryProviders: ['travelpayouts', 'camoufox'],
        pairs: { [at('2027-03-14', 10)]: pricedPair(figure) },
      },
    });
    const table = await findBoard();
    const row = table.querySelector<HTMLElement>('tr[data-pair="0"]');
    if (row === null) throw new Error('no row');
    return { ...r, row, table };
  };

  describe('a trip with flights read', () => {
    // why: final whole-branch review I2: a read trip's journey time is its own legs' (the api sends it on the figure),
    // never "not known", and the Journey column sorts it by that value with the verified figures
    it('shows its journey time in the Journey column', async () => {
      const { row } = await rowFor(pairingFig());
      expect(cellsOf(row)[6]).toMatch(/^26h 55m/);
      expect(row).not.toHaveTextContent('not known');
    });

    it.each([
      ['asc', ['14h 10m', '26h 55m', 'not known']],
      ['desc', ['26h 55m', '14h 10m', 'not known']],
    ])('sorts by its journey time among the others (%s)', async (dir, order) => {
      renderDates({
        body: {
          discoveryProviders: ['travelpayouts', 'camoufox'],
          pairs: {
            [at('2027-03-14', 10)]: pricedPair(pairingFig()),
            [at('2027-03-15', 10)]: pricedPair(priced(41_200, { basis: 'verified', journeyMinutes: 850 })),
            [at('2027-03-16', 10)]: pricedPair(priced(30_000)),
          },
        },
        search: search(`&d.sort=journey.${dir}`),
      });
      const table = await findBoard();
      const journeys = boardRows(table).map((r) => cellsOf(r)[6] ?? '');
      expect(journeys.map((j) => order.find((o) => j.startsWith(o)) ?? j)).toEqual(order);
    });

    it('shows when it was read, in words that need no hover, beside its kind and times', async () => {
      const { row } = await rowFor(pairingFig());
      expect(within(row).getByTestId('read-age')).toHaveTextContent('read 4h ago');
      expect(within(row).getByTestId('pairing-kind')).toHaveTextContent("seller's price");
      expect(within(row).getByTestId('pairing-times')).toHaveTextContent('Out: 07:15 · Back: 14:20');
      // a fresh trip carries no older-trip mark
      expect(within(row).getByTestId('read-age')).not.toHaveAttribute('data-older');
    });

    it('an older leading trip also shows its age label', async () => {
      const older = figurePairing({ stale: 'refresh', ageHours: 40 });
      const { row } = await rowFor(
        pairingFig({ pairing: older, price: { ...pairingFig().price, stale: 'refresh', ageHours: 40 } }),
      );
      const label = within(row).getByTestId('read-age');
      expect(label).toHaveAttribute('data-older');
      expect(label).toHaveTextContent(/^read .* ago$/);
    });

    it.each([
      [figurePairing(), "seller's price"],
      [
        figurePairing({ isFrom: true, seller: null, fare: null, complete: false, offersRead: 0 }),
        "Google's price, sellers not read",
      ],
      [
        figurePairing({ isFrom: true, seller: null, fare: null, complete: false, offersRead: 3 }),
        "Google's price, not every seller read",
      ],
    ])('says whose price it is (%#): %s', async (pairing, words) => {
      const { row } = await rowFor(pairingFig({ pairing }));
      expect(within(row).getByTestId('pairing-kind')).toHaveTextContent(words);
    });

    // design 2026-11-08 §5.1: changes each way, from the board's own list, only when it is the figure's own trip
    it('shows the changes each way when the served list pairs the same flights as the figure', async () => {
      server.use(
        serveFlightLists(
          (d, r) =>
            flightPair(
              d,
              r,
              d === '2027-03-14' ? { list: pairingList({ departureDate: d, returnDate: r }) } : {},
            ),
          { pagesPlanned: 2 },
        ),
      );
      const { row } = await rowFor(pairingFig());
      await waitFor(() =>
        expect(within(row).getByTestId('pairing-changes')).toHaveTextContent(
          '14h 50m, 1 change out · 12h 05m, 1 change back',
        ),
      );
    });

    it('says each direction\'s journey time with its changes, "direct" for none, and wraps on a phone', async () => {
      const base = pairingList({ departureDate: '2027-03-14', returnDate: '2027-03-24' });
      const read = base.returns;
      if (read === null) throw new Error('the pairing fixture has a return read');
      const direct = pairingList({
        departureDate: '2027-03-14',
        returnDate: '2027-03-24',
        flights: base.flights.map((f) => ({ ...f, stops: 0 })),
        returns: {
          ...read,
          // only the second attempt (the pairing's own): the first must keep having no return within the limits
          attempts: read.attempts.map((a, at) =>
            at === 1 ? { ...a, returns: a.returns.map((r) => ({ ...r, stops: 0 })) } : a,
          ),
        },
      });
      server.use(
        serveFlightLists((d, r) => flightPair(d, r, d === '2027-03-14' ? { list: direct } : {}), {
          pagesPlanned: 2,
        }),
      );
      setViewportWidth(375);
      try {
        const { row } = await rowFor(pairingFig());
        const line = await within(row).findByTestId('pairing-changes');
        expect(line).toHaveTextContent('14h 50m, direct out · 12h 05m, direct back');
        // like its neighbours: a block that wraps, never a no-wrap that could push the card wider
        expect(line).toHaveClass('block');
        expect(line.className).not.toMatch(/nowrap/);
      } finally {
        setViewportWidth(1280);
      }
    });

    it('shows no changes line when the list pairs other flights than the figure shows', async () => {
      server.use(
        serveFlightLists(
          (d, r) =>
            flightPair(
              d,
              r,
              d === '2027-03-14' ? { list: pairingList({ departureDate: d, returnDate: r }) } : {},
            ),
          { pagesPlanned: 2 },
        ),
      );
      const { row } = await rowFor(pairingFig({ pairing: figurePairing({ departOut: '09:00' }) }));
      await screen.findByRole('button', { name: /^Show flights/ });
      expect(within(row).queryByTestId('pairing-changes')).toBeNull();
    });

    it('the phone card says when it was read too', async () => {
      setViewportWidth(375);
      try {
        const { row } = await rowFor(pairingFig());
        expect(row).toHaveAttribute('data-testid', 'board-card');
        expect(within(row).getByTestId('read-age')).toHaveTextContent('read 4h ago');
      } finally {
        setViewportWidth(1280);
      }
    });
  });

  describe('a calendar row', () => {
    const calendar = (over: Partial<ReturnType<typeof calendarFig>> = {}) =>
      calendarFig({
        price: { ...calendarFig().price, pricePence: 56_500, provenance: provCached() },
        ...over,
      });

    it('shows "calendar £565" in the secondary style', async () => {
      const { row } = await rowFor(calendar());
      const price = within(row).getByTestId('calendar-price');
      expect(price).toHaveClass('price-secondary');
      expect(price.textContent).toMatch(/calendar\s*£565/);
    });

    it('a trip is not styled as secondary', async () => {
      const { row } = await rowFor(pairingFig());
      expect(within(row).queryByTestId('calendar-price')).toBeNull();
    });

    it('says "flights not checked" for a date whose flights were never read, and only then', async () => {
      const { row } = await rowFor(calendar({ pairingRead: 'not-read' }), true);
      await waitFor(() =>
        expect(within(row).getByTestId('flight-read')).toHaveTextContent('flights not checked'),
      );
    });

    it.each([
      ['outbound-only', 'return leg not read'],
      ['no-pairing-read', 'no return flight read'],
      ['over-limit', 'no pairing within your limits read'],
    ] as const)('%s: "%s", never "flights not checked"', async (read, words) => {
      const over = figurePairing({
        isFrom: true,
        seller: null,
        fare: null,
        complete: false,
        offersRead: 0,
        which: 'over-limit',
      });
      const { row } = await rowFor(
        calendar({ pairingRead: read, ...(read === 'over-limit' ? { pairing: over } : {}) }),
      );
      const line = within(row).getByTestId('flight-read');
      expect(line).toHaveTextContent(words);
      expect(line).not.toHaveTextContent('flights not checked');
    });

    it('list-failed: "flights couldn\'t be read: <reason>"', async () => {
      const { row } = await rowFor(calendar({ pairingRead: 'list-failed', listReason: 'monthly-cap' }));
      const line = within(row).getByTestId('flight-read');
      expect(line).toHaveTextContent("flights couldn't be read: ");
      expect(line).not.toHaveTextContent('flights not checked');
    });

    it('within-older: the return flights read, older than the refresh', async () => {
      const older = figurePairing({ stale: 'refresh', ageHours: 216 });
      const { row } = await rowFor(calendar({ pairingRead: 'within-older', pairing: older }));
      expect(within(row).getByTestId('flight-read')).toHaveTextContent(
        "return flights read 9d ago, older than this search's refresh:",
      );
    });

    it('within-other-limits: your limits have changed since', async () => {
      const { row } = await rowFor(
        calendar({ pairingRead: 'within-other-limits', pairing: figurePairing() }),
      );
      expect(within(row).getByTestId('flight-read')).toHaveTextContent(D.pairingOtherLimits);
    });

    it.each(['sellers-not-read', 'offers-incomplete'] as const)(
      '%s: the wire codes that are never produced now say nothing',
      async (read) => {
        const { row } = await rowFor(calendar({ pairingRead: read, pairing: figurePairing() }));
        expect(within(row).getByTestId('flight-read')).not.toHaveTextContent('flights not checked');
      },
    );
  });

  describe('the closed row has no Google list figure', () => {
    it('shows no "Google\'s list: from" until its flights are opened', async () => {
      server.use(
        serveFlightLists(
          (d, r) =>
            flightPair(d, r, {
              list: flightList({
                departureDate: d,
                returnDate: r,
                minMinor: 9_200,
                flights: [listedFlight()],
              }),
            }),
          { pagesPlanned: 2 },
        ),
      );
      const { row, user } = await rowFor(calendarFig({ pairingRead: 'not-read' }));
      const button = await within(row).findByRole('button', { name: /^Show flights/ });
      expect(row).not.toHaveTextContent("Google's list: from");
      expect(document.body).not.toHaveTextContent("Google's list: from");
      await user.click(button);
      expect(document.querySelector('[data-flights-for="0"]')).toHaveTextContent("Google's list: from");
    });

    // why: final whole-branch review: the hidden part follows the visible words, so the name reads once, never
    // "Show flights flights for …"
    it("names the row's dates in the button's accessible name, each word once", async () => {
      const { row, user } = await rowFor(calendarFig({ pairingRead: 'not-read' }), true);
      const button = await within(row).findByRole('button', { name: /^Show flights/ });
      expect(button).toHaveAccessibleName('Show flights for 14 Mar 2027 to 24 Mar 2027');
      await user.click(button);
      expect(button).toHaveAccessibleName('Hide flights for 14 Mar 2027 to 24 Mar 2027');
    });
  });
});

// Design 2026-11-08 §5.2: a labelled break between the trips with flights read and the dates led by a calendar price; a
// trip and a calendar price at one price are not one tie.
describe('tiers on screen (design 2026-11-08 §5.2)', () => {
  const trip = (pence: number) =>
    pairingFig({
      pairing: figurePairing({ pricePence: pence, fromPence: pence }),
      price: { ...pairingFig().price, pricePence: pence },
    });
  const render = async (pairs: Record<string, ReturnType<typeof pricedPair>>) => {
    renderDates({ body: { discoveryProviders: ['travelpayouts', 'camoufox'], pairs } });
    return findBoard();
  };

  it('puts a labelled break between the read trips and the rows not checked yet', async () => {
    const table = await render({
      [at('2027-03-14', 10)]: pricedPair(trip(118_000)),
      [at('2027-03-15', 10)]: pricedPair(
        priced(90_000, { price: { ...priced(90_000).price, provenance: provCached() } }),
      ),
      [at('2027-03-16', 10)]: pricedPair(
        priced(95_000, { price: { ...priced(95_000).price, provenance: provCached() } }),
      ),
    });
    const rows = [...table.querySelectorAll<HTMLElement>('tbody > tr')];
    expect(rows.map((r) => (r.classList.contains('tier-break') ? 'break' : (r.dataset.pair ?? '?')))).toEqual(
      ['0', 'break', '3', '6'],
    );
    expect(tierBreak(table)).toHaveTextContent(/^Calendar prices only$/);
  });

  // a read trip that is not current ranks after every current one, so it can follow the calendar rows: no break there
  it('a not-current read trip after the calendar rows is not drawn under the break', async () => {
    const table = await render({
      [at('2027-03-14', 10)]: pricedPair(trip(118_000)),
      [at('2027-03-15', 10)]: pricedPair(
        priced(90_000, { price: { ...priced(90_000).price, provenance: provCached() } }),
      ),
      [at('2027-03-16', 10)]: pricedPair(verifiedFig({ notSeenInLatest: { ageHours: 30 } })),
    });
    const rows = [...table.querySelectorAll<HTMLElement>('tbody > tr')];
    expect(rows.map((r) => (r.classList.contains('tier-break') ? 'break' : (r.dataset.pair ?? '?')))).toEqual(
      ['0', 'break', '3', '6'],
    );
    expect(table.querySelectorAll('tr.tier-break')).toHaveLength(1);
    expect(rows[3]).toHaveAttribute('data-state', 'superseded');
  });

  it('has no break when every row is a trip, or when none is', async () => {
    const trips = await render({
      [at('2027-03-14', 10)]: pricedPair(trip(118_000)),
      [at('2027-03-15', 10)]: pricedPair(trip(119_000)),
    });
    expect(tierBreak(trips)).toBeNull();
  });

  it('no break when none is a trip', async () => {
    const table = await render({
      [at('2027-03-14', 10)]: pricedPair(priced(90_000)),
      [at('2027-03-15', 10)]: pricedPair(priced(95_000)),
    });
    expect(tierBreak(table)).toBeNull();
  });

  it('a read trip and a calendar row at the same price are not one tie group', async () => {
    const table = await render({
      [at('2027-03-14', 10)]: pricedPair(trip(90_000)),
      [at('2027-03-15', 10)]: pricedPair(priced(90_000)),
      [at('2027-03-16', 10)]: pricedPair(priced(90_000)),
    });
    // the two calendar rows are a tie of two; the trip beside them at the same price is not part of it
    const lines = [...table.querySelectorAll('tr.tie-row')];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(/^2 /);
  });
});

// Design 2026-11-08 §5.3: rows are closed by default (10 rows were a 14,000 px page); a keyboard-operable button opens a
// row's detail.
describe('closed rows (design 2026-11-08 §5.3)', () => {
  const ten = () => {
    const pairs: Record<string, ReturnType<typeof pricedPair>> = {};
    for (let d = 0; d < 10; d += 1)
      pairs[at(`2027-03-${String(14 + d).padStart(2, '0')}`, 10)] = pricedPair(priced(90_000 + d * 100));
    return pairs;
  };
  const renderTen = async () => {
    server.use(serveFlightLists((d, r) => flightPair(d, r), { pagesPlanned: 2 }));
    const r = renderDates({ body: { discoveryProviders: ['travelpayouts', 'camoufox'], pairs: ten() } });
    await findBoard();
    await screen.findAllByRole('button', { name: /^Show flights/ });
    return r;
  };

  it('with 10 rows no flights block renders until its button is pressed', async () => {
    const { user } = await renderTen();
    expect(screen.getAllByRole('button', { name: /^Show flights/ })).toHaveLength(10);
    expect(document.querySelectorAll('[data-flights-for]')).toHaveLength(0);
    const [first] = screen.getAllByRole('button', { name: /^Show flights/ });
    if (first === undefined) throw new Error('no button');
    await user.click(first);
    expect(document.querySelectorAll('[data-flights-for]')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Show flights/ })).toHaveLength(9);
  });

  it('the button says whether its row is open and names the detail it controls', async () => {
    const { user } = await renderTen();
    const [button] = screen.getAllByRole('button', { name: /^Show flights/ });
    if (button === undefined) throw new Error('no button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const controls = button.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? '')).toBeNull();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('Hide flights');
    expect(document.getElementById(controls ?? '')).toBe(document.querySelector('[data-flights-for="0"]'));
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelectorAll('[data-flights-for]')).toHaveLength(0);
  });

  it('pressing the button is not a click on the row: the detail does not open', async () => {
    const { user } = await renderTen();
    const [button] = screen.getAllByRole('button', { name: /^Show flights/ });
    if (button === undefined) throw new Error('no button');
    await user.click(button);
    expect(new URLSearchParams(window.location.search).get('date')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('dates');
  });
});

// Design 2026-11-08 §5.4: within a tie the rows are numbered in the order shown.
describe('ranks in a tie (design 2026-11-08 §5.4)', () => {
  it('three tied pairs reordered by their flights show 1, 2, 3 top to bottom', async () => {
    const times = ['16:00', '07:00', '10:00'];
    const pairs: Record<string, ReturnType<typeof pricedPair>> = {};
    for (const [i] of times.entries())
      pairs[at(`2027-03-${String(14 + i).padStart(2, '0')}`, 10)] = pricedPair(priced(90_000));
    server.use(
      serveFlightLists((d, r) => {
        const i = Number(d.slice(-2)) - 14;
        return flightPair(d, r, {
          list: flightList({
            departureDate: d,
            returnDate: r,
            minMinor: 9_000,
            flights: [listedFlight({ departsLocal: times[i] ?? '12:00', amountMinor: 9_000 })],
          }),
        });
      }),
    );
    renderDates({ body: { discoveryProviders: ['travelpayouts', 'camoufox'], pairs } });
    const table = await findBoard();
    // the earliest outbound leads the tie once the lists land: 15 Mar (07:00), 16 Mar (10:00), 14 Mar (16:00)
    const dated = () => boardRows(table).filter((r) => r.dataset.pair !== undefined);
    await waitFor(() =>
      expect(dated().map((r) => cellsOf(r)[1])).toEqual(['15 Mar 2027', '16 Mar 2027', '14 Mar 2027']),
    );
    expect(dated().map((r) => cellsOf(r)[0])).toEqual(['1', '2', '3']);
  });
});
