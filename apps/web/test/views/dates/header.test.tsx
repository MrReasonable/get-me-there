import { asIata } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  at,
  calendarFig,
  DATES_SPACE,
  priced,
  pricedPair,
  provCached,
  provSearched,
  provSynthetic,
  runSummary,
  verifiedFig,
  workedDates,
} from '../../fixtures.dates.js';
import { API, calendarGap, cell, execution, provCalendar } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { findBoard, renderDates } from './render.js';

// Spec §11 Dates "Header line", the calendar-gap banner on Dates and the red synthetic banner (revision 50).

/** The worked window with stays up to 20 nights, so a 20-night gap cell is inside the space. */
const WIDE = { ...DATES_SPACE, maxNights: 20 };
const real = { discoveryProviders: ['travelpayouts' as const] };
const realFig = (pence: number) =>
  calendarFig({ price: { ...calendarFig().price, pricePence: pence, provenance: provCached() } });
const banner = () => screen.queryByText(/^Synthetic data: the fixture provider is enabled/);

describe('the header line (spec §11)', () => {
  it('names the search and the run it shows with its status and age', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    expect(screen.getByRole('heading', { name: 'Worked example' })).toBeInTheDocument();
    expect(screen.getByTestId('dates-run')).toHaveTextContent('run finished 2h ago');
  });

  it('a paused run names its reason from the run itself', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ status: 'paused_error', reason: 'rate limited' })),
      ),
    );
    renderDates({
      body: { ...workedDates(), executions: [runSummary({ status: 'paused_error', finishedAt: null })] },
    });
    await findBoard();
    expect(await screen.findByText('run paused 3h ago: rate limited')).toBeInTheDocument();
  });

  it('a run that ended otherwise names its status', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'cancelled' }))),
    );
    renderDates({ body: { ...workedDates(), executions: [runSummary({ status: 'cancelled' })] } });
    expect(await screen.findByText('run cancelled 2h ago')).toBeInTheDocument();
  });

  it('the coverage line in §11’s form over the cells in view, linking to the coverage section', async () => {
    renderDates({ body: workedDates() });
    await findBoard();
    const link = screen.getByRole('link', { name: /^discovery: / });
    expect(link).toHaveTextContent(
      'discovery: 11 priced · 4 no fares · 348 no cached data · 1 error · 4 skipped · 4 not searched of 372 (0 reused) · itinerary-searched 1 of 1 selected (2 outbounds each) +0 on demand',
    );
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('d.coverage')).toBe('open');
  });

  it('with filters set, the line covers the date pairs and airport pairs in scope and says so', async () => {
    renderDates({
      body: workedDates({ destinations: ['JFK'] }),
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-11',
    });
    await findBoard();
    const line = screen.getByRole('link', { name: /^discovery: / }).parentElement;
    expect(line).toHaveTextContent('· 2 of 4 airport pairs · 10–11 nights');
    // 31 days × 2 stays × 2 airport pairs
    expect(line).toHaveTextContent(/ of 124 \(0 reused\)/);
  });

  it('the full stay range renders the same line as no filter', async () => {
    renderDates({ body: workedDates(), search: '?view=dates&def=def-0001&d.nights=5-30' });
    await findBoard();
    const line = screen.getByRole('link', { name: /^discovery: / }).parentElement;
    expect(line?.textContent).not.toContain('nights');
    expect(line).toHaveTextContent(/ of 372 /);
  });
});

describe('the calendar-gap banner on Dates (spec §11, revision 50)', () => {
  const gap = () =>
    calendarGap({
      cells: [
        {
          cell: cell('LHR', 'JFK', '2027-03-20', '2027-04-01', 12),
          calendar: {
            pricePence: 30_100,
            provenance: provCalendar,
            stale: false,
            ageHours: 2,
            truncated: false,
          },
          verifyAvailable: true,
        },
        {
          cell: cell('LHR', 'EWR', '2027-03-21', '2027-04-02', 12),
          calendar: {
            pricePence: 30_200,
            provenance: provCalendar,
            stale: false,
            ageHours: 2,
            truncated: false,
          },
          verifyAvailable: true,
        },
        {
          cell: cell('LGW', 'JFK', '2027-03-22', '2027-04-11', 20),
          calendar: {
            pricePence: 30_300,
            provenance: provCalendar,
            stale: false,
            ageHours: 2,
            truncated: false,
          },
          verifyAvailable: true,
        },
      ],
    });

  it('lists only the gap cells inside the airport scope and the stay filter, names its reference across the whole search, and links each to its detail', async () => {
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(gap())));
    renderDates({
      body: workedDates({ destinations: ['JFK'], space: WIDE }),
      search: '?view=dates&def=def-0001&d.to=JFK&d.nights=10-14',
    });
    const section = await screen.findByRole('region', { name: 'Cells to search' });
    // LHR→EWR is outside the airport scope, and the 20-night cell outside the stay filter
    const links = within(section).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['LHR → JFK 20 Mar 2027–1 Apr 2027 (12n)']);
    expect(section).toHaveTextContent('1 cell has a calendar price');
    expect(section).toHaveTextContent('reference across the whole search:');
    expect(within(section).getAllByTestId('price-cell')[0]).toHaveTextContent('£412');
    expect(
      Object.fromEntries(new URL(links[0]?.getAttribute('href') ?? '', 'http://x').searchParams),
    ).toMatchObject({
      view: 'results',
      depart: '2027-03-20',
      return: '2027-04-01',
      'd.to': 'JFK',
    });
  });

  it('under d.nights=10-14 a 20-night gap cell is not listed and the reference is unchanged', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json(
          calendarGap({ cells: [gap().cells[2]].flatMap((c) => (c === undefined ? [] : [c])) }),
        ),
      ),
    );
    renderDates({
      body: workedDates({ space: WIDE }),
      search: '?view=dates&def=def-0001&d.nights=10-14',
    });
    await findBoard();
    expect(screen.queryByRole('region', { name: 'Cells to search' })).toBeNull();
  });

  it('no banner without a verification provider (the gap is never fetched)', async () => {
    let asked = 0;
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () => {
        asked += 1;
        return HttpResponse.json(gap());
      }),
    );
    renderDates({ body: { ...workedDates(), verificationProviderConfigured: false } });
    await findBoard();
    expect(asked).toBe(0);
  });
});

describe('the red synthetic banner, judged on the decoded read (revision 50)', () => {
  const realPairs = (extra: Record<string, ReturnType<typeof pricedPair>> = {}) => {
    const pairs: Record<string, ReturnType<typeof pricedPair>> = {};
    for (let d = 14; d <= 24; d += 1) pairs[at(`2027-03-${d}`, 10)] = pricedPair(realFig(30_000 + d * 100));
    return { ...pairs, ...extra };
  };

  it('shows when only the 11th-ranked figure is synthetic', async () => {
    renderDates({
      body: { ...real, pairs: realPairs({ [at('2027-03-31', 10)]: pricedPair(priced(90_000)) }) },
    });
    await findBoard();
    expect(banner()).toBeInTheDocument();
  });

  it('shows when only a cheaper-cached provenance is synthetic', async () => {
    const fig = verifiedFig({
      price: { ...verifiedFig().price, provenance: provSearched() },
      cheaperCached: {
        pricePence: 20_000,
        provenance: provSynthetic(),
        stale: false,
        truncated: false,
        origin: asIata('LGW'),
        destination: asIata('EWR'),
      },
    });
    renderDates({ body: { ...real, pairs: { [at('2027-03-14', 10)]: pricedPair(fig) } } });
    await findBoard();
    expect(banner()).toBeInTheDocument();
  });

  it('shows for a fixture run that priced nothing', async () => {
    renderDates({ body: { discoveryProviders: ['fixture'], rest: { no_data: 4 } } });
    expect(await screen.findByText('No prices in this run.')).toBeInTheDocument();
    expect(banner()).toBeInTheDocument();
  });

  it('is absent when nothing in the read is synthetic, whatever the rows shown', async () => {
    renderDates({ body: { ...real, pairs: realPairs() } });
    await findBoard();
    expect(banner()).toBeNull();
  });
});
