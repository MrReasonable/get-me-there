import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { AppBoundary } from '../../src/components/AppBoundary.js';
import { API, definition, providersResponse } from '../fixtures.js';
import { expectConsoleErrors } from '../guards.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('shell (spec §11 layout)', () => {
  it('nav lists every view, with 44px targets, and keeps filters when switching', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=results&def=def-0001&f.stops=1' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    for (const name of [
      'Results',
      'Calendar',
      'Duration',
      'History',
      'Coverage',
      'Definitions',
      'Alerts',
      'Providers',
    ]) {
      expect(within(nav).getByRole('link', { name })).toHaveClass('min-h-11');
    }
    await user.click(within(nav).getByRole('link', { name: 'Calendar' }));
    expect(window.location.search).toBe('?view=calendar&def=def-0001&f.stops=1');
    expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
  });

  it.each(['duration', 'history', 'alerts'])(
    '%s is a placeholder that names no work package',
    async (view) => {
      renderWithProviders(<App />, { search: `?view=${view}` });
      expect(await screen.findByText('This view is not available yet.')).toBeInTheDocument();
      expect(screen.queryByText(/WP1/)).toBeNull();
    },
  );

  it('definition selector lists definitions and writes def= to the URL', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition(), definition({ id: 'def-0002', name: 'Second example' })]),
      ),
    );
    const { user } = renderWithProviders(<App />, { search: '?view=calendar' });
    const select = await screen.findByLabelText('Search definition');
    await screen.findByRole('option', { name: 'Second example' });
    await user.selectOptions(select, 'def-0002');
    expect(new URLSearchParams(window.location.search).get('def')).toBe('def-0002');
  });

  it('red synthetic banner is present when the providers response says synthetic (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=calendar' });
    const banner = await screen.findByText(/Synthetic data: the fixture provider is enabled/);
    expect(banner.closest('[role="alert"]')?.className).toContain('bg-red-700');
  });

  it('negative: no synthetic banner and no provider alert for real data', async () => {
    renderWithProviders(<App />, { search: '?view=calendar' });
    await screen.findByLabelText('Search definition');
    await screen.findByText('This view is not available yet.');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText(/Provider status unknown/)).toBeNull();
  });

  it('a failed GET /api/providers is an error state, never a silently absent banner (decision 36)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=calendar' });
    expect(
      await screen.findByText(
        'Provider status unknown, so this page cannot say whether its prices are synthetic: database is locked',
      ),
    ).toBeInTheDocument();
  });

  it('empty state when no provider is configured', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          providersResponse({
            providers: providersResponse().providers.map((p) => ({ ...p, enabled: false })),
          }),
        ),
      ),
    );
    renderWithProviders(<App />, { search: '?view=calendar' });
    expect(await screen.findByText(/No flight data provider is configured/)).toBeInTheDocument();
  });

  it('no definitions, and a def= that names a missing one, say different things', async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([])));
    const { unmount } = renderWithProviders(<App />, { search: '?view=coverage' });
    expect(
      await screen.findAllByText('No search definitions yet. Create one under Definitions.'),
    ).not.toHaveLength(0);
    unmount();
    server.resetHandlers();
    renderWithProviders(<App />, { search: '?view=coverage&def=gone' });
    expect(
      await screen.findByText('The definition in this link no longer exists. Pick another one above.'),
    ).toBeInTheDocument();
  });
});

describe('the page never blanks (review tsr-002)', () => {
  function Broken(): never {
    throw new Error('render failed');
  }

  it('a render error inside the views shows a message, not an empty page', () => {
    expectConsoleErrors(/render failed/);
    renderWithProviders(
      <AppBoundary>
        <Broken />
      </AppBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong while drawing this page. Reload to try again; nothing was sent.',
    );
  });
});
