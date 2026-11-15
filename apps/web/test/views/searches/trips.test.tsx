import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiContract } from '@gmt/core';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { API, definition, execution, providersResponse } from '../../fixtures.js';
import {
  calendarOnly,
  cardTrip,
  flightListProvenance,
  latestRun,
  lowerOnCalendar,
  noPrices,
  searchCard,
} from '../../fixtures.searches.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { airportRows, renderInShell } from './support.js';

// Design 2026-11-08 §5.3 (mockup 01-searches), Rulings 4, 5, 7, 8, 11, 15, 20 and Review Focus 1 to 3: the Trips page's
// cards: the three cheapest trips as shared rows, the calendar-count line, run progress with Cancel, and every state.

const S = COPY.searchesView;
const SELLER = flightListProvenance('2026-10-14T10:44:00.000Z');
const cardOf = async (name: string) => {
  const heading = await screen.findByRole('heading', { level: 2, name });
  const card = heading.closest('li');
  if (card === null) throw new Error(`no card around ${name}`);
  return card;
};
/** The nth element of a found list (no cast, and a clear failure when it is missing). */
const at = (list: HTMLElement[], n: number): HTMLElement => {
  const el = list[n];
  if (el === undefined) throw new Error(`no element ${n}`);
  return el;
};
/** A read trip with its airlines in the pairing, so a card that shows them is caught. */
const readTrip = (over: Parameters<typeof cardTrip>[0] = {}) =>
  cardTrip({ basis: 'pairing', priceKind: 'seller', ...over }, SELLER);

describe('the page', () => {
  it('is headed Trips, with "+ New search" that moves focus to the panel’s first field, From (Ruling 13)', async () => {
    server.use(serveCards([searchCard()]));
    const { user } = renderInShell(<SearchesView />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trips' })).toBeInTheDocument();
    const side = await screen.findByRole('region', { name: S.sideHeading });
    const from = await within(side).findByRole('combobox', { name: PLAN_COPY.from });
    await user.click(screen.getByRole('button', { name: '+ New search' }));
    expect(from).toHaveFocus();
  });

  it('while the sources are still loading there is no field yet, so "+ New search" focuses the panel’s heading', async () => {
    // why: /providers never answers in this test, so the panel shows its loading state
    server.use(
      serveCards([searchCard()]),
      http.get(`${API}/providers`, () => new Promise<never>(() => undefined)),
    );
    const { user } = renderInShell(<SearchesView />);
    const side = await screen.findByRole('region', { name: S.sideHeading });
    expect(within(side).queryByRole('combobox', { name: PLAN_COPY.from })).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ New search' }));
    expect(within(side).getByRole('heading', { level: 2, name: S.sideHeading })).toHaveFocus();
  });
});

describe('a finished search with trips', () => {
  const trips = [
    readTrip({ pricePence: 41_200, departureDate: '2026-11-11', returnDate: '2026-11-28' }),
    readTrip({ pricePence: 43_600, departureDate: '2026-11-20', returnDate: '2026-11-30' }),
    readTrip({ pricePence: 44_800, departureDate: '2026-12-01', returnDate: '2026-12-19' }),
  ];

  it('the name links to the Search page; the meta line and the repeat tag state the route, dates, stay and age', async () => {
    server.use(serveCards([searchCard({ trips })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const name = within(card).getByRole('link', { name: 'Birmingham → Frankfurt' });
    expect(name).toHaveAttribute('href', '/?view=dates&def=def-0001');
    expect(card.querySelector('.tcard-meta')).toHaveTextContent(
      'BHX → FRA · leave 10 Jan – 31 Mar · 10–14 nights · searched 2h ago',
    );
    expect(card.querySelector('.tcard-repeat')).toHaveTextContent('repeats Mondays 05:00');
  });

  it('names the airports as the airports table does, without the city in front, and the code where it is unknown', async () => {
    const rows = apiContract.airportsResponseSchema.parse([
      {
        iata: 'LHR',
        name: 'London Heathrow Airport',
        city: 'London',
        country: 'GB',
        tz: 'Europe/London',
        metro: 'LON',
      },
      {
        iata: 'JFK',
        name: 'John F Kennedy International Airport',
        city: 'New York',
        country: 'US',
        tz: 'America/New_York',
        metro: 'NYC',
      },
    ]);
    server.use(
      serveCards([searchCard({ name: 'Named', origins: ['LHR', 'LGW'], destinations: ['JFK'] })]),
      airportRows(rows),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Named');
    await waitFor(() =>
      expect(card.querySelector('.tcard-meta')).toHaveTextContent(/^Heathrow, LGW → John F Kennedy · leave/),
    );
  });

  it('Search again is a normal secondary button once the search is loaded, not a disabled one; Search now is primary', async () => {
    server.use(
      serveCards([searchCard({ id: 'def-0001', trips })]),
      http.get(`${API}/definitions`, () => HttpResponse.json([definition({ id: 'def-0001' })])),
    );
    renderInShell(<SearchesView />);
    const again = await within(await cardOf('Birmingham → Frankfurt')).findByRole('button', {
      name: /^Search again/,
    });
    await waitFor(() => expect(again).toBeEnabled());
    expect(again).not.toHaveClass('btn-primary');
    expect(again).not.toHaveAttribute('aria-busy');
  });

  it('a search that does not repeat has no repeat tag; a rolling window reads as its offsets', async () => {
    server.use(
      serveCards([
        searchCard({
          schedule: null,
          window: {
            kind: 'relative',
            departureFrom: '2026-10-21',
            departureTo: '2027-04-21',
            startOffsetDays: 7,
            lengthDays: 182,
          },
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card.querySelector('.tcard-repeat')).toBeNull();
    expect(card.querySelector('.tcard-meta')).toHaveTextContent('rolling: 182 days from 7 days ahead');
  });

  it('shows three trip rows, each with its label and dates, and no airlines', async () => {
    server.use(serveCards([searchCard({ trips })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const list = within(card).getByRole('list', { name: 'Cheapest trips, Birmingham → Frankfurt' });
    const rows = within(list).getAllByTestId('trip-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('£412');
    expect(rows[0]).toHaveTextContent('Wed 11 Nov → Sat 28 Nov');
    expect(rows[0]).toHaveTextContent('17');
    expect(within(at(rows, 0)).getByTestId('price-label')).toHaveTextContent(/^Seller/);
    expect(within(at(rows, 0)).getByRole('link', { name: /^Details for/ })).toBeInTheDocument();
    expect(card).not.toHaveTextContent('QQ Atlantic');
  });

  it('the actions: All trips and dates, Search again, Edit, then Remove, quietly', async () => {
    server.use(serveCards([searchCard({ trips })]));
    renderInShell(<SearchesView />, { search: '?view=searches' });
    const card = await cardOf('Birmingham → Frankfurt');
    const actions = within(card).getByTestId('card-actions');
    expect(
      within(actions).getByRole('link', { name: 'All trips and dates for Birmingham → Frankfurt' }),
    ).toHaveAttribute('href', '/?view=dates&def=def-0001');
    expect(within(actions).getByRole('button', { name: /^Search again/ })).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: 'Edit Birmingham → Frankfurt' })).toHaveAttribute(
      'href',
      '/?view=definitions&edit=def-0001',
    );
    const remove = within(actions).getByRole('button', { name: 'Remove Birmingham → Frankfurt' });
    const edit = within(actions).getByRole('link', { name: /^Edit/ });
    expect(edit.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(remove).toHaveClass('btn-quiet');
    expect(within(actions).queryByRole('button', { name: /^Cancel/ })).toBeNull();
  });
});

describe('the counts line (Rulings 5 and 6)', () => {
  const trips = [readTrip({ pricePence: 41_200 })];

  it('both clauses: the dates with flights read, and the dates that look lower, from the lowest price with its label', async () => {
    server.use(
      serveCards([
        searchCard({
          trips,
          readDates: 23,
          lowerOnCalendar: lowerOnCalendar({ pricePence: 37_200, count: 155 }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const line = within(await cardOf('Birmingham → Frankfurt')).getByTestId('card-counts');
    expect(line).toHaveTextContent(
      /^23 dates with flights read; these are the cheapest\. 155 dates look lower on the calendar, from £372 Cached.*.$/,
    );
    expect(within(line).getByTestId('price-label')).toHaveTextContent(/^Cached/);
    // Task 9: the count links to the search's calendar (its anchor), and a click goes there in place
    const link = within(line).getByRole('link', { name: '155 dates look lower on the calendar' });
    expect(link).toHaveAttribute('href', '/?view=dates&def=def-0001#calendar');
    fireEvent.click(link);
    expect([window.location.search, window.location.hash]).toEqual(['?view=dates&def=def-0001', '#calendar']);
  });

  it('a clause shows only when its count is not zero', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'a', name: 'No lower', trips, readDates: 4, lowerOnCalendar: null }),
        searchCard({
          id: 'b',
          name: 'One lower',
          trips,
          readDates: 1,
          lowerOnCalendar: lowerOnCalendar({ count: 1 }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const a = within(await cardOf('No lower')).getByTestId('card-counts');
    expect(a).toHaveTextContent('4 dates with flights read; these are the cheapest.');
    expect(a).not.toHaveTextContent('lower on the calendar');
    const b = within(await cardOf('One lower')).getByTestId('card-counts');
    expect(b).toHaveTextContent('1 date with flights read; these are the cheapest. 1 date looks lower');
  });

  it('with no trip, the sentence names the calendar prices, their lowest with its label, and no flights read (Review Focus 3)', async () => {
    server.use(
      serveCards([
        searchCard({ ...calendarOnly({ pricePence: 37_200, count: 2146 }), latestRun: latestRun() }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const line = within(card).getByTestId('card-counts');
    expect(line).toHaveTextContent(
      /^Calendar prices for 2,146 dates, from £372 Cached.*; no flights read yet\.$/,
    );
    expect(within(line).getByTestId('price-label')).toBeInTheDocument();
    // nothing reads as "no flights"; no trip list, no nothing-found reason
    expect(card.textContent).not.toMatch(/no flights\b(?! read yet)/i);
    expect(card.querySelector('.tcard-trips')).toBeNull();
    expect(card.querySelector('.tcard-nothing')).toBeNull();
  });

  it('a card with neither shows no counts line', async () => {
    server.use(serveCards([searchCard({ ...noPrices })]));
    renderInShell(<SearchesView />);
    await cardOf('Birmingham → Frankfurt');
    expect(screen.queryByTestId('card-counts')).toBeNull();
  });
});

describe('a search with several airports (Review Focus 1)', () => {
  it('two trips on one date from different airport pairs say their pair and link their own booking and details', async () => {
    server.use(
      serveCards([
        searchCard({
          name: 'London → New York',
          origins: ['LHR', 'LGW'],
          destinations: ['JFK', 'EWR'],
          trips: [
            readTrip({ pricePence: 41_200, origin: 'LHR', destination: 'JFK' }),
            readTrip({ pricePence: 43_000, origin: 'LGW', destination: 'EWR' }),
          ],
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const rows = within(await cardOf('London → New York')).getAllByTestId('trip-row');
    expect(within(at(rows, 0)).getByTestId('row-airports')).toHaveTextContent('LHR → JFK');
    expect(within(at(rows, 1)).getByTestId('row-airports')).toHaveTextContent('LGW → EWR');
    const detail = (r: HTMLElement) => within(r).getByRole('link', { name: /^Details for/ });
    expect(detail(at(rows, 0)).getAttribute('href')).toContain('t.from=LHR');
    expect(detail(at(rows, 0)).getAttribute('href')).toContain('t.to=JFK');
    expect(detail(at(rows, 1)).getAttribute('href')).toContain('t.from=LGW');
    expect(detail(at(rows, 1)).getAttribute('href')).toContain('t.to=EWR');
    const book = (r: HTMLElement) => r.querySelector('.row-price a')?.getAttribute('href');
    expect(book(at(rows, 0))).toContain('LHR');
    expect(book(at(rows, 1))).toContain('LGW');
  });
});

describe('a search that is running (Review Focus 2, Ruling 11)', () => {
  const running = latestRun({
    status: 'running',
    finishedAt: null,
    datePairsSearched: 120,
    estimatedFinishAt: '2026-10-14T15:14:00.000Z',
    stop: null,
  });
  const earlier = [readTrip({ pricePence: 38_900, fromEarlierSearch: true, ageHours: 48 })];

  it('shows the run’s progress and Cancel in place of Search again, with the earlier trips beneath', async () => {
    server.use(serveCards([searchCard({ latestRun: running, trips: earlier })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).getByRole('progressbar')).toBeInTheDocument();
    expect(card).toHaveTextContent('Reading the calendar, 120 of 405 dates · about 14 min left');
    expect(within(card).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Search again/ })).toBeNull();
    const row = within(card).getByTestId('trip-row');
    expect(row).toHaveAttribute('data-earlier', 'true');
    expect(within(card).getByRole('list', { name: 'Trips from the previous search' })).toBeInTheDocument();
  });

  // final review M1
  it('a run checking fares says "Checking fares", with the time it has left', async () => {
    server.use(
      serveCards([searchCard({ latestRun: { ...running, stage: 'verification' }, trips: earlier })]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).getByTestId('run-line')).toHaveTextContent(/^Checking fares · about 14 min left$/);
    expect(card).not.toHaveTextContent(/Reading the calendar/);
  });

  it('an earlier trip’s label detail says it was read by the previous search, with its age', async () => {
    server.use(serveCards([searchCard({ latestRun: running, trips: earlier })]));
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const label = within(card).getByTestId('price-label');
    expect(label).toHaveTextContent('2d');
    await user.click(within(label).getByText(/Seller/));
    expect(label).toHaveTextContent(/Read by the previous search/);
    expect(label).toHaveTextContent('the search running now will replace it');
  });

  it('Cancel asks once more, then cancels the run once', async () => {
    const cancels: string[] = [];
    server.use(
      serveCards([searchCard({ latestRun: running, trips: earlier })]),
      http.post(`${API}/executions/:id/cancel`, ({ params }) => {
        cancels.push(String(params.id));
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(cancels).toEqual([]);
    await user.click(within(card).getByRole('button', { name: COPY.runProgress.confirmCancel }));
    await waitFor(() => expect(cancels).toEqual(['exec-0001']));
  });
});

describe('earlier trips on a running card (Review Focus 2)', () => {
  const running = latestRun({ status: 'running', finishedAt: null, stop: null });

  it('only a trip the previous search read says so; a trip the running search read keeps its own detail', async () => {
    server.use(
      serveCards([
        searchCard({
          latestRun: running,
          trips: [
            readTrip({ pricePence: 38_900, fromEarlierSearch: false, departureDate: '2027-01-12' }),
            readTrip({ pricePence: 40_200, fromEarlierSearch: true, departureDate: '2027-01-13' }),
          ],
        }),
      ]),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const rows = within(card).getAllByTestId('trip-row');
    const current = at(rows, 0);
    const earlier = at(rows, 1);
    expect(current).not.toHaveAttribute('data-earlier');
    expect(earlier).toHaveAttribute('data-earlier', 'true');
    for (const row of [current, earlier]) {
      const label = within(row).getByTestId('price-label');
      await user.click(within(label).getByText(/Seller/));
    }
    expect(current).not.toHaveTextContent('previous search');
    expect(earlier).toHaveTextContent('Read by the previous search; the search running now will replace it.');
    // the list is the previous search's only when every trip is
    expect(within(card).queryByRole('list', { name: 'Trips from the previous search' })).toBeNull();
  });

  it('a settled card’s trip from an earlier search says so without "will replace it"', async () => {
    server.use(serveCards([searchCard({ trips: [readTrip({ fromEarlierSearch: true })] })]));
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    await user.click(within(card).getByText(/Seller/));
    expect(card).toHaveTextContent('Read by the previous search.');
    expect(card).not.toHaveTextContent('will replace it');
  });

  it('rows lay out by their list’s width, not the window’s: one set of container rules (Task 7 fix round 1)', () => {
    const read = (path: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), 'utf8');
    const rows = read('../../../src/components/rows/rows.css');
    expect(rows).toMatch(/:where\(ul, ol\):has\(> \.trip-row\) \{\s*container: rows \/ inline-size;/);
    expect(rows).toContain('@container rows (max-width: 720px)');
    expect(rows).not.toMatch(/@media[^{]*width/);
    // the cards keep only their desktop minima, by the same container; no copy of the two-column rules
    const cards = read('../../../src/views/Searches/searches.css');
    expect(cards).not.toMatch(/@media[^{]*width[^{]*\{[^}]*\.trip-row/);
    expect(cards).not.toContain('grid-template-areas: "dates pc"');
  });

  it('the earlier-result styling is in no media query, so it applies at every width', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../src/components/rows/rows.css'),
      'utf8',
    );
    const at = css.indexOf('.trip-row-earlier {');
    expect(at).toBeGreaterThan(0);
    let depth = 0;
    for (const ch of css.slice(0, at)) {
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
    }
    expect(depth).toBe(0);
  });
});

describe('a truncated or stale price keeps its mark (decision 36, Ruling 19)', () => {
  it('a truncated lower-on-calendar price and a truncated trip carry the truncated note', async () => {
    server.use(
      serveCards([
        searchCard({
          trips: [readTrip({ truncated: true })],
          readDates: 3,
          lowerOnCalendar: lowerOnCalendar({ truncated: true, count: 4 }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(within(card).getByTestId('card-counts')).getByTestId('price-cell')).toHaveTextContent(
      COPY.truncatedNote,
    );
    expect(within(within(card).getByTestId('trip-row')).getByTestId('price-cell')).toHaveTextContent(
      COPY.truncatedNote,
    );
  });

  it('a complete price carries none', async () => {
    server.use(serveCards([searchCard({ trips: [readTrip()], lowerOnCalendar: lowerOnCalendar() })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    for (const cell of within(card).getAllByTestId('price-cell')) expect(cell).not.toHaveTextContent('…');
  });

  it('a stale lower price and a stale trip say so in their labels', async () => {
    server.use(
      serveCards([
        searchCard({
          trips: [readTrip({ stale: 'refresh', ageHours: 200 })],
          lowerOnCalendar: lowerOnCalendar({ stale: 'setting', ageHours: 100 }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const labels = within(card).getAllByTestId('price-label');
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      const summary = label.querySelector('summary');
      expect(summary?.getAttribute('aria-label') ?? '').toMatch(/older|stale/i);
    }
  });
});

describe('the other states', () => {
  it('never searched: "Not searched yet" and Search now, no counts and no reason', async () => {
    server.use(serveCards([searchCard({ latestRun: null, ...noPrices })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card).toHaveTextContent('Not searched yet');
    expect(within(card).getByRole('button', { name: /^Search again/ })).toHaveTextContent('Search now');
    expect(card.querySelector('.tcard-nothing')).toBeNull();
    expect(card).not.toHaveTextContent('never searched');
  });

  it('paused: the stop’s sentence and Resume, which resumes the run; Search again stays', async () => {
    const resumes: string[] = [];
    server.use(
      serveCards([
        searchCard({
          latestRun: latestRun({
            status: 'paused_budget',
            finishedAt: null,
            stop: {
              sentence: 'Stopped at 14 Oct 15:00: its spending limit of £5 was reached.',
              fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true },
            },
          }),
        }),
      ]),
      http.post(`${API}/executions/:id/resume`, ({ params }) => {
        resumes.push(String(params.id));
        return HttpResponse.json(execution({ status: 'running' }));
      }),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).getByTestId('stop-sentence')).toHaveTextContent(/^Stopped at 14 Oct 15:00/);
    await user.click(within(card).getByRole('button', { name: COPY.runProgress.resume }));
    await waitFor(() => expect(resumes).toEqual(['exec-0001']));
    expect(within(card).getByRole('button', { name: /^Search again/ })).toBeInTheDocument();
  });

  it('a stopped search with no recorded cause reads the standing sentence, never a status word', async () => {
    server.use(
      serveCards([
        searchCard({ latestRun: latestRun({ status: 'paused_error', finishedAt: null, stop: null }) }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card).toHaveTextContent('No reason was recorded for this run.');
    expect(card.textContent).not.toContain('paused: error');
  });

  it('dates changed since the last run: says so, and no reason that counts the old range', async () => {
    server.use(
      serveCards([
        searchCard({
          ...noPrices,
          spaceChangedSince: true,
          discovery: ['travelpayouts', 'camoufox'],
          latestRun: latestRun({
            datePairs: 405,
            datePairsSearched: 405,
            datePairsNeverSearched: 0,
            marks: {
              priced: 0,
              'no-price-shown': 405,
              'couldnt-read': 0,
              'not-reached': 0,
              'not-searched': 0,
            },
          }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card).toHaveTextContent('Dates changed since this was last searched');
    expect(card).not.toHaveTextContent('Every date showed no price');
    expect(card).not.toHaveTextContent('stopped before');
  });
});

describe('a finished search that found nothing says why (Ruling 8)', () => {
  const marks = (m: Partial<Record<string, number>>) => ({
    priced: 0,
    'no-price-shown': 0,
    'couldnt-read': 0,
    'not-reached': 0,
    'not-searched': 0,
    ...m,
  });
  const browser = ['travelpayouts', 'camoufox'] as const;
  const empty = (over: Parameters<typeof searchCard>[0]) => searchCard({ ...noPrices, ...over });

  it.each<[string, Parameters<typeof searchCard>[0], string]>([
    [
      'dates not searched or not reached',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairsSearched: 300,
          datePairsNeverSearched: 105,
          marks: marks({ 'no-price-shown': 300, 'not-reached': 60, 'not-searched': 45 }),
        }),
      },
      'The search stopped before 105 dates.',
    ],
    [
      'the browser was unavailable',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairsSearched: 375,
          datePairsNeverSearched: 30,
          browserUnavailable: 30,
          marks: marks({ 'no-price-shown': 375, 'not-reached': 30 }),
        }),
      },
      'The browser was unavailable for 30 dates; the next search tries them again.',
    ],
    [
      'dates that could not be read',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairsSearched: 393,
          datePairsNeverSearched: 0,
          marks: marks({ 'no-price-shown': 393, 'couldnt-read': 12 }),
        }),
      },
      "12 dates couldn't be read; the next search tries them again.",
    ],
    [
      'a large count is written with its thousands comma',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairs: 2000,
          datePairsSearched: 797,
          datePairsNeverSearched: 0,
          marks: marks({ 'no-price-shown': 797, 'couldnt-read': 1203 }),
        }),
      },
      "1,203 dates couldn't be read; the next search tries them again.",
    ],
    [
      'the browser is off for this search',
      {
        discovery: ['travelpayouts'],
        latestRun: latestRun({
          datePairsSearched: 405,
          datePairsNeverSearched: 0,
          marks: marks({ 'no-price-shown': 405 }),
        }),
      },
      "The other sources found nothing, and the browser is off for this search. That isn't the same as no flights.",
    ],
    [
      'every date showed no price',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairsSearched: 405,
          datePairsNeverSearched: 0,
          marks: marks({ 'no-price-shown': 405 }),
        }),
      },
      "Every date showed no price. That isn't the same as no flights.",
    ],
    [
      'prices were found but none fit',
      {
        discovery: [...browser],
        latestRun: latestRun({
          datePairsSearched: 405,
          datePairsNeverSearched: 0,
          marks: marks({ priced: 405 }),
        }),
      },
      "Prices were found, but none fit this search's limits.",
    ],
  ])('%s', async (_name, over, words) => {
    server.use(serveCards([empty(over)]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card.querySelector('.tcard-nothing')).toHaveTextContent(words);
  });

  it('a cancelled run gives its stop sentence, not a reason of ours', async () => {
    server.use(
      serveCards([
        empty({
          discovery: [...browser],
          latestRun: latestRun({
            status: 'cancelled',
            stop: { sentence: 'Cancelled at 14 Oct 14:00.', fix: null },
            datePairsSearched: 0,
            datePairsNeverSearched: 405,
            marks: marks({ 'not-searched': 405 }),
          }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).getByTestId('stop-sentence')).toHaveTextContent('Cancelled at 14 Oct 14:00.');
    expect(card.querySelector('.tcard-nothing')).toBeNull();
  });

  it('the first reason that applies wins: unreached dates before an unavailable browser', async () => {
    server.use(
      serveCards([
        empty({
          discovery: [...browser],
          latestRun: latestRun({
            datePairsSearched: 300,
            datePairsNeverSearched: 105,
            browserUnavailable: 30,
            marks: marks({ 'no-price-shown': 300, 'not-reached': 90, 'not-searched': 15 }),
          }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card.querySelector('.tcard-nothing')).toHaveTextContent('The search stopped before 75 dates.');
  });
});

describe('"Turn on the browser for this search and search again" (Ruling 8)', () => {
  const offAndEmpty = () =>
    searchCard({
      ...noPrices,
      discovery: ['travelpayouts'],
      latestRun: latestRun({
        datePairsSearched: 405,
        datePairsNeverSearched: 0,
        marks: {
          priced: 0,
          'no-price-shown': 405,
          'couldnt-read': 0,
          'not-reached': 0,
          'not-searched': 0,
        },
      }),
    });
  const withBrowser = () => {
    const base = providersResponse();
    return providersResponse({
      providers: [
        ...base.providers,
        {
          providerId: 'camoufox',
          displayName: 'Browser',
          enabled: true,
          plan: 'free',
          excludedFromSchedule: false,
          notices: [],
          capNote: null,
          capabilities: {
            discovery: {
              sourceKind: 'scraped-self',
              provenanceNote: 'Google Flights, in your browser',
              maxAgeHours: 0,
            },
            verification: null,
          },
          usage: [],
        },
      ],
    });
  };
  const serveOrder = (order: string[], bodies: unknown[], putStatus = 200) => [
    http.get(`${API}/providers`, () => HttpResponse.json(withBrowser())),
    http.get(`${API}/definitions`, () => HttpResponse.json([definition({ id: 'def-0001' })])),
    http.put(`${API}/definitions/:id`, async ({ request }) => {
      order.push('PUT');
      bodies.push(await request.json());
      return putStatus === 200
        ? HttpResponse.json(definition({ id: 'def-0001' }))
        : HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: putStatus });
    }),
    http.post(`${API}/definitions/:id/executions`, () => {
      order.push('START');
      return HttpResponse.json({ executionId: 'exec-9' }, { status: 202 });
    }),
  ];

  it('saves the search with the browser added to its sources (the others kept), then starts it', async () => {
    const order: string[] = [];
    const bodies: unknown[] = [];
    server.use(serveCards([offAndEmpty()]), ...serveOrder(order, bodies));
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const fix = await within(card).findByRole('button', { name: /^Turn on the browser for/ });
    expect(fix).toHaveTextContent('Turn on the browser for this search and search again');
    await waitFor(() => expect(fix).toBeEnabled());
    await user.click(fix);
    await waitFor(() => expect(order).toEqual(['PUT', 'START']));
    expect(bodies).toEqual([
      {
        providers: {
          discovery: ['travelpayouts', 'searchapi', 'camoufox'],
          verification: ['searchapi'],
          discoveryRefreshHours: { travelpayouts: 168, searchapi: 168 },
        },
      },
    ]);
  });

  it('keeps the start’s refusal visible after the save re-reads the cards', async () => {
    const order: string[] = [];
    let saved = false;
    server.use(
      http.get(`${API}/definitions/cards`, () =>
        HttpResponse.json(
          apiContract.searchCardsResponseSchema.parse({
            cards: [
              { ...offAndEmpty(), discovery: saved ? ['travelpayouts', 'camoufox'] : ['travelpayouts'] },
            ],
            pointOfSale: 'GB',
          }),
        ),
      ),
      http.get(`${API}/providers`, () => HttpResponse.json(withBrowser())),
      http.get(`${API}/definitions`, () => HttpResponse.json([definition({ id: 'def-0001' })])),
      http.put(`${API}/definitions/:id`, () => {
        order.push('PUT');
        saved = true;
        return HttpResponse.json(definition({ id: 'def-0001' }));
      }),
      http.post(`${API}/definitions/:id/executions`, () => {
        order.push('START');
        return HttpResponse.json({ error: { code: 'active', message: 'already' } }, { status: 409 });
      }),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const fix = await within(card).findByRole('button', { name: /^Turn on the browser for/ });
    await waitFor(() => expect(fix).toBeEnabled());
    await user.click(fix);
    await waitFor(() => expect(order).toEqual(['PUT', 'START']));
    // the re-read now says the browser is on, so the reason and the fix label are gone; the refusal stays
    await waitFor(() => expect(card.querySelector('.tcard-nothing')).not.toHaveTextContent('browser is off'));
    expect(await within(card).findByText(COPY.searchAgain.refused.active)).toBeInTheDocument();
    await act(async () => undefined);
    expect(within(card).getByText(COPY.searchAgain.refused.active)).toBeInTheDocument();
  });

  it('starts nothing when the save fails, and says so beside the button', async () => {
    const order: string[] = [];
    server.use(serveCards([offAndEmpty()]), ...serveOrder(order, [], 500));
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const fix = await within(card).findByRole('button', { name: /^Turn on the browser for/ });
    await waitFor(() => expect(fix).toBeEnabled());
    await user.click(fix);
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      "Couldn't turn the browser on: db is down",
    );
    expect(order).toEqual(['PUT']);
  });

  it('with the browser not set up, no fix: one sentence and a link to Settings', async () => {
    server.use(serveCards([offAndEmpty()]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(card.querySelector('.tcard-nothing')).toHaveTextContent(S.browserNotSetUp);
    expect(within(card).queryByRole('button', { name: /^Turn on the browser/ })).toBeNull();
    const link = within(card).getByRole('link', { name: 'Settings' });
    expect(link).toHaveAttribute('href', '/?view=settings');
    // the link is the sentence's own word, not a separate one in the foot
    expect(link.closest('.tcard-nothing')).toHaveTextContent(
      'The browser is not set up yet. Set it up in Settings.',
    );
    expect(within(card).getAllByRole('link', { name: 'Settings' })).toHaveLength(1);
    expect(within(card).getByRole('button', { name: /^Search again/ })).toBeInTheDocument();
  });

  it('is not offered when the browser is already on for the search', async () => {
    server.use(
      serveCards([{ ...offAndEmpty(), discovery: ['travelpayouts', 'camoufox'] }]),
      http.get(`${API}/providers`, () => HttpResponse.json(withBrowser())),
    );
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).queryByRole('button', { name: /^Turn on the browser/ })).toBeNull();
    expect(card.querySelector('.tcard-nothing')).not.toHaveTextContent('browser is off');
    await act(async () => undefined);
  });
});
