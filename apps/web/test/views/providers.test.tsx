import { formatDuration } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
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
    // why: ruling 17 (pie-007): an assumed bound reads as an assumption, never as the vendor's own.
    expect(
      within(searchapi).getByText('Discovery: Google date grid via SearchApi · assumed ≤24h (undocumented)'),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText(
        "Itinerary search: Google Flights via SearchApi · vendor's cache age unknown",
      ),
    ).toBeInTheDocument();
    expect(
      within(searchapi).getByText('this month: 615 of 10000 calls · window 1 Oct 2026 to 1 Nov 2026'),
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

  it("heads each card with the provider's name, the one the status bar and filters use; the source labels stay on the capability lines (UI-003)", async () => {
    const base = providersResponse();
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({
          ...base,
          providers: base.providers.map((p) =>
            p.providerId === 'travelpayouts' ? { ...p, displayName: 'Aviasales cache' } : p,
          ),
        }),
      ),
    );
    renderWithProviders(<ProvidersView />);
    const tp = await screen.findByRole('region', { name: 'Travelpayouts' });
    expect(within(tp).getByRole('heading', { level: 3 })).toHaveTextContent(/^Travelpayouts /);
    expect(within(tp).getByText(/^Discovery: Aviasales cache/)).toBeInTheDocument();
  });

  it('names the call cap that governs a £0-per-call plan as a plain line, never an alert (ruling 5)', async () => {
    renderWithProviders(<ProvidersView />);
    const searchapi = await screen.findByRole('region', { name: 'SearchApi' });
    const note = within(searchapi).getByText(/the monthly call cap \(10000 calls\) is the hard stop/);
    expect(note.closest('[role="alert"]')).toBeNull();
    expect(within(searchapi).queryByRole('alert')).toBeNull();
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

  it('a trial plan shows its lifetime window only and never prints "no cap" (review prov-020, ruling 2)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          withSearchApi({
            plan: 'trial',
            excludedFromSchedule: true,
            usage: [usage('provider-lifetime:searchapi', 9, 100)],
          }),
        ),
      ),
    );
    renderWithProviders(<ProvidersView />);
    expect(await screen.findByText("9 of 100 calls over the plan's lifetime")).toBeInTheDocument();
    expect(screen.queryByText(/no cap/)).toBeNull();
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
    const { user } = renderWithProviders(<ProvidersView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: boom');
    // why: the retry is the operator's only way out of the error state, so it is asserted and used
    const retry = screen.getByRole('button', { name: COPY.retryLoad });
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse())));
    await user.click(retry);
    expect(await screen.findByRole('region', { name: COPY.provider.searchapi })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
