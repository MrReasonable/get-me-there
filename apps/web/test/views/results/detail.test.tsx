import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { DefinitionResponse, ResultsResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import {
  API,
  calendarGap,
  calendarRow,
  cell,
  DETAIL_PAIR,
  DETAIL_SEARCH,
  datePairFigure,
  definition,
  provCalendar,
  provSynthetic,
  resultsResponse,
  verifiedRow,
} from '../../fixtures.js';
import { cellAt, cellDetail } from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';

// Spec §11 "Date pair detail" (WP19 Task 19.6): Results scoped to one date pair, opened from a board row, an overview
// cell or an alert email, with the per-airport-pair panels beneath. msw stands in for the scoped `/results` read.

const RESULTS = `${API}/definitions/:id/results`;
const CELL = `${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;

/** Serves `body` (or one chosen from the request's query) for every `/results` read, recording each request's URL. */
function serveResults(body: ResultsResponse | ((q: URLSearchParams) => ResultsResponse)) {
  const requests: URL[] = [];
  server.use(
    http.get(RESULTS, ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      return HttpResponse.json(typeof body === 'function' ? body(url.searchParams) : body);
    }),
  );
  return requests;
}

function detail(
  search: string = DETAIL_SEARCH,
  body: ResultsResponse | ((q: URLSearchParams) => ResultsResponse) = resultsResponse({
    rows: [verifiedRow()],
  }),
  def: DefinitionResponse = definition(),
) {
  const requests = serveResults(body);
  const r = renderWithProviders(<ResultsView definition={def} datePair={DETAIL_PAIR} />, { search });
  return { ...r, requests };
}

const table = () => screen.findByRole('table', { name: 'Round trips found' });
const dataRows = () =>
  within(screen.getByRole('table', { name: 'Round trips found' }))
    .getAllByRole('row')
    .filter((r) => r.querySelector('[aria-expanded]') !== null);
const query = (u: URL | undefined) => Object.fromEntries(u?.searchParams.entries() ?? []);

describe('the detail reads /results scoped to its date pair (spec §11, §10)', () => {
  it('sends the date pair, the Dates airport filter and the journey limit, and nothing for the stay range or sort', async () => {
    const { requests } = detail(
      `${DETAIL_SEARCH}&d.from=LHR&d.to=JFK&d.journey=600&d.nights=10-14&d.sort=journey.asc&d.week=best`,
    );
    await table();
    expect(query(requests[0])).toEqual({
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      origins: 'LHR',
      destinations: 'JFK',
      maxJourneyMinutes: '600',
    });
    // the header names this date pair, and the rows are the scoped read's
    expect(
      screen.getByRole('heading', { name: '14 Mar 2027 to 28 Mar 2027 · 14 nights' }),
    ).toBeInTheDocument();
    expect(dataRows()).toHaveLength(1);
  });

  it('without a Dates filter it sends the date pair alone', async () => {
    const { requests } = detail();
    await table();
    expect(query(requests[0])).toEqual({ departureDate: '2027-03-14', returnDate: '2027-03-28' });
  });

  it('opened under d.journey=600, the read carries the limit and no row over 600 minutes leads', async () => {
    const long = verifiedRow({ pricePence: 30000, totalMinutes: 1005 });
    const short = verifiedRow({ itineraryHash: 'hash-short', pricePence: 45000, totalMinutes: 600 });
    // why: the api applies the journey limit to the scoped rows (parseScope); this handler answers as it would
    detail(`${DETAIL_SEARCH}&d.journey=600`, (q) =>
      q.get('maxJourneyMinutes') === '600'
        ? resultsResponse({ rows: [short] })
        : resultsResponse({ rows: [long, short] }),
    );
    await table();
    expect(dataRows()).toHaveLength(1);
    const headline = screen.getByTestId('detail-headline');
    expect(within(headline).getByTestId('price-cell')).toHaveTextContent('£450');
  });
});

describe("Results' own filters inside the detail (spec §11: the date pair and the Dates airport filter fix them)", () => {
  it('the nights, departure and destination filters are hidden and ignored; the others stay', async () => {
    // why: a stale f.nights and f.dest (from a Results link before WP19) must not empty a detail opened under d.to=JFK
    detail(`${DETAIL_SEARCH}&d.to=JFK&f.nights=20-21&f.dest=EWR&f.depart=2027-05-01..2027-05-02`);
    await table();
    expect(dataRows()).toHaveLength(1);
    expect(screen.queryByLabelText('Min nights')).toBeNull();
    expect(screen.queryByLabelText('Max nights')).toBeNull();
    expect(screen.queryByLabelText('Departs on or after')).toBeNull();
    expect(screen.queryByLabelText('Departs on or before')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'EWR' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'JFK' })).toBeNull();
    expect(screen.getByText(COPY.filtersSummary(0))).toBeInTheDocument();
    for (const label of [
      'Max stops',
      'Carriers (comma-separated codes)',
      'Max price (£)',
      'Has this constraint unverified',
    ])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Hide stale rows' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'verified' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'SearchApi' })).toBeInTheDocument();
  });
});

describe('the detail header (spec §11 Date pair detail)', () => {
  it('names the date pair, the airport pairs in scope under a filter, the headline and the coverage line', async () => {
    detail(`${DETAIL_SEARCH}&d.to=JFK`);
    await table();
    expect(screen.getByText('2 of 4 airport pairs')).toBeInTheDocument();
    const headline = screen.getByTestId('detail-headline');
    expect(headline).toHaveTextContent('cheapest found');
    expect(headline).toHaveTextContent('£412');
    expect(headline).toHaveTextContent(
      'JFK 14 Mar 2027–28 Mar 2027 (14n) · itinerary-search basis · verified',
    );
    // provider, source, the full age and point of sale in words, from PriceCell's provenance
    expect(within(headline).getByTestId('provenance')).toHaveTextContent('SearchApi');
    expect(within(headline).getByTestId('point-of-sale')).toHaveTextContent('UK market');
    const coverage = screen.getByRole('link', { name: /^discovery: / });
    expect(coverage).toHaveAttribute('href', '/?view=dates&def=def-0001&d.to=JFK&d.coverage=open');
  });

  it('without an airport filter the scope line is left out', async () => {
    detail();
    await table();
    expect(screen.queryByText(/airport pairs$/)).toBeNull();
  });

  it("when the board's figure is the cheapest row, no second line is shown", async () => {
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow()], datePairFigure: datePairFigure() }));
    await table();
    expect(screen.queryByTestId('board-figure')).toBeNull();
  });

  it("a not-seen verified row cheaper than the board's figure: both lines show, and the second says why they differ", async () => {
    const unseen = verifiedRow({
      itineraryHash: 'hash-unseen',
      pricePence: 38000,
      notSeenInLatest: { ageHours: 30 },
    });
    detail(
      DETAIL_SEARCH,
      resultsResponse({ rows: [unseen, verifiedRow()], cheapest: unseen, datePairFigure: datePairFigure() }),
    );
    await table();
    const headline = screen.getByTestId('detail-headline');
    expect(within(headline).getByTestId('price-cell')).toHaveTextContent('£380');
    expect(within(headline).getByTestId('price-cell')).toHaveTextContent('not seen in latest search');
    const board = screen.getByTestId('board-figure');
    expect(board).toHaveTextContent('Dates board price:');
    expect(within(board).getByTestId('price-cell')).toHaveTextContent('£412');
    expect(board).toHaveTextContent('LHR → JFK · itinerary-search basis');
    expect(board).toHaveTextContent('the board prefers a price the latest search returned, then a fresh one');
  });

  it('a calendar board figure on another airport pair is shown through PriceCell, marked as not checked', async () => {
    const figure = datePairFigure({
      basis: 'calendar',
      origin: 'LGW',
      destination: 'EWR',
      price: { pricePence: 39900, provenance: provCalendar, stale: false, ageHours: 50, truncated: false },
      journeyMinutes: null,
      departOut: null,
      arriveOut: null,
      departBack: null,
      arriveBack: null,
    });
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow()], datePairFigure: figure }));
    await table();
    const board = screen.getByTestId('board-figure');
    expect(within(board).getByTestId('price-cell')).toHaveTextContent('£399');
    expect(within(board).getByTestId('provenance')).toHaveTextContent('constraints not checked');
    expect(board).toHaveTextContent('LGW → EWR · calendar basis');
  });
});

describe('arrival on the primary row (spec §11, as on the board)', () => {
  it('each direction with segments says "arrives HH:MM", with the day offset and its date in words', async () => {
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow(), calendarRow()] }));
    await table();
    const [itinerary, cached] = dataRows();
    if (itinerary === undefined || cached === undefined) throw new Error('two rows');
    expect(itinerary).toHaveTextContent('out: arrives 15:10');
    // the overnight return pins the day offset
    expect(itinerary).toHaveTextContent('back: arrives 07:00 +1');
    expect(itinerary).toHaveTextContent('(arrives on Monday 29 March 2027)');
    expect(within(cached).queryByTestId('arrives')).toBeNull();
  });

  it('at 375px the arrivals stay on the primary row', async () => {
    setViewportWidth(375);
    detail();
    await table();
    const [row] = dataRows();
    expect(row).toHaveTextContent('back: arrives 07:00 +1');
  });
});

describe('the basis switch in the detail (spec §6.9, §11)', () => {
  it('opens on basis= from the link, says why, and switching keeps the date pair', async () => {
    const { requests, user } = detail(`${DETAIL_SEARCH}&basis=calendar`, (q) =>
      q.get('basis') === 'calendar'
        ? resultsResponse({
            rows: [calendarRow({ cell: cell('LHR', 'EWR', '2027-03-14', '2027-03-28', 14) })],
            basis: 'calendar',
            basisReason: 'the link asked for the calendar basis',
          })
        : resultsResponse({ rows: [verifiedRow()] }),
    );
    await table();
    expect(query(requests[0])).toMatchObject({ basis: 'calendar', departureDate: '2027-03-14' });
    expect(screen.getByRole('radio', { name: 'calendar basis' })).toBeChecked();
    expect(screen.getByText('the link asked for the calendar basis')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'itinerary-search basis' }));
    const url = new URLSearchParams(window.location.search);
    expect([url.get('basis'), url.get('depart'), url.get('return')]).toEqual([
      'verified',
      '2027-03-14',
      '2027-03-28',
    ]);
    expect(await screen.findByText('itinerary-searched observations exist')).toBeInTheDocument();
    expect(query(requests.at(-1))).toMatchObject({ basis: 'verified', departureDate: '2027-03-14' });
  });

  it("without basis= the read takes §6.9's default and the header says why", async () => {
    const { requests } = detail();
    await table();
    expect(requests[0]?.searchParams.has('basis')).toBe(false);
    expect(screen.getByText('itinerary-searched observations exist')).toBeInTheDocument();
  });
});

describe('"Back to dates" (spec §11: the Dates filters and sort kept)', () => {
  it('links to the Dates view with every d.* kept and the detail parameters removed', async () => {
    const { user, client } = detail(
      '?view=results&def=def-0001&d.nights=10-14&d.to=JFK&d.sort=journey.asc&d.week=best&depart=2027-03-14&return=2027-03-28&basis=calendar&row=calendar%3A7',
      resultsResponse({ rows: [verifiedRow()], basis: 'calendar' }),
    );
    await table();
    const back = screen.getByRole('link', { name: 'Back to dates' });
    const href = '/?view=dates&def=def-0001&d.nights=10-14&d.to=JFK&d.sort=journey.asc&d.week=best';
    expect(back).toHaveAttribute('href', href);
    await user.click(back);
    expect(`${window.location.pathname}${window.location.search}`).toBe(href);
    // why: the panels' reads finish here, so none reaches the next test's handlers
    await settled(client);
  });
});

describe('per-airport-pair panels (spec §11: what the calendar side panel was)', () => {
  it('one panel per airport pair in scope, in generation order, each read from its own cell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(CELL, ({ request, params }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(
          cellDetail(cellAt('2027-03-14', 14, String(params.origin), String(params.destination))),
        );
      }),
    );
    const { client } = detail(`${DETAIL_SEARCH}&d.to=JFK`);
    await table();
    const panels = await screen.findAllByTestId('airport-pair-panel');
    expect(panels.map((p) => p.querySelector('h3')?.textContent)).toEqual(['LGW → JFK', 'LHR → JFK']);
    await settled(client);
    expect([...paths].sort()).toEqual([
      '/api/definitions/def-0001/cells/LGW/JFK/2027-03-14/2027-03-28',
      '/api/definitions/def-0001/cells/LHR/JFK/2027-03-14/2027-03-28',
    ]);
  });

  it('without a filter every airport pair of the definition has its panel', async () => {
    detail();
    await table();
    const panels = await screen.findAllByTestId('airport-pair-panel');
    expect(panels.map((p) => p.querySelector('h3')?.textContent)).toEqual([
      'LGW → EWR',
      'LGW → JFK',
      'LHR → EWR',
      'LHR → JFK',
    ]);
  });

  it('the calendar-gap cells of this date pair are marked in their panels, and only theirs', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json(
          calendarGap({
            cells: [
              {
                cell: cell('LHR', 'EWR', '2027-03-14', '2027-03-28', 14),
                calendar: {
                  pricePence: 39900,
                  provenance: provCalendar,
                  stale: false,
                  ageHours: 50,
                  truncated: false,
                },
                verifyAvailable: true,
              },
              {
                // another date pair's gap cell is not this detail's
                cell: cell('LGW', 'JFK', '2027-04-02', '2027-04-16', 14),
                calendar: {
                  pricePence: 30000,
                  provenance: provCalendar,
                  stale: false,
                  ageHours: 50,
                  truncated: false,
                },
                verifyAvailable: true,
              },
            ],
          }),
        ),
      ),
    );
    detail();
    await table();
    const marks = await screen.findAllByTestId('gap-mark');
    expect(marks).toHaveLength(1);
    const panel = marks[0]?.closest('[data-testid="airport-pair-panel"]');
    expect(panel?.querySelector('h3')).toHaveTextContent('LHR → EWR');
    const prices = within(marks[0] ?? document.body).getAllByTestId('price-cell');
    expect(prices.map((p) => p.textContent?.match(/£\d+/)?.[0])).toEqual(['£399', '£412']);
  });
});

describe('booking on the cheapest row (spec §11, WP9 BookingAction)', () => {
  it.each([1280, 375])(
    'at %ipx the cheapest row carries its booking link beside its price and class badge',
    async (width) => {
      setViewportWidth(width);
      const dearer = verifiedRow({ itineraryHash: 'hash-dearer', pricePence: 52000 });
      detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow(), dearer] }));
      await table();
      const [cheapest, other] = dataRows();
      if (cheapest === undefined || other === undefined) throw new Error('two rows');
      expect(within(cheapest).getByRole('link', { name: 'open on www.google.com' })).toHaveAttribute(
        'href',
        'https://www.google.com/travel/clk/f?id=1',
      );
      expect(within(cheapest).getByTestId('price-cell')).toHaveTextContent('£412');
      expect(within(cheapest).getByText('verified')).toBeInTheDocument();
      expect(within(other).queryByRole('link', { name: 'open on www.google.com' })).toBeNull();
    },
  );

  it('a POST booking is a form button, and no booking is "no link"', async () => {
    const post = verifiedRow({
      booking: {
        kind: 'post',
        url: 'https://www.google.com/travel/clk/f',
        postData: 'u=abc',
        host: 'www.google.com',
      },
    });
    const first = detail(DETAIL_SEARCH, resultsResponse({ rows: [post] }));
    await table();
    expect(
      within(dataRows()[0] ?? document.body).getByRole('button', {
        name: 'continue on www.google.com (sends a form)',
      }),
    ).toBeInTheDocument();
    first.unmount();
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow({ booking: { kind: 'none' } })] }));
    await table();
    expect(within(dataRows()[0] ?? document.body).getByText('no link')).toBeInTheDocument();
  });
});

describe('row= in the detail (spec §11, §8.3)', () => {
  it("a row no longer among this date pair's results says so", async () => {
    detail(`${DETAIL_SEARCH}&row=hash-gone`);
    await table();
    expect(screen.getByText("That result is no longer among this date pair's results.")).toBeInTheDocument();
  });

  it('a row that is there is selected, and no such line shows', async () => {
    detail(`${DETAIL_SEARCH}&row=hash-verified-1`);
    await table();
    expect(dataRows()[0]).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByText(/no longer among this date pair/)).toBeNull();
  });
});

describe('a date pair without a row (spec §11: never "no flights")', () => {
  it('says so with its coverage line and a link to the coverage section', async () => {
    detail(`${DETAIL_SEARCH}&d.to=JFK`, resultsResponse({ rows: [], cheapest: null }));
    const empty = await screen.findByTestId('detail-empty');
    expect(empty).toHaveTextContent('No round trip found for these dates on this basis.');
    expect(empty).toHaveTextContent(/discovery: 60 priced/);
    expect(within(empty).getByRole('link', { name: COPY.detailView.coverageSection })).toHaveAttribute(
      'href',
      '/?view=dates&def=def-0001&d.to=JFK&d.coverage=open',
    );
    expect(document.body.textContent ?? '').not.toMatch(/no flights/i);
  });
});

describe('the synthetic banner in the detail (spec §5.5, revision 50)', () => {
  const banner = () => screen.queryByText(/Synthetic data: the fixture provider is enabled/);

  it('real verified rows and a synthetic calendar board figure: the banner shows', async () => {
    const figure = datePairFigure({
      basis: 'calendar',
      price: { pricePence: 39900, provenance: provSynthetic, stale: false, ageHours: 0, truncated: false },
      journeyMinutes: null,
      departOut: null,
      arriveOut: null,
      departBack: null,
      arriveBack: null,
    });
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow()], datePairFigure: figure }));
    await table();
    expect(banner()).toBeInTheDocument();
  });

  it('a synthetic cheaper-cached price on the board figure shows it too', async () => {
    const figure = datePairFigure({
      cheaperCached: {
        pricePence: 30000,
        provenance: provSynthetic,
        stale: false,
        truncated: false,
        origin: 'LGW',
        destination: 'EWR',
      },
    });
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow()], datePairFigure: figure }));
    await table();
    expect(banner()).toBeInTheDocument();
  });

  it('a synthetic calendar-gap price the detail marks shows it', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json(
          calendarGap({
            cells: [
              {
                cell: cell('LHR', 'EWR', '2027-03-14', '2027-03-28', 14),
                calendar: {
                  pricePence: 39900,
                  provenance: provSynthetic,
                  stale: false,
                  ageHours: 0,
                  truncated: false,
                },
                verifyAvailable: true,
              },
            ],
          }),
        ),
      ),
    );
    detail();
    await screen.findAllByTestId('gap-mark');
    expect(banner()).toBeInTheDocument();
  });

  it('with real prices everywhere there is none', async () => {
    detail(DETAIL_SEARCH, resultsResponse({ rows: [verifiedRow()], datePairFigure: datePairFigure() }));
    await table();
    await screen.findAllByTestId('airport-pair-panel');
    expect(banner()).toBeNull();
  });
});
