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
  DETAIL_PAIR,
  DETAIL_SEARCH,
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
        urls.push(new URL(request.url).searchParams.get('basis') ?? 'default');
        return HttpResponse.json(calendarResults());
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={calendarOnly} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    expect(await screen.findByText('no verification provider configured')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar basis' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'itinerary-search basis' }));
    expect(new URLSearchParams(window.location.search).get('basis')).toBe('verified');
    await expect.poll(() => urls).toEqual(['default', 'verified']);
  });

  it("the shown run's own itinerary-search counts stay when the provider has since been unconfigured", async () => {
    const base = resultsResponse();
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json({ ...base, verificationProviderConfigured: false }),
      ),
    );
    renderWithProviders(<ResultsView definition={calendarOnly} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    await screen.findByRole('table', { name: 'Round trips found' });
    // why: the run itinerary-searched 8 of 10 cells; removing the key afterwards does not un-search them
    expect(screen.getByRole('link', { name: /itinerary-searched 8 of 10 selected/ })).toBeInTheDocument();
    expect(screen.queryByText(/itinerary search not configured/)).toBeNull();
  });

  it('calendar headline and coverage line when no verification provider is configured', async () => {
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())));
    renderWithProviders(<ResultsView definition={calendarOnly} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
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

describe('calendar-gap marks in the detail (spec §11, §6.9; the banner moved to the Dates header)', () => {
  const onThisPair = cell('LHR', 'EWR', '2027-03-14', '2027-03-28', 14);
  const gapHere = () =>
    calendarGap({
      cells: [
        {
          cell: onThisPair,
          calendar: {
            pricePence: 39900,
            provenance: provCalendar,
            stale: false,
            ageHours: 50,
            truncated: false,
          },
          verifyAvailable: true,
        },
      ],
    });

  it('a gap cell of this date pair is marked in its panel, whose verify searches that cell, disabled while it works (UI-5)', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posts: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(gapHere())),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        posts.push(await request.json());
        await gate;
        return HttpResponse.json({ executionId: 'exec-child-1' });
      }),
    );
    const { user } = renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    const [mark] = await screen.findAllByTestId('gap-mark');
    const panel = mark?.closest<HTMLElement>('[data-testid="airport-pair-panel"]');
    if (panel === null || panel === undefined) throw new Error('the mark sits in a panel');
    expect(panel.querySelector('h3')).toHaveTextContent('LHR → EWR');
    const name = 'Search LHR → EWR 14 Mar 2027–28 Mar 2027 (14n) for itineraries (uses billed calls)';
    await within(panel).findByText('hard stop 6 calls · 1840 calls of budget headroom left');
    await user.click(within(panel).getByRole('button', { name }));
    expect(within(panel).getByRole('button', { name })).toBeDisabled();
    release();
    expect(await within(panel).findByRole('status')).toHaveTextContent(
      'Itinerary search started for LHR → EWR 14 Mar 2027–28 Mar 2027 (14n)',
    );
    expect(posts).toEqual([
      {
        definitionId: 'def-0001',
        cell: { origin: 'LHR', destination: 'EWR', departureDate: '2027-03-14', returnDate: '2027-03-28' },
        confirmCalls: 6,
        confirmCostPence: 0,
      },
    ]);
  });

  it('a failed gap request says so above the panels, never looks like "no gap" (review prov-019)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    expect(await screen.findByText('Could not load: boom')).toBeInTheDocument();
  });

  it('is never requested without a verification provider', async () => {
    let gapHits = 0;
    server.use(
      http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(calendarResults())),
      http.get(`${API}/definitions/:id/calendar-gap`, () => {
        gapHits += 1;
        return HttpResponse.json(gapHere());
      }),
    );
    const { client } = renderWithProviders(<ResultsView definition={calendarOnly} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    await screen.findByRole('table', { name: 'Round trips found' });
    // why: settle first, so a request the render fired late would be counted (review tsr2-002).
    await settled(client);
    expect(screen.queryByTestId('gap-mark')).toBeNull();
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
    renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    expect(await screen.findByText(COPY.thinCoverage)).toBeInTheDocument();
  });
  it('half or fewer does not', async () => {
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(withCoverage(54, 54))));
    renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    await screen.findByText(/discovery: 54 priced/);
    expect(screen.queryByText(COPY.thinCoverage)).toBeNull();
  });
});
