import { CONSTRAINT_LABELS } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { qk } from '../../../src/api/queries.js';
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
        '1 cell has a calendar price (constraints not checked) below your cheapest verified',
      ),
    ).toBeInTheDocument();
    const prices = within(banner).getAllByTestId('price-cell');
    expect(prices.map((p) => p.firstElementChild?.firstChild?.textContent)).toEqual(['£412', '£399']);
    expect(within(banner).getByText("vendor's cache age unknown")).toBeInTheDocument();
    expect(within(banner).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(banner).getByText('Aviasales cache')).toBeInTheDocument();
    await user.click(
      within(banner).getByRole('button', { name: 'Search this cell for itineraries (uses billed calls)' }),
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
        '2 cells have calendar prices (constraints not checked) below your cheapest verified',
      ),
    ).toBeInTheDocument();
    expect(within(banner).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(banner).getAllByRole('button', { name: /Search this cell/ })).toHaveLength(1);
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
