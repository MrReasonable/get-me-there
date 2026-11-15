import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
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
import { renderInShell } from './support.js';

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
  it('is headed Trips, with "+ New search" that moves focus into the new-search panel', async () => {
    server.use(serveCards([searchCard()]));
    const { user } = renderInShell(<SearchesView />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trips' })).toBeInTheDocument();
    const side = await screen.findByRole('region', { name: S.sideHeading });
    await within(side).findByRole('button', { name: COPY.searchAgain.searchNow });
    await user.click(screen.getByRole('button', { name: '+ New search' }));
    expect(side.contains(document.activeElement)).toBe(true);
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
      /^23 dates with flights read; these are the cheapest\. 155 dates look lower on the calendar, from £372 Cached.*, flights not read\.$/,
    );
    expect(within(line).getByTestId('price-label')).toHaveTextContent(/^Cached/);
    expect(within(line).getByRole('link', { name: '155 dates look lower on the calendar' })).toHaveAttribute(
      'href',
      '/?view=dates&def=def-0001',
    );
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
    expect(detail(at(rows, 0)).getAttribute('href')).toContain('d.from=LHR');
    expect(detail(at(rows, 0)).getAttribute('href')).toContain('d.to=JFK');
    expect(detail(at(rows, 1)).getAttribute('href')).toContain('d.from=LGW');
    expect(detail(at(rows, 1)).getAttribute('href')).toContain('d.to=EWR');
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
    expect(within(card).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/?view=settings');
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
