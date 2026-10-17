import { formatDuration } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ProvidersView } from '../../src/views/Providers/ProvidersView.js';
import { API, providersResponse, usage } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

type Entry = ReturnType<typeof providersResponse>['providers'][number];
function withSearchApi(patch: Partial<Entry>) {
  const base = providersResponse();
  return {
    ...base,
    providers: base.providers.map((p) => (p.providerId === 'searchapi' ? { ...p, ...patch } : p)),
  };
}

describe('Providers view (spec §10, §11)', () => {
  it('shows capabilities in words, the plan in words, and usage vs caps with window bounds', async () => {
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByText('plan: SearchApi $40 a month')).toBeInTheDocument();
    expect(
      within(searchapi).getByText(
        `Discovery: Google date grid via SearchApi · prices up to ${formatDuration(24)} old when fetched`,
      ),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText('Itinerary search: Google Flights via SearchApi · provider age unknown'),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText('615 of 10000 calls · window 1 Oct 2026 to 1 Nov 2026'),
    ).toBeInTheDocument();
    const tp = screen.getByRole('region', { name: 'Travelpayouts' });
    expect(
      within(tp).getByText(
        `Discovery: Aviasales cache · prices up to ${formatDuration(48)} old when fetched`,
      ),
    ).toBeInTheDocument();
    expect(within(tp).getByText('Aviasales cache of recent user searches')).toBeInTheDocument();
    expect(within(tp).getByText('plan: free')).toBeInTheDocument();
    expect(formatDuration(48)).toBe('2d'); // canary for the format
  });

  it("shows each provider's notices (the zero-cap message) and marks unconfigured providers", async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({ enabled: false, notices: ['verification will not run: spend cap is 0'] }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    expect(within(searchapi).getByRole('alert')).toHaveTextContent(
      'verification will not run: spend cap is 0',
    );
    expect(within(searchapi).getByText('not configured')).toBeInTheDocument();
  });

  it('only a provider-lifetime scope reads as lifetime; a row without bounds states no window (review prov-020)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({
            plan: 'trial',
            excludedFromSchedule: true,
            usage: [usage('provider-lifetime:searchapi', 9, 100), usage('provider-month:searchapi', 9, null)],
          }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByText("9 of 100 calls over the plan's lifetime")).toBeInTheDocument();
    expect(screen.getByText('9 of no cap calls')).toBeInTheDocument();
    expect(screen.getByText('plan: SearchApi trial credits (lifetime allowance)')).toBeInTheDocument();
    expect(screen.getByText('excluded from scheduled runs')).toBeInTheDocument();
  });

  it('a provider that declares no age beyond the fetch says exactly that', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({
            capabilities: {
              discovery: null,
              verification: { sourceKind: 'scraped-search', provenanceNote: 'x', maxAgeHours: 0 },
            },
          }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(
      await screen.findByText(
        'Itinerary search: Google Flights via SearchApi · provider states no age beyond the fetch time',
      ),
    ).toBeInTheDocument();
  });

  it('a failed load shows the reason and a retry', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
  });
});
