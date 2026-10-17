import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { qk } from '../../../src/api/queries.js';
import { COPY } from '../../../src/copy.js';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import {
  API,
  calendarGap,
  calendarRow,
  cell,
  definition,
  provCalendar,
  resultsResponse,
} from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

const calendarOnly = definition({
  providers: {
    discovery: ['travelpayouts'],
    verification: [],
    discoveryRefreshHours: { travelpayouts: 168 },
  },
});
const calendarResults = () =>
  resultsResponse({
    basis: 'calendar',
    basisReason: 'no verification provider configured',
    rows: [calendarRow()],
    verificationProviderConfigured: false,
    // why: a definition with no verification provider has itinerary-searched nothing
    coverage: { ...resultsResponse().coverage, selected: 0, itinerarySearched: 0, onDemand: 0 },
  });

describe('basis (spec §6.9)', () => {
  it('calendar default says why and switches basis in one click, refetching with basis=', async () => {
    const urls: string[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, ({ request }) => {
        urls.push(new URL(request.url).search);
        return HttpResponse.json(calendarResults());
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={calendarOnly} />);
    expect(await screen.findByText('no verification provider configured')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar basis' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'itinerary-search basis' }));
    expect(new URLSearchParams(window.location.search).get('basis')).toBe('verified');
    await expect.poll(() => urls).toEqual(['', '?basis=verified']);
  });

  it("the shown run's own itinerary-search counts stay when the provider has since been unconfigured", async () => {
    const base = resultsResponse();
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json({ ...base, verificationProviderConfigured: false }),
      ),
    );
    renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    // why: the run itinerary-searched 8 of 10 cells; removing the key afterwards does not un-search them
    expect(screen.getByRole('link', { name: /itinerary-searched 8 of 10 selected/ })).toBeInTheDocument();
    expect(screen.queryByText(/itinerary search not configured/)).toBeNull();
  });

  it('calendar headline and coverage line when no verification provider is configured', async () => {
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())));
    renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent('£399');
    expect(
      within(headline).getByText(
        'EWR 2 Apr 2027–16 Apr 2027 (14n) · calendar basis · constraints not checked',
      ),
    ).toBeInTheDocument();
    expect(within(headline).getByText('Aviasales cache')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /itinerary search not configured$/ })).toBeInTheDocument();
    const L = CONSTRAINT_LABELS;
    expect(
      screen.getByText(`not applied: ${L.arrivalWindowLocal}, ${L.maxJourneyMinutes}, ${L.maxStops}`),
    ).toBeInTheDocument();
    expect(screen.getAllByText('onward leg not included').length).toBeGreaterThan(0);
  });
});

describe('calendar-gap banner (spec §11, §6.9)', () => {
  it('pluralised lead naming unchecked constraints, prices through PriceCell, per-cell verify', async () => {
    const verifies: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        verifies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(
      within(banner).getByText(
        '1 cell has a calendar price (constraints not checked) below your reference verified price (latest seen, then fresh, then cheapest)',
      ),
    ).toBeInTheDocument();
    const prices = within(banner).getAllByTestId('price-cell');
    expect(prices.map((p) => p.firstElementChild?.firstChild?.textContent)).toEqual(['£412', '£399']);
    expect(within(banner).getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(within(banner).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(banner).getByText('Aviasales cache')).toBeInTheDocument();
    await user.click(
      within(banner).getByRole('button', {
        name: 'Search LHR → EWR 2 Apr 2027–16 Apr 2027 (14n) for itineraries (uses billed calls)',
      }),
    );
    await expect
      .poll(() => verifies)
      .toEqual([
        {
          definitionId: 'def-0001',
          cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-04-02', returnDate: '2027-04-16' },
        },
      ]);
  });

  it('every gap price carries the operator note for its destination (spec §11)', async () => {
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())));
    renderWithProviders(
      <ResultsView
        definition={definition({
          destinationNotes: { JFK: 'onward leg not included', EWR: 'train to city extra' },
        })}
      />,
    );
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(within(banner).getByText('onward leg not included')).toBeInTheDocument();
    expect(within(banner).getByText('train to city extra')).toBeInTheDocument();
  });

  it('each verify button names its cell, is disabled while it works, and its status names that cell (UI-5)', async () => {
    const more = {
      cell: cell('LGW', 'JFK', '2027-04-05', '2027-04-19', 14),
      calendar: { pricePence: 39000, provenance: provCalendar, stale: false, ageHours: 50, truncated: false },
      verifyAvailable: true,
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...calendarGap(), cells: [...calendarGap().cells, more] }),
      ),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        posts.push(await request.json());
        await gate;
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    const buttons = within(banner).getAllByRole('button', { name: /for itineraries/ });
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Search LHR → EWR 2 Apr 2027–16 Apr 2027 (14n) for itineraries (uses billed calls)',
      'Search LGW → JFK 5 Apr 2027–19 Apr 2027 (14n) for itineraries (uses billed calls)',
    ]);
    await user.click(buttons[0] ?? document.body);
    const working = await within(banner).findByRole('button', { name: 'Working…' });
    expect(working).toBeDisabled();
    await user.click(working);
    release();
    expect(await within(banner).findByRole('status')).toHaveTextContent(
      'Itinerary search started for LHR → EWR 2 Apr 2027–16 Apr 2027 (14n)',
    );
    expect(posts).toHaveLength(1);
  });

  it('a cheapest-verified figure the latest search no longer returned says so (decision 54)', async () => {
    const base = calendarGap();
    const cv = base.cheapestVerified;
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...base, cheapestVerified: cv && { ...cv, notSeenInLatest: { ageHours: 72 } } }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(within(banner).getByText(/not seen in latest search/)).toBeInTheDocument();
  });

  it('a truncated calendar cell says "cheapest of the rows read"; two cells pluralise', async () => {
    const more = {
      cell: cell('LGW', 'JFK', '2027-04-05', '2027-04-19', 14),
      calendar: { pricePence: 39000, provenance: provCalendar, stale: false, ageHours: 50, truncated: true },
      verifyAvailable: false,
    };
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...calendarGap(), cells: [...calendarGap().cells, more] }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} />);
    const banner = await screen.findByRole('region', { name: 'Cells to search' });
    expect(
      within(banner).getByText(
        '2 cells have calendar prices (constraints not checked) below your reference verified price (latest seen, then fresh, then cheapest)',
      ),
    ).toBeInTheDocument();
    expect(within(banner).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(
      within(banner).getAllByRole('button', { name: /for itineraries \(uses billed calls\)/ }),
    ).toHaveLength(1);
  });

  it('a failed gap request says so in the banner place, never looks like "no gap" (review prov-019)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} />);
    expect(await screen.findByText('Could not load: boom')).toBeInTheDocument();
  });

  it('is hidden, and never requested, without a verification provider', async () => {
    let gapHits = 0;
    server.use(
      http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())),
      http.get(`${API}/definitions/:id/calendar-gap`, () => {
        gapHits += 1;
        return HttpResponse.json(calendarGap());
      }),
    );
    const { client } = renderWithProviders(<ResultsView definition={calendarOnly} />);
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByRole('region', { name: 'Cells to search' })).toBeNull();
    // why: settle first, so a request the render fired late would be counted (review tsr2-002).
    await settled(client);
    expect(gapHits).toBe(0);
    expect(
      client.getQueryCache().find({ queryKey: qk.calendarGap(calendarOnly.id) })?.state.dataUpdateCount ?? 0,
    ).toBe(0);
  });
});

describe('thin coverage names the next move (ruling 16, pft-006)', () => {
  const withCoverage = (noData: number, priced: number) =>
    resultsResponse({
      coverage: {
        buckets: { priced, empty: 0, no_data: noData, error: 0, skipped: 0, not_run: 0, reused: 0 },
        total: priced + noData,
        selected: 0,
        itinerarySearched: 0,
        onDemand: 0,
        reused: 0,
      },
    });
  it('more than half the cells with no cached data shows one line with the three moves', async () => {
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(withCoverage(99, 9))));
    renderWithProviders(<ResultsView definition={definition()} />);
    expect(await screen.findByText(COPY.thinCoverage)).toBeInTheDocument();
  });
  it('half or fewer does not', async () => {
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(withCoverage(54, 54))));
    renderWithProviders(<ResultsView definition={definition()} />);
    await screen.findByText(/discovery: 54 priced/);
    expect(screen.queryByText(COPY.thinCoverage)).toBeNull();
  });
});
