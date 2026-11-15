import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import {
  at,
  bucketsOf,
  DATES_SPACE,
  type DatesOptions,
  figurePairing,
  pairingFig,
  priced,
  pricedPair,
  provFlightList,
  runSummary,
} from '../../fixtures.dates.js';
import { API, definition, execution } from '../../fixtures.js';
import { flightPair } from '../../fixtures.searches.js';
import { poundsOutsidePrices, renderedCopy } from '../../guards.js';
import { serveFlightLists, serveFlightRead } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { jargonIn, mainPathWords } from './jargon.js';
import {
  calendarRows,
  dayButton,
  findCalendar,
  findDayPanel,
  findTrips,
  renderDates,
  rowText,
  tripRows,
} from './render.js';

// Trips and Search plan, Ruling 18 (Task 9; mockup 02's day panel): Enter or a click on a day opens a labelled region
// below the calendar, "Sun 14 Mar: 12 stays", focus on its heading and scrolled into view; it lists the day's stays as
// trip rows, calendar rows and rows for no price, couldn't read, not searched and over the limit, five then "Show 7 more
// stays"; Escape or Close returns focus to the day.

const C = COPY.calendar;

/** One day of twelve stays (10–21 nights) on 14 Mar, every kind of stay, on one airport pair. */
const TWELVE: DatesOptions = {
  origins: ['LHR'],
  destinations: ['JFK'],
  maxJourneyMinutes: 1500,
  space: { ...DATES_SPACE, maxNights: 21 },
  rest: { no_data: 1 },
  pairs: {
    [at('2027-03-14', 10)]: pricedPair(pairingFig(), {}, 1),
    [at('2027-03-14', 11)]: pricedPair(priced(38_800), {}, 1),
    [at('2027-03-14', 12)]: { buckets: bucketsOf({ empty: 1 }, 1) },
    [at('2027-03-14', 13)]: { buckets: bucketsOf({ error: 1 }, 1) },
    [at('2027-03-14', 14)]: { buckets: bucketsOf({}, 1) },
    [at('2027-03-14', 15)]: { buckets: bucketsOf({ priced: 1 }, 1), journeyLeftOut: 1 },
    [at('2027-03-14', 16)]: pricedPair(
      priced(40_000, { basis: 'verified', notSeenInLatest: { ageHours: 30 } }),
      {},
      1,
    ),
    [at('2027-03-14', 17)]: pricedPair(priced(35_000, { superseded: true }), {}, 1),
  },
};
const ONE_PAIR = definition({ origins: ['LHR'], destinations: ['JFK'] });

async function openDay(o: DatesOptions = TWELVE, date = '2027-03-14') {
  const r = renderDates({ body: o, def: ONE_PAIR });
  await findCalendar();
  await r.user.click(dayButton(date));
  return r;
}

describe('the day panel (Ruling 18)', () => {
  it('a click opens a region named "Sun 14 Mar: 12 stays", focus on its heading, scrolled into view', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    const heading = within(panel).getByRole('heading', { name: 'Sun 14 Mar: 12 stays' });
    expect(heading).toHaveFocus();
    expect(scroll.mock.contexts).toContain(heading);
    expect(dayButton('2027-03-14')).toHaveAttribute('aria-expanded', 'true');
    expect(dayButton('2027-03-14').getAttribute('aria-controls')).toBe(panel.id);
    expect(dayButton('2027-03-15')).toHaveAttribute('aria-expanded', 'false');
    // the panel sits below the calendar's months
    expect(
      screen.getByTestId('calendar-months').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    scroll.mockRestore();
  });

  it('lists five stays, trips first, then the other prices, then the stays with none; "Show 7 more stays" shows the rest', async () => {
    const { user } = await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    const rows = () => within(panel).getAllByRole('listitem');
    expect(rows()).toHaveLength(5);
    expect(rows().map((r) => /→ \w{3} (\d+) Mar/.exec(rowText(r))?.[1])).toEqual([
      '24',
      '31',
      '25',
      '30',
      '26',
    ]);
    await user.click(within(panel).getByRole('button', { name: C.showMore(7) }));
    expect(rows()).toHaveLength(12);
    expect(within(panel).queryByRole('button', { name: /^Show \d+ more stays?$/ })).toBeNull();
    // the press leaves focus in the panel, on its heading
    expect(within(panel).getByRole('heading')).toHaveFocus();
  });

  it('a trip is a trip row; a calendar price a calendar row; a not-current verified price says "Not seen again" and links nowhere', async () => {
    const { user } = await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    await user.click(within(panel).getByRole('button', { name: C.showMore(7) }));
    const trips = tripRows(panel);
    expect(trips).toHaveLength(2);
    expect(rowText(trips[0] ?? panel)).toContain('£1,180');
    expect(
      within(trips[0] ?? panel).getByRole('link', { name: /^Details for Sun 14 Mar → Wed 24 Mar$/ }),
    ).toBeInTheDocument();
    const notSeen = trips[1] ?? panel;
    expect(within(notSeen).getByTestId('price-label')).toHaveTextContent(/^Not seen again/);
    expect(notSeen.querySelector('a[target="_blank"]')).toBeNull();
    const cal = calendarRows(panel);
    // the superseded calendar price, the calendar price, then the eight stays without one
    expect(cal).toHaveLength(10);
    expect(within(cal[0] ?? panel).getByTestId('price-label')).toHaveTextContent(/^Not seen again/);
    expect(within(cal[1] ?? panel).getByTestId('price-label')).toHaveTextContent(/^Calendar/);
    expect(rowText(cal[1] ?? panel)).toContain('Flights not read');
  });

  it('rows for no price, couldn’t read, not searched and over the limit say so, never "no flights" alone', async () => {
    const { user } = await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    await user.click(within(panel).getByRole('button', { name: C.showMore(7) }));
    const text = (n: number) => {
      const row = calendarRows(panel).find((r) => new RegExp(`→ \\w{3} ${n} Mar`).test(rowText(r)));
      if (row === undefined) throw new Error(`no row ending on the ${n}th`);
      return rowText(row);
    };
    // 12 nights → Fri 26 Mar; 13 → Sat 27; 14 → Sun 28; 15 → Mon 29
    expect(text(26)).toContain(C.stayName['no-price-shown']);
    expect(text(26)).toContain(C.stayLine['no-price-shown']);
    expect(text(27)).toContain(C.stayName['couldnt-read']);
    expect(text(27)).toContain(C.stayLine['couldnt-read']);
    expect(text(28)).toContain(C.stayName['not-searched']);
    expect(text(28)).toContain(C.stayLine['not-searched']);
    expect(text(29)).toContain(C.stayName['over-limit']);
    expect(text(29)).toContain('Every price found for these dates is over 25h each way.');
    expect(within(panel).getAllByText('—').length).toBeGreaterThanOrEqual(8);
  });

  it('Escape returns focus to the day and closes the panel; so does Close', async () => {
    const { user } = await openDay();
    await findDayPanel('Sun 14 Mar: 12 stays');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: /: \d+ stays$/ })).toBeNull();
    expect(dayButton('2027-03-14')).toHaveFocus();
    expect(dayButton('2027-03-14')).toHaveAttribute('aria-expanded', 'false');
    await user.click(dayButton('2027-03-14'));
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    await user.click(within(panel).getByRole('button', { name: C.close }));
    expect(screen.queryByRole('region', { name: /: \d+ stays$/ })).toBeNull();
    expect(dayButton('2027-03-14')).toHaveFocus();
  });

  it('Escape with a label’s detail open closes the detail first, and the panel stays', async () => {
    const { user } = await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    const label = within(panel).getAllByTestId('price-label')[0];
    if (!(label instanceof HTMLDetailsElement)) throw new Error('a label is a details element');
    await user.click(label.querySelector('summary') ?? label);
    expect(label.open).toBe(true);
    await user.keyboard('{Escape}');
    expect(label.open).toBe(false);
    expect(screen.getByRole('region', { name: 'Sun 14 Mar: 12 stays' })).toBeInTheDocument();
  });

  it('another day replaces the panel, its heading focused; Enter opens a day from the keyboard', async () => {
    const { user } = await openDay();
    await findDayPanel('Sun 14 Mar: 12 stays');
    await user.click(dayButton('2027-03-15'));
    const next = await findDayPanel('Mon 15 Mar: 12 stays');
    expect(within(next).getByRole('heading')).toHaveFocus();
    expect(screen.getAllByRole('region', { name: /: \d+ stays$/ })).toHaveLength(1);
    dayButton('2027-03-16').focus();
    await user.keyboard('{Enter}');
    expect(within(await findDayPanel('Tue 16 Mar: 12 stays')).getByRole('heading')).toHaveFocus();
  });

  it('a day of three stays shows all three and no "Show more"', async () => {
    renderDates({ body: { rest: { no_data: 4 } } });
    await findCalendar();
    dayButton('2027-03-20').click();
    const panel = await findDayPanel('Sat 20 Mar: 3 stays');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3);
    expect(within(panel).queryByRole('button', { name: /^Show / })).toBeNull();
  });

  it('a search with several airports: each trip row links its own airports; a stay without a price names none', async () => {
    const { user } = renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(pairingFig()),
          [at('2027-03-14', 11)]: pricedPair(priced(50_000, { basis: 'verified', hasBookingOptions: true })),
        },
      },
    });
    await findCalendar();
    await user.click(dayButton('2027-03-14'));
    const panel = await findDayPanel('Sun 14 Mar: 3 stays');
    const trips = tripRows(panel);
    expect(trips.map((r) => within(r).getByTestId('row-airports').textContent)).toEqual([
      'LHR → JFK',
      'LHR → JFK',
    ]);
    expect(within(trips[0] ?? panel).getByRole('link', { name: /^Details for LHR → JFK, / })).toHaveAttribute(
      'href',
      expect.stringContaining('from=LHR'),
    );
    expect(within(calendarRows(panel)[0] ?? panel).queryByTestId('row-airports')).toBeNull();
  });
});

// Task 9 fix round 1 (ruling): a trip linked from the Search page, in Cheapest trips or a day's panel, carries the page's
// filters, so the Trip page's crumb back returns to the same filtered view
describe('trip links from the Search page keep its filters', () => {
  it('Cheapest trips and the day panel link the Trip page with the page’s d.* state', async () => {
    const search = '?view=dates&def=def-0001&d.nights=10-11&d.week=best';
    const { user } = renderDates({
      def: ONE_PAIR,
      search,
      body: {
        origins: ['LHR'],
        destinations: ['JFK'],
        rest: { no_data: 1 },
        pairs: { [at('2027-03-14', 10)]: pricedPair(pairingFig(), {}, 1) },
      },
    });
    const details = /^Details for Sun 14 Mar → Wed 24 Mar$/;
    const params = (a: HTMLElement) => new URLSearchParams(a.getAttribute('href') ?? '');
    const fromSection = params(within(await findTrips()).getByRole('link', { name: details }));
    await findCalendar();
    await user.click(dayButton('2027-03-14'));
    const panel = await findDayPanel(/^Sun 14 Mar: \d+ stays?$/);
    const fromPanel = params(within(panel).getByRole('link', { name: details }));
    for (const p of [fromSection, fromPanel]) {
      expect([p.get('view'), p.get('depart'), p.get('return')]).toEqual(['trip', '2027-03-14', '2027-03-24']);
      expect([p.get('d.nights'), p.get('d.week')]).toEqual(['10-11', 'best']);
    }
    expect(fromPanel.toString()).toBe(fromSection.toString());
  });
});

// Review Focus 2: an earlier search's trip in a day's panel is styled as one, and says the running search replaces it
describe('an earlier search’s trip in the day panel (Review Focus 2)', () => {
  const earlier = pairingFig({ fromEarlierSearch: true });
  it.each([
    [
      'while a search runs',
      [runSummary({ status: 'running', finishedAt: null })],
      COPY.searchesView.previousSearchReplaced,
    ],
    ['once it has finished', [runSummary()], COPY.searchesView.previousSearchDetail],
  ] as const)('%s', async (_name, executions, note) => {
    // why: the page reads its latest run's own status; serve the run as the summary says it is
    const status = executions[0]?.status ?? 'completed';
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({ status, finishedAt: status === 'running' ? null : '2026-10-14T13:00:00.000Z' }),
        ),
      ),
    );
    const { user } = renderDates({
      body: {
        executions: [...executions],
        rest: { no_data: 4 },
        pairs: { [at('2027-03-14', 10)]: pricedPair(earlier) },
      },
    });
    await findCalendar();
    await user.click(dayButton('2027-03-14'));
    const [row] = tripRows(await findDayPanel('Sun 14 Mar: 3 stays'));
    if (row === undefined) throw new Error('the earlier trip is in the panel');
    expect(row).toHaveAttribute('data-earlier', 'true');
    expect(rowText(row)).toContain(note);
  });
});

describe('Read flights in the day panel (Ruling 20), through the page’s one status', () => {
  it('a calendar row offers Read flights where a read would go now; a refused press is said in the page’s status', async () => {
    server.use(
      serveFlightLists((d, r) => flightPair(d, r)),
      serveFlightRead({ status: 409, code: 'browser_busy' }),
    );
    const { user } = renderDates({
      def: ONE_PAIR,
      body: {
        origins: ['LHR'],
        destinations: ['JFK'],
        discoveryProviders: ['camoufox'],
        rest: { no_data: 1 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(
            pairingFig({
              pairing: figurePairing({ provenance: provFlightList() }),
            }),
            {},
            1,
          ),
          [at('2027-03-20', 11)]: pricedPair(priced(30_000), {}, 1),
        },
      },
    });
    await findCalendar();
    await user.click(dayButton('2027-03-20'));
    const panel = await findDayPanel('Sat 20 Mar: 3 stays');
    const read = await within(panel).findByRole('button', {
      name: 'Read flights for Sat 20 Mar → Wed 31 Mar',
    });
    await user.click(read);
    const said = screen.getByTestId('read-said');
    await waitFor(() => expect(said).toHaveTextContent(COPY.flights.busy));
    expect(panel.contains(said)).toBe(false);
    expect(screen.getAllByRole('status').filter((s) => s.dataset.testid === 'read-said')).toHaveLength(1);
  });
});

describe('the key and the day panel say no banned word, no set-up term, no "£" outside a price', () => {
  // why: the Trips plan's main-path words (Global Constraints), beyond the jargon list
  const MAIN_PATH: ReadonlyArray<readonly [string, RegExp]> = [
    ['definition', /\bdefinitions?\b/i],
    ['cell', /\bcells?\b/i],
    ['date pair', /\bdate pairs?\b/i],
    ['basis', /\bbasis\b/i],
    ['discovery', /\bdiscovery\b/i],
    ['itinerary search', /\bitinerary search\b/i],
    ['verdict', /\bverdicts?\b/i],
    ['reused', /\breused\b/i],
    ['superseded', /\bsuperseded\b/i],
    ['billed calls', /\bbilled calls?\b/i],
    ['on-demand', /\bon-demand\b/i],
  ];
  it('every kind of day, the key, and a day panel with every kind of row', async () => {
    const { user } = await openDay();
    const panel = await findDayPanel('Sun 14 Mar: 12 stays');
    await user.click(within(panel).getByRole('button', { name: C.showMore(7) }));
    const calendar = screen.getByRole('region', { name: C.heading });
    const words = mainPathWords(calendar);
    expect(MAIN_PATH.filter(([, re]) => re.test(words)).map(([w]) => w)).toEqual([]);
    expect(jargonIn(words)).toEqual([]);
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
    // "no flights" only as the key, the no-price line and a calendar label's detail say it: never a mark of its own
    expect(
      words
        .replaceAll(C.key.noPrice, '')
        .replace(/isn't the same as no flights/g, '')
        .replace(/Not a fare: no flights or sellers read/g, '')
        .replace(/No flights read yet for these dates/g, ''),
    ).not.toMatch(/no flights/i);
  });
});
