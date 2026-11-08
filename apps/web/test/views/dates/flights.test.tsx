import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { addDays, asIsoDate, asIsoDateTime, SEARCH_LINK_LABEL } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import { googleFlightsHref } from '../../../src/views/Dates/flightLines.js';
import {
  at,
  type DatesOptions,
  type PairOver,
  priced,
  pricedPair,
  provCached,
} from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import {
  failedList,
  flightList,
  flightListsResponse,
  flightPair,
  listedFlight,
} from '../../fixtures.searches.js';
import { poundsOutsidePrices } from '../../guards.js';
import {
  askedPairs,
  FLIGHT_LISTS_URL,
  serveFlightLists,
  serveFlightRead,
} from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { setViewportWidth } from '../../viewport.js';
import { JARGON, mainPathWords } from './jargon.js';
import { autoOpenFlights, findBoard, renderDates } from './render.js';

// Spec rev 55 §11 "Flights" and "Ties", §6.9 (the outcome beside the price and the difference line) and §2 (the
// provenance note): the flights block of a search's page. The worked example only: LHR, LGW → JFK, EWR over 14 Mar –
// 13 Apr 2027, 10–12 nights (the date pair at index 3·day + nights − 10); NOW is 2026-10-14T15:00Z (16:00 London), so a
// list read at 10:44Z reads "11:44" today. The search's limits are the fixture definition's: 25 h longest journey and
// arrivals 06:00–23:00.

/** A real cached source, so the difference line names it ("the Aviasales cache"); fetched 12 Oct 09:30 London. */
const CACHED = provCached({ fetchedAt: asIsoDateTime('2026-10-12T08:30:00.000Z') });

/** A priced date pair on LHR → JFK at `pence`, from the Aviasales cache. */
const pair = (pence: number, over: Parameters<typeof priced>[1] = {}): PairOver =>
  pricedPair(priced(pence, { price: { ...priced(pence).price, provenance: CACHED }, ...over }));

/** The return date of a departure and its nights (the space's dates, by hand). */
const RETURNS: Record<string, string> = {
  '2027-03-14/10': '2027-03-24',
  '2027-03-15/10': '2027-03-25',
  '2027-03-16/10': '2027-03-26',
  '2027-03-17/10': '2027-03-27',
  '2027-03-18/10': '2027-03-28',
  '2027-03-19/10': '2027-03-29',
  '2027-03-20/10': '2027-03-30',
};

/** The worked board: seven date pairs at distinct prices, each with its own kind of list below. */
const BOARD: DatesOptions = {
  discoveryProviders: ['travelpayouts', 'camoufox'],
  pairs: {
    [at('2027-03-14', 10)]: pair(8_600),
    [at('2027-03-15', 10)]: pair(9_000),
    [at('2027-03-16', 10)]: pair(9_500),
    [at('2027-03-17', 10)]: pair(9_700),
    [at('2027-03-18', 10)]: pair(9_900),
    [at('2027-03-19', 10)]: pair(10_500),
    [at('2027-03-20', 10)]: pair(11_000),
  },
};

/** Six flights on 14 → 24 Mar: three within the limits shown, one over 25 h, two more within. */
const SIX = [
  listedFlight(),
  listedFlight({
    departsLocal: '10:00',
    arrivesLocal: '21:40',
    arrivesDayOffset: 0,
    durationMinutes: 700,
    stops: 0,
    amountMinor: 9_500,
  }),
  listedFlight({
    departsLocal: '12:00',
    arrivesLocal: '22:20',
    arrivesDayOffset: 0,
    durationMinutes: 800,
    amountMinor: 9_900,
  }),
  listedFlight({
    departsLocal: '06:00',
    arrivesLocal: '08:00',
    durationMinutes: 1_560,
    stops: 2,
    amountMinor: 12_000,
  }),
  listedFlight({
    departsLocal: '08:00',
    arrivesLocal: '20:00',
    arrivesDayOffset: 0,
    durationMinutes: 900,
    amountMinor: 12_500,
  }),
  listedFlight({
    departsLocal: '09:00',
    arrivesLocal: '21:50',
    arrivesDayOffset: 0,
    durationMinutes: 950,
    amountMinor: 14_000,
  }),
];

/** Each date pair's entry on the worked board. */
function workedEntry(dep: string, ret: string) {
  const key = Object.entries(RETURNS).find(([, r]) => r === ret)?.[0] ?? '';
  const entry = (over: Parameters<typeof flightPair>[2]) => flightPair(dep, ret, over);
  switch (key) {
    case '2027-03-14/10':
      return entry({ list: flightList({ flights: SIX, minMinor: 9_200, tabMinor: 8_000 }) });
    case '2027-03-15/10':
      return entry({
        list: flightList({
          id: 2,
          departureDate: dep,
          returnDate: ret,
          listed: 'none-for-cell',
          flights: [],
          minMinor: null,
          optionsOtherCell: 2,
          optionsUnparsed: 1,
        }),
      });
    case '2027-03-16/10':
      return entry({
        list: flightList({
          id: 3,
          departureDate: dep,
          returnDate: ret,
          listed: 'no-flights',
          flights: [],
          minMinor: null,
        }),
      });
    case '2027-03-17/10':
      return entry({ list: failedList('monthly-cap', { id: 4, departureDate: dep, returnDate: ret }) });
    case '2027-03-18/10':
      return entry({
        listOtherPair: flightList({
          id: 5,
          origin: 'LGW',
          destination: 'EWR',
          departureDate: dep,
          returnDate: ret,
          minMinor: 9_100,
          flights: [listedFlight({ amountMinor: 9_100 })],
        }),
      });
    case '2027-03-20/10':
      // why: a list reused from 100 h before NOW: 2026-10-10T10:44Z, 11:44 London on 10 Oct
      return entry({
        list: flightList({
          id: 7,
          departureDate: dep,
          returnDate: ret,
          fetchedAt: '2026-10-10T10:44:00.000Z',
          ageHours: 100,
          stale: 'refresh',
          minMinor: 11_000,
          flights: [listedFlight({ amountMinor: 11_000 })],
        }),
      });
    default:
      return entry({});
  }
}

const rowOf = (index: number) => {
  const r = document.querySelector<HTMLElement>(`tr[data-pair="${index}"]`);
  if (r === null) throw new Error(`no board row for date pair ${index}`);
  return r;
};
const blockOf = (index: number) => {
  const b = document.querySelector<HTMLElement>(`[data-flights-for="${index}"]`);
  if (b === null) throw new Error(`no flights block for date pair ${index}`);
  return b;
};
// why: design 2026-11-08 §5.1 — Google's list "from" figure moved from beside the price into the opened detail
const outcomeOf = (index: number) => {
  const detail = document.querySelector<HTMLElement>(`[data-flights-for="${index}"]`);
  return detail === null ? null : within(detail).queryByTestId('flight-outcome');
};
/** The board's rows by date pair index, top to bottom. */
const order = () =>
  [...document.querySelectorAll<HTMLElement>('tr[data-pair]')].map((r) => Number(r.dataset.pair));

/** Renders the worked board with its lists, and waits until the first list is drawn. */
async function renderWorked(o: { board?: DatesOptions; over?: Parameters<typeof serveFlightLists>[1] } = {}) {
  const requests: URL[] = [];
  server.use(serveFlightLists(workedEntry, o.over ?? {}, requests));
  const r = renderDates({ body: o.board ?? BOARD });
  await findBoard();
  await waitFor(() => expect(document.querySelector('[data-flights-for]')).not.toBeNull());
  return { ...r, requests };
}

// why: design 2026-11-08 §5.3 — rows are closed by default; these tests read the opened detail of the rows shown, so
// each row opens the moment its button appears
let stopOpening: () => void = () => undefined;
beforeEach(() => {
  stopOpening = autoOpenFlights();
});
afterEach(() => {
  stopOpening();
  vi.useRealTimers();
  setViewportWidth(1280);
});

describe('which flight lists the board asks for (spec rev 55 §11: the tie groups that touch the shown rows)', () => {
  it('asks once for the shown rows; "Show 10 more" asks once more, for the next rows only', async () => {
    const pairs: Record<string, PairOver> = {};
    const day = (d: number) => addDays(asIsoDate('2027-03-14'), d);
    for (let d = 0; d < 15; d += 1) pairs[at(day(d), 10)] = pair(10_000 + d * 100);
    const { requests, user } = await renderWorked({ board: { pairs } });
    await waitFor(() => expect(requests).toHaveLength(1));
    const keys = (from: number, to: number) =>
      Array.from({ length: to - from }, (_x, i) => `${day(from + i)}_${day(from + i + 10)}`);
    expect(askedPairs(requests[0] ?? new URL('http://x'))).toEqual(keys(0, 10));
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(askedPairs(requests[1] ?? new URL('http://x'))).toEqual(keys(10, 15));
  });

  it('a tie that runs past the shown rows is asked for whole, up to 50 date pairs', async () => {
    // why: every date pair of the space (93) at one price: one tie group, so the first read asks for 50 of it
    const { requests } = await renderWorked({ board: { pairs: () => pair(8_600) } });
    await waitFor(() => expect(requests).toHaveLength(1));
    const asked = askedPairs(requests[0] ?? new URL('http://x'));
    expect(asked).toHaveLength(50);
    expect(asked.slice(0, 3)).toEqual([
      '2027-03-14_2027-03-24',
      '2027-03-14_2027-03-25',
      '2027-03-14_2027-03-26',
    ]);
  });
});

describe('the outcome beside the figure (spec rev 55 §6.9; ruling persona-003)', () => {
  it('reads "Google\'s list: from £92, 11:44", "not in Google\'s list", "Google\'s list showed no flights"', async () => {
    await renderWorked();
    const first = outcomeOf(0);
    expect(first).toHaveTextContent(/^Google's list: from/);
    expect(first).toHaveTextContent(/, 11:44$/);
    expect(within(first ?? document.body).getByTestId('price-cell')).toHaveTextContent('£92');
    expect(outcomeOf(3)).toHaveTextContent("not in Google's list");
    expect(outcomeOf(6)).toHaveTextContent("Google's list showed no flights");
    // a failed list, another airport pair's list and no list say nothing beside the price
    expect(outcomeOf(9)).toBeNull();
    expect(outcomeOf(12)).toBeNull();
    expect(outcomeOf(15)).toBeNull();
  });

  it('a list reused from 100 h before carries its day: "Google\'s list: from £110, 10 Oct 11:44"', async () => {
    await renderWorked();
    expect(outcomeOf(18)).toHaveTextContent(/^Google's list: from.*, 10 Oct 11:44$/);
  });

  it('the figure’s PriceCell, its rank and its coverage are the same before and after the list arrives', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => {
      release = r;
    });
    server.use(
      http.get(FLIGHT_LISTS_URL, async ({ request }) => {
        await held;
        const pairs = askedPairs(new URL(request.url)).map((k) => {
          const [d = '', r = ''] = k.split('_');
          return workedEntry(d, r);
        });
        return HttpResponse.json(flightListsResponse(pairs));
      }),
    );
    renderDates({ body: BOARD });
    await findBoard();
    const cells = () => [...rowOf(0).querySelectorAll('td')].map((c) => c.textContent ?? '');
    const figure = () => within(rowOf(0)).getAllByTestId('price-cell')[0]?.textContent;
    const before = cells();
    const figureBefore = figure();
    release();
    await waitFor(() => expect(outcomeOf(0)).not.toBeNull());
    const after = cells();
    expect(after[0]).toBe(before[0]);
    expect(after[5]).toBe(before[5]);
    // why: 21.7 prov-004: the price cell's flight line reads "loading flights" until the answer lands; the figure's own
    // PriceCell is unchanged
    expect(figure()).toBe(figureBefore);
    expect(within(rowOf(0)).getAllByTestId('price-cell')[0]).toHaveTextContent('£86');
  });
});

describe('the flights block (spec rev 55 §11 Flights)', () => {
  it('is headed with the provenance note: outbound only, the lowest round trip, when read, from Google Flights', async () => {
    await renderWorked();
    expect(within(blockOf(0)).getByTestId('flights-head')).toHaveTextContent(
      'Outbound flights only · each price is the lowest round trip listed with it · read 4h ago · prices from Google Flights, not checked with the airline',
    );
    expect(within(blockOf(18)).getByTestId('flights-head')).toHaveTextContent(
      'Outbound flights only · each price is the lowest round trip listed with it · read 4d ago, 10 Oct 11:44 · prices from Google Flights, not checked with the airline',
    );
  });

  it('shows three flights, each its times, flight time, changes, airline and "from £92 round trip" through PriceCell', async () => {
    await renderWorked();
    const flights = within(blockOf(0)).getAllByTestId('flight');
    expect(flights).toHaveLength(3);
    const first = flights[0] ?? document.body;
    expect(within(first).getByTestId('flight-line')).toHaveTextContent(
      'depart 07:15, arrive 18:05 +1 (arrives on Monday 15 March 2027) · 10h 50m · 1 change · Virgin Atlantic',
    );
    expect(first).toHaveTextContent(/· from.*round trip/);
    const cell = within(first).getByTestId('price-cell');
    expect(cell).toHaveTextContent('£92');
    // the calendar style: dashed outline and "not checked"; the flight list's own main-path source name in the title
    expect(cell.className).toContain('border-dashed');
    expect(within(cell).getByTestId('face-age')).toHaveTextContent('not checked');
    expect(cell.getAttribute('title')).toContain("the browser worker's flight list");
    // "+1" is shown; the arrival's date is for assistive technology
    expect(within(first).getByText('(arrives on Monday 15 March 2027)')).toHaveClass('sr-only');
    expect(within(flights[1] ?? document.body).getByTestId('flight-line')).toHaveTextContent(
      'depart 10:00, arrive 21:40 · 11h 40m · direct · Virgin Atlantic',
    );
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('a stale list says the stale mark once on its head, and each flight’s price carries its glyph', async () => {
    await renderWorked();
    const block = blockOf(18);
    expect(within(block).getByTestId('flights-head')).toHaveTextContent(
      /· older than this search's refresh$/,
    );
    // why: the opened detail holds Google's list "from" figure first (design 2026-11-08 §5.1), then the flight's price
    const cell = within(block).getAllByTestId('price-cell').at(-1) ?? block;
    expect(within(cell).getByTestId('stale-glyph')).toBeInTheDocument();
    // why: the words stay with the price for screen readers, but are not printed again on every price
    expect(within(cell).getByText("older than this search's refresh")).toHaveClass('sr-only');
    expect(cell.querySelector('.tag-warn')).toBeNull();
    expect(within(blockOf(0)).getByTestId('flights-head')).not.toHaveTextContent('older than');
    expect(within(blockOf(0)).getAllByTestId('price-cell')[0]).not.toHaveTextContent('older than');
  });

  it('marks each flight against the limits, and "3 more read, 1 outside your limits · show all" shows every flight', async () => {
    const { user } = await renderWorked();
    const block = blockOf(0);
    expect(within(block).getAllByTestId('flight-mark')[0]).toHaveTextContent(
      'outbound 10h 50m, within your 25h limit; return not read',
    );
    expect(within(block).getByTestId('flights-more')).toHaveTextContent(
      '3 more read, 1 outside your limits · show all',
    );
    await user.click(within(block).getByRole('button', { name: 'show all' }));
    const all = within(block).getAllByTestId('flight');
    expect(all).toHaveLength(6);
    expect(all.map((f) => within(f).getByTestId('flight-mark').textContent)).toContain(
      'outbound 26h: over your 25h limit',
    );
    // why: spec rev 56 §6.2: the stops limit now applies to the flights read (the chooser and the marks), so the line
    // names only the airline settings; with no return read it says so first
    expect(within(block).getByTestId('flights-limits')).toHaveTextContent(
      'return leg not read; airline settings not applied to flights read',
    );
  });

  it('a flight outside the arrival or departure window is marked so, and counted outside', async () => {
    const def = definition({
      constraints: {
        maxJourneyMinutes: 1500,
        arrivalWindowLocal: { from: '06:00', to: '23:00' },
        departureWindowLocal: { from: '08:00', to: '20:00' },
      },
    });
    const flights = [
      listedFlight({ departsLocal: '09:00', amountMinor: 9_200 }),
      listedFlight({ departsLocal: '09:00', arrivesLocal: '03:10', amountMinor: 8_000 }),
      listedFlight({ departsLocal: '06:10', amountMinor: 8_100 }),
    ];
    server.use(
      serveFlightLists((d, r) =>
        flightPair(d, r, d === '2027-03-14' ? { list: flightList({ flights }) } : {}),
      ),
    );
    const { user } = renderDates({ body: BOARD, def });
    await waitFor(() => expect(document.querySelector('[data-flights-for="0"]')).not.toBeNull());
    const block = blockOf(0);
    expect(within(block).getAllByTestId('flight')).toHaveLength(1);
    expect(within(block).getByTestId('flights-more')).toHaveTextContent(
      '2 more read, 2 outside your limits · show all',
    );
    await user.click(within(block).getByRole('button', { name: 'show all' }));
    const marks = within(block)
      .getAllByTestId('flight-mark')
      .map((m) => m.textContent);
    expect(marks).toContain('arrives 03:10, outside your window');
    expect(marks).toContain('departs 06:10, outside your window');
  });

  it('when no flight read fits, the cheapest three, each marked over the limit', async () => {
    const flights = [1_600, 1_700, 1_800, 1_900].map((m, i) =>
      listedFlight({ durationMinutes: m, amountMinor: 9_000 + i * 100 }),
    );
    server.use(
      serveFlightLists((d, r) =>
        flightPair(d, r, d === '2027-03-14' ? { list: flightList({ flights }) } : {}),
      ),
    );
    renderDates({ body: BOARD });
    await waitFor(() =>
      expect(document.querySelector('[data-flights-for="0"] [data-testid="flight"]')).not.toBeNull(),
    );
    const marks = within(blockOf(0))
      .getAllByTestId('flight-mark')
      .map((m) => m.textContent);
    expect(marks).toEqual([
      'outbound 26h 40m: over your 25h limit',
      'outbound 28h 20m: over your 25h limit',
      'outbound 30h: over your 25h limit',
    ]);
    expect(within(blockOf(0)).getByTestId('flights-more')).toHaveTextContent(
      '1 more read, 1 outside your limits · show all',
    );
  });

  it('words a failed list, Google’s own no-flights line and a list with nothing this app could read', async () => {
    await renderWorked();
    expect(blockOf(9)).toHaveTextContent(
      "Flights couldn't be read: the browser worker's monthly limit is used up",
    );
    // why: spec rev 64: a list a withdrawn monthly cap stopped (stored before rev 64) offers the read again
    expect(within(blockOf(9)).getByRole('button', { name: /^Read flights/ })).toBeEnabled();
    expect(blockOf(6)).toHaveTextContent("Google's list showed no flights for these dates when read 11:44");
    expect(blockOf(3)).toHaveTextContent(
      'Google listed flights, none this app could read for these airports and dates (2 for other airports or days, 1 unread)',
    );
    for (const i of [3, 9]) expect(blockOf(i)).not.toHaveTextContent(/no flights/);
  });

  it('a failed list offers the read again unless a per-run limit stopped it (ruling R-failed-read)', async () => {
    const reasons: Record<string, Parameters<typeof failedList>[0]> = {
      '2027-03-14': 'network',
      '2027-03-15': 'execution-cap',
      '2027-03-16': 'monthly-cap',
    };
    server.use(
      serveFlightLists((d, r) => {
        const reason = reasons[d];
        return flightPair(
          d,
          r,
          reason === undefined ? {} : { list: failedList(reason, { departureDate: d, returnDate: r }) },
        );
      }),
    );
    renderDates({ body: BOARD });
    await waitFor(() => expect(document.querySelector('[data-flights-for="6"]')).not.toBeNull());
    expect(blockOf(0)).toHaveTextContent("Flights couldn't be read: the connection to it failed");
    expect(within(blockOf(0)).getByRole('button', { name: /^Read flights for this date/ })).toBeEnabled();
    expect(blockOf(3)).toHaveTextContent(
      "Flights couldn't be read: this search's limit for one run is used up",
    );
    expect(within(blockOf(3)).queryByRole('button', { name: /^Read flights/ })).toBeNull();
    // why: spec rev 64: the monthly cap is withdrawn, so a list it stopped (stored before rev 64) is read again
    expect(within(blockOf(6)).getByRole('button', { name: /^Read flights for this date/ })).toBeEnabled();
  });

  it('"show all" expands to every flight and, pressed again, folds back to three (one name; aria-expanded the state)', async () => {
    const { user } = await renderWorked();
    const block = blockOf(0);
    const toggle = within(block).getByRole('button', { name: 'show all' });
    await user.click(toggle);
    expect(within(block).getAllByTestId('flight')).toHaveLength(6);
    // why: 21.7 code M2: the toggle keeps its name; aria-expanded alone says it is open
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAccessibleName('show all');
    await user.click(toggle);
    expect(within(block).getAllByTestId('flight')).toHaveLength(3);
    expect(within(block).getByTestId('flights-more')).toHaveTextContent(
      '3 more read, 1 outside your limits · show all',
    );
  });

  it('the block head states when the list was read: today, yesterday, or its date (finding 7)', async () => {
    const at = (fetchedAt: string, ageHours: number) => flightList({ fetchedAt, ageHours });
    const lists: Record<string, ReturnType<typeof flightList>> = {
      '2027-03-14': at('2026-10-14T10:44:00.000Z', 4),
      '2027-03-15': at('2026-10-13T10:44:00.000Z', 28),
      '2027-03-16': at('2026-10-11T10:44:00.000Z', 76),
    };
    server.use(
      serveFlightLists((d, r) => {
        const l = lists[d];
        return flightPair(d, r, l === undefined ? {} : { list: { ...l, departureDate: d, returnDate: r } });
      }),
    );
    renderDates({ body: BOARD });
    await waitFor(() =>
      expect(document.querySelector('[data-flights-for="6"] [data-testid="flights-head"]')).not.toBeNull(),
    );
    const head = (i: number) => within(blockOf(i)).getByTestId('flights-head').textContent;
    expect(head(0)).toContain('· read 4h ago ·');
    expect(head(3)).toContain('· read 28h ago, yesterday 11:44 ·');
    expect(head(6)).toContain('· read 3d ago, 11 Oct 11:44 ·');
  });

  it('a list where every option was unread reads "(3 unread)", never "no flights"', async () => {
    server.use(
      serveFlightLists((d, r) =>
        flightPair(
          d,
          r,
          d === '2027-03-14'
            ? {
                list: flightList({
                  listed: 'none-for-cell',
                  flights: [],
                  minMinor: null,
                  optionsUnparsed: 3,
                }),
              }
            : {},
        ),
      ),
    );
    renderDates({ body: BOARD });
    await waitFor(() => expect(document.querySelector('[data-flights-for="0"]')).not.toBeNull());
    expect(blockOf(0)).toHaveTextContent(
      'Google listed flights, none this app could read for these airports and dates (3 unread)',
    );
    expect(blockOf(0)).not.toHaveTextContent('no flights');
  });

  it('another airport pair’s list shows only inside the block, under its label, with no difference line', async () => {
    await renderWorked();
    const block = blockOf(12);
    expect(block).toHaveTextContent('Flights read for LGW → EWR, not the priced airports');
    expect(within(block).getAllByTestId('flight')).toHaveLength(1);
    expect(within(block).queryByTestId('flights-difference')).toBeNull();
    expect(block).toHaveTextContent('Flights not read yet');
  });

  it('never says "verified", and a carrier name renders as text only', async () => {
    const flights = [listedFlight({ carriers: ['<img src=x onerror=1>'] })];
    server.use(
      serveFlightLists((d, r) =>
        flightPair(d, r, d === '2027-03-14' ? { list: flightList({ flights }) } : {}),
      ),
    );
    renderDates({ body: BOARD });
    await waitFor(() =>
      expect(document.querySelector('[data-flights-for="0"] [data-testid="flight"]')).not.toBeNull(),
    );
    expect(within(blockOf(0)).getByTestId('flight-line')).toHaveTextContent('<img src=x onerror=1>');
    expect(blockOf(0).querySelector('img')).toBeNull();
    for (const b of document.querySelectorAll('[data-flights-for]'))
      expect(b.textContent).not.toMatch(/verified/i);
  });

  it('speaks in main-path words: no set-up term in any flights block, tie line or outcome', async () => {
    const { user } = await renderWorked();
    await user.click(within(blockOf(0)).getByRole('button', { name: 'show all' }));
    const words = [...document.querySelectorAll('[data-flights-for], [data-testid="flight-outcome"]')]
      .map((el) => mainPathWords(el))
      .join(' ');
    expect(words).toContain('Outbound flights only');
    expect(JARGON.filter(([, re]) => re.test(words)).map(([term]) => term)).toEqual([]);
  });

  it('apps/web/src holds no dangerouslySetInnerHTML', () => {
    const src = resolve(import.meta.dirname, '../../../src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    expect(
      files.filter((f) => readFileSync(join(src, f), 'utf8').includes('dangerouslySetInnerHTML')),
    ).toEqual([]);
  });
});

// why: spec rev 56 §6.9: the grid-price line beneath a pairing figure (board.test.tsx) replaces revision 55's difference
// line; Google's lower fare it could not read stays, a line of its own
describe('the difference line retired; the lower fare its own line (spec rev 56 §6.9; rulings po-012, prov-r2-005)', () => {
  it('no block carries the difference line; the lower fare reads "Google shows a lower fare it could not read (£80)"', async () => {
    await renderWorked();
    expect(document.querySelector('[data-testid="flights-difference"]')).toBeNull();
    const line = within(blockOf(0)).getByTestId('flights-lower-fare');
    expect(line).toHaveTextContent(/^Google shows a lower fare it could not read \(.*\)$/);
    expect(
      within(line)
        .getAllByTestId('price-cell')
        .map((c) => c.querySelector('.figure')?.textContent),
    ).toEqual(['£80']);
    // a list whose Cheapest tab showed nothing lower says nothing of it
    expect(within(blockOf(18)).queryByTestId('flights-lower-fare')).toBeNull();
  });

  it('another airport pair’s list never says the lower fare (it is not the figure’s)', async () => {
    server.use(
      serveFlightLists((d, r) =>
        flightPair(
          d,
          r,
          d === '2027-03-14'
            ? {
                listOtherPair: flightList({
                  origin: 'LGW',
                  destination: 'EWR',
                  minMinor: 9_200,
                  tabMinor: 8_000,
                }),
              }
            : {},
        ),
      ),
    );
    renderDates({ body: BOARD });
    await waitFor(() =>
      expect(document.querySelector('[data-flights-for="0"] .flights-other')).not.toBeNull(),
    );
    expect(within(blockOf(0)).queryByTestId('flights-lower-fare')).toBeNull();
  });
});

describe('reading one date pair’s flights (spec rev 55 §11; ruling ui-009)', () => {
  it('a date pair with no list reads "Flights not read yet" with the read button', async () => {
    await renderWorked();
    const block = blockOf(15);
    expect(block).toHaveTextContent('Flights not read yet');
    expect(
      within(block).getByRole('button', { name: 'Read flights for this date (free, 1 page)' }),
    ).toBeEnabled();
  });

  it('a press POSTs the date pair, shows "Reading flights…", disables the other reads, and clears when the newer list lands', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
    const bodies: unknown[] = [];
    const requests: URL[] = [];
    let pressed = false;
    let landed = false;
    server.use(
      http.post(FLIGHT_LISTS_URL, async ({ request }) => {
        bodies.push(await request.json());
        pressed = true;
        return HttpResponse.json({ accepted: true }, { status: 202 });
      }),
      serveFlightLists(
        (d, r) =>
          d === '2027-03-19' && landed
            ? flightPair(d, r, { list: flightList({ id: 9, departureDate: d, returnDate: r }) })
            : workedEntry(d, r),
        () => ({
          reading: pressed && !landed ? { departureDate: '2027-03-19', returnDate: '2027-03-29' } : null,
        }),
        requests,
      ),
    );
    renderDates({ body: BOARD });
    // why: the first read answers before the press with nothing reading; only reads after it say the pair is reading
    await waitFor(() => expect(document.querySelector('[data-flights-for="15"]')).not.toBeNull());
    const before = requests.length;
    // why: the block's one live region is there, empty, before anything is said in it (finding 3)
    const status = within(blockOf(15)).getByTestId('flights-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('');
    const button = within(blockOf(15)).getByRole('button', { name: /^Read flights for this date/ });
    button.focus();
    await act(async () => button.click());
    await waitFor(() => expect(bodies).toEqual([{ departureDate: '2027-03-19', returnDate: '2027-03-29' }]));
    // the pressed button stays mounted and focused, saying it is reading; the other reads are disabled
    await waitFor(() => expect(button).toHaveTextContent('Reading flights…'));
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(button);
    expect(within(blockOf(12)).getByRole('button', { name: /^Read flights for this date/ })).toBeDisabled();
    landed = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(requests.length).toBeGreaterThan(before + 1));
    await waitFor(() => expect(status).toHaveTextContent('Flights read for 19 → 29 Mar'));
    expect(within(blockOf(15)).getByTestId('flights-status')).toBe(status);
    expect(outcomeOf(15)).toHaveTextContent(/^Google's list: from/);
    // the read button has gone with the list read; focus stays in its block
    expect(within(blockOf(15)).queryByRole('button', { name: /^Read flights/ })).toBeNull();
    expect(blockOf(15).contains(document.activeElement)).toBe(true);
    expect(within(blockOf(12)).getByRole('button', { name: /^Read flights for this date/ })).toBeEnabled();
  });

  it('a read the api reports, with no press here, shows as reading and disables every other read', async () => {
    await renderWorked({ over: { reading: { departureDate: '2027-03-19', returnDate: '2027-03-29' } } });
    const reading = within(blockOf(15)).getByRole('button', { name: 'Reading flights…' });
    expect(reading).toHaveAttribute('aria-disabled', 'true');
    expect(within(blockOf(12)).getByRole('button', { name: /^Read flights for this date/ })).toBeDisabled();
  });

  it.each([
    [
      'the browser worker busy',
      { status: 409, code: 'browser_busy' },
      'The browser worker is busy with a search; try again when it finishes',
    ],
    ['a read within the refresh', { status: 409, code: 'fresh' }, "Read within this search's refresh"],
    [
      'another cabin',
      { status: 409, code: 'not_available', details: { reason: 'cabin' } },
      'Flight times are read for economy searches only',
    ],
    [
      'the worker not set up',
      { status: 409, code: 'not_available', details: { reason: 'not-configured' } },
      'Flight times need the browser worker; set it up in Providers',
    ],
    [
      'dates outside the search',
      { status: 422, code: 'outside_space' },
      "These dates are no longer in this search's dates",
    ],
    [
      'no price',
      { status: 422, code: 'no_price' },
      'This date pair has no price, so there are no airports to read flights for',
    ],
    [
      'anything else',
      { status: 500, code: 'internal' },
      "The flights couldn't be read just now; try again later",
    ],
  ])('words a refused read in the block’s live region: %s', async (_name, answer, words) => {
    server.use(serveFlightRead(answer), serveFlightLists(workedEntry));
    const { user } = renderDates({ body: BOARD });
    await waitFor(() => expect(document.querySelector('[data-flights-for="15"]')).not.toBeNull());
    const status = within(blockOf(15)).getByTestId('flights-status');
    await user.click(within(blockOf(15)).getByRole('button', { name: /^Read flights for this date/ }));
    await waitFor(() => expect(status).toHaveTextContent(words));
    expect(within(blockOf(15)).getByRole('button', { name: /^Read flights for this date/ })).toBeEnabled();
  });

  it('when flight lists are not available: no line on any row, one line under the list, the links kept', async () => {
    await renderWorked({ over: { available: false, unavailableReason: 'not-configured' } });
    for (const i of [0, 3, 6, 9, 12, 15, 18]) {
      expect(outcomeOf(i)).toBeNull();
      expect(within(blockOf(i)).queryByTestId('flight')).toBeNull();
      expect(within(blockOf(i)).queryByRole('button')).toBeNull();
      expect(
        within(blockOf(i)).getByRole('link', { name: /^Open in Google Flights for/ }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('flights-unavailable')).toHaveLength(1);
    expect(screen.getByTestId('flights-unavailable')).toHaveTextContent(
      'Flight times need the browser worker; set it up in Providers',
    );
  });

  it('a search in another cabin says flight times are read for economy only (ruling R-cabin)', async () => {
    await renderWorked({ over: { available: false, unavailableReason: 'cabin' } });
    expect(screen.getByTestId('flights-unavailable')).toHaveTextContent(
      'Flight times are read for economy searches only',
    );
  });

  it('the fixture-only search shows no read button, no link and the one line under the list', async () => {
    // the default handler: no browser worker named, synthetic figures (no search link)
    renderDates({ body: { pairs: { [at('2027-03-14', 10)]: pricedPair(priced(8_600)) } } });
    await findBoard();
    expect(await screen.findByTestId('flights-unavailable')).toHaveTextContent(
      'Flight times need the browser worker; set it up in Providers',
    );
    expect(screen.queryByRole('button', { name: /^Read flights/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Open in Google Flights/ })).toBeNull();
    expect(document.querySelector('[data-flights-for]')).toBeNull();
  });
});

describe('Open in Google Flights ↗ (spec rev 55 §11, §6.9; rulings sec-002/003, prov-int-017)', () => {
  it('every date pair row has the link, a new tab with no opener or referrer, named for its dates, its label beside it', async () => {
    await renderWorked();
    const link = within(blockOf(0)).getByRole('link', {
      name: 'Open in Google Flights for 14 → 24 Mar, opens in a new tab',
    });
    expect(link).toHaveTextContent('Open in Google Flights ↗');
    expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\/www\.google\.com\//));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(blockOf(0)).getByTestId('flights-link')).toHaveTextContent(SEARCH_LINK_LABEL);
    expect(screen.getAllByRole('link', { name: /^Open in Google Flights for/ })).toHaveLength(7);
  });

  it('none when the date pair has no link', async () => {
    server.use(serveFlightLists((d, r) => flightPair(d, r, d === '2027-03-14' ? { link: null } : {})));
    renderDates({ body: BOARD });
    await waitFor(() => expect(document.querySelector('[data-flights-for="3"]')).not.toBeNull());
    expect(within(blockOf(0)).queryByRole('link')).toBeNull();
  });

  it('a link that is not https on www.google.com renders no anchor', () => {
    const label = SEARCH_LINK_LABEL;
    expect(
      googleFlightsHref({ url: 'https://www.google.com/travel/flights?q=x', host: 'www.google.com', label }),
    ).toBe('https://www.google.com/travel/flights?q=x');
    expect(
      googleFlightsHref({ url: 'http://www.google.com/travel', host: 'www.google.com', label }),
    ).toBeNull();
    expect(
      googleFlightsHref({ url: 'https://evil.example/travel', host: 'www.google.com', label }),
    ).toBeNull();
    expect(
      googleFlightsHref({ url: 'https://www.google.com.evil.example/', host: 'www.google.com', label }),
    ).toBeNull();
    expect(googleFlightsHref({ url: 'not a url', host: 'www.google.com', label })).toBeNull();
    expect(googleFlightsHref(null)).toBeNull();
  });
});

describe('ties (spec rev 55 §11 Ties)', () => {
  /** Four date pairs at £86 (14–17 Mar), then two at £90 (18, 19 Mar). */
  const TIES: DatesOptions = {
    pairs: {
      [at('2027-03-14', 10)]: pair(8_600),
      [at('2027-03-15', 10)]: pair(8_600),
      [at('2027-03-16', 10)]: pair(8_600),
      [at('2027-03-17', 10)]: pair(8_600),
      [at('2027-03-18', 10)]: pair(9_000),
      [at('2027-03-19', 10)]: pair(9_000),
    },
  };
  const tieLists = (d: string, r: string) =>
    flightPair(
      d,
      r,
      d === '2027-03-15'
        ? {
            list: flightList({
              departureDate: d,
              returnDate: r,
              flights: [listedFlight({ durationMinutes: 600 })],
            }),
          }
        : d === '2027-03-17'
          ? {
              list: flightList({
                departureDate: d,
                returnDate: r,
                flights: [listedFlight({ durationMinutes: 500 })],
              }),
            }
          : d === '2027-03-16'
            ? {
                listOtherPair: flightList({
                  origin: 'LGW',
                  destination: 'EWR',
                  departureDate: d,
                  returnDate: r,
                  flights: [listedFlight({ durationMinutes: 400 })],
                }),
              }
            : {},
    );

  it('each tie has its own line, and its date pairs with flights come first, shortest first; the ranks follow the order shown', async () => {
    server.use(serveFlightLists(tieLists));
    renderDates({ body: TIES });
    await findBoard();
    await waitFor(() => expect(order()).toEqual([9, 3, 0, 6, 12, 15]));
    const lines = screen.getAllByTestId('tie-line').map((l) => l.textContent);
    expect(lines).toEqual([
      '4 date pairs tie at £86, listed by shortest flight time',
      '2 date pairs tie at £90, in date order',
    ]);
    // why: design 2026-11-08 §5.4 — within a tie the rows are numbered in the order shown (17 Mar was fourth by the
    // price rank and now leads its tie as 1), so rank 2 never sits above rank 1
    const rank = (i: number) => rowOf(i).querySelector('.row-head .sr-only')?.textContent;
    expect([9, 3, 0, 6].map(rank)).toEqual(['1', '2', '3', '4']);
    expect([12, 15].map(rank)).toEqual(['5', '6']);
    expect(poundsOutsidePrices()).toEqual([]);
  });

  it('with no flights shown in a tie it reads "in date order" and keeps the board order', async () => {
    server.use(serveFlightLists((d, r) => flightPair(d, r)));
    renderDates({ body: TIES });
    await waitFor(() => expect(screen.getAllByTestId('tie-line')).toHaveLength(2));
    expect(screen.getAllByTestId('tie-line')[0]).toHaveTextContent('4 date pairs tie at £86, in date order');
    expect(order()).toEqual([0, 3, 6, 9, 12, 15]);
  });

  it('a tie with pence reads them; one that runs past the shown rows counts the whole tie and those shown (R-tie-count)', async () => {
    const pairs: Record<string, PairOver> = {};
    for (let d = 0; d < 12; d += 1) pairs[at(addDays(asIsoDate('2027-03-14'), d), 10)] = pair(8_650);
    server.use(serveFlightLists((d, r) => flightPair(d, r)));
    renderDates({ body: { pairs } });
    await waitFor(() => expect(screen.getAllByTestId('tie-line')).toHaveLength(1));
    expect(screen.getByTestId('tie-line')).toHaveTextContent(
      '12 date pairs tie at £86.50, in date order; 10 shown here',
    );
  });

  it('a read that lands holds its move within the tie while the board is in use, then applies it (finding 9)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });
    let landed = false;
    server.use(
      http.post(FLIGHT_LISTS_URL, () => HttpResponse.json({ accepted: true }, { status: 202 })),
      serveFlightLists(
        (d, r) =>
          d === '2027-03-17' && landed
            ? flightPair(d, r, { list: flightList({ departureDate: d, returnDate: r }) })
            : flightPair(d, r),
        () => ({ reading: landed ? null : { departureDate: '2027-03-17', returnDate: '2027-03-27' } }),
      ),
    );
    // why: the board's transition is observed through its injected animate call (WP19 §6), as runUpdates does
    const animate = vi.fn(
      (_el: Element, _frames: Keyframe[], _options: KeyframeAnimationOptions) => undefined,
    );
    renderDates({ body: TIES, props: { animate } });
    await waitFor(() => expect(document.querySelector('[data-flights-for="9"]')).not.toBeNull());
    await waitFor(() =>
      expect(within(blockOf(9)).getByRole('button', { name: /^Reading flights/ })).toBeInTheDocument(),
    );
    // focus inside the board holds a move: the row stays where it was when its list lands
    within(blockOf(0)).getByRole('link').focus();
    landed = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(outcomeOf(9)).not.toBeNull());
    expect(order()).toEqual([0, 3, 6, 9, 12, 15]);
    expect(animate).not.toHaveBeenCalled();
    // focus leaves the board: the move applies, 17 Mar first within its tie
    act(() => document.body.focus());
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await waitFor(() => expect(order()).toEqual([9, 0, 3, 6, 12, 15]));
    // the released move runs the board's one transition, as any other reorder does (finding 9, FLIP half); why: the
    // cascade starts after the next frame, whose timer is on the faked clock here, so the frame is stepped
    await act(() => vi.advanceTimersByTimeAsync(100));
    await waitFor(() => expect(animate).toHaveBeenCalled());
  });

  it('at phone width a tie line is its own full-width line, never a card (finding 11)', async () => {
    setViewportWidth(375);
    server.use(serveFlightLists(tieLists));
    renderDates({ body: TIES });
    const line = await screen.findAllByTestId('tie-line');
    const row = line[0]?.closest('tr');
    expect(row).toHaveClass('tie-row');
    expect(row).not.toHaveAttribute('data-testid', 'board-card');
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/views/Dates/dates.css'), 'utf8');
    const phone = css.slice(css.lastIndexOf('@media (max-width: 899px)'));
    expect(phone).toMatch(/\.board tbody tr\.tie-row\s*\{[^}]*display:\s*block/);
    // the divider sits above the tie line, and the first card of its run has none, so the line heads its run
    expect(phone).toMatch(/\.board tbody tr\.tie-row\s*\+\s*tr\s*\{[^}]*border-top:\s*0/);
    expect(phone).not.toMatch(/\.board tbody tr\.tie-row\s*\{[^}]*border-top:\s*0/);
    // and on the wide board, the first row of the run carries no divider under its tie line
    expect(css).toMatch(/\.board tbody tr\.tie-row\s*\+\s*tr\s*>\s*\*\s*\{[^}]*border-top:\s*0/);
  });
});

describe('the phone card carries the outcome and the flights block (spec rev 55 §11 Phone)', () => {
  it('the card states the outcome beside its price and holds the block', async () => {
    setViewportWidth(375);
    server.use(serveFlightLists(workedEntry));
    renderDates({ body: BOARD });
    const cards = await screen.findAllByTestId('board-card');
    await waitFor(() =>
      expect(within(cards[0] ?? document.body).queryByTestId('flight-outcome')).not.toBeNull(),
    );
    const card = cards[0] ?? document.body;
    expect(within(card).getByTestId('flight-outcome')).toHaveTextContent(/^Google's list: from.*, 11:44$/);
    expect(within(card).getByTestId('flights-block')).toHaveTextContent('Outbound flights only');
    expect(within(card).getAllByTestId('flight')).toHaveLength(3);
  });
});
