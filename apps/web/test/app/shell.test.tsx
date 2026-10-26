import { asIata } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { AppBoundary } from '../../src/components/AppBoundary.js';
import { COPY } from '../../src/copy.js';
import { workedDates } from '../fixtures.dates.js';
import { API, definition, providersResponse, resultsResponse } from '../fixtures.js';
import { expectConsoleErrors } from '../guards.js';
import { datesError, serveDates } from '../msw/datesHandlers.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

describe('shell (spec §11 layout)', () => {
  it('the nav has two tiers, each a list headed by its name: Decide (Dates, History) and Set up (the rest)', async () => {
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    const decide = within(nav).getByRole('list', { name: 'Decide' });
    const setup = within(nav).getByRole('list', { name: 'Set up' });
    expect(
      within(decide)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Dates', 'History']);
    expect(
      within(setup)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Definitions', 'Providers', 'Alerts', 'Status']);
    // each tier's name is text, first in its row
    expect(within(nav).getByText('Decide')).toBeInTheDocument();
    expect(within(nav).getByText('Set up')).toBeInTheDocument();
    // Results is the date pair detail, opened from a board row or a link, never from the nav (spec §11)
    expect(within(nav).queryByRole('link', { name: 'Results' })).toBeNull();
    for (const link of within(nav).getAllByRole('link')) {
      // why: 44 px targets (review UI-15); real links, so they work with the keyboard and new tabs
      expect(link).toHaveClass('min-h-11');
      expect(link.getAttribute('href')).toMatch(/^\/\?view=/);
    }
  });

  it('the current view carries aria-current and a cue that is not colour alone', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    const dates = within(nav).getByRole('link', { name: 'Dates' });
    expect(dates).toHaveAttribute('aria-current', 'page');
    // why: a thick bar under the current entry is drawn in currentColor, so it stays under forced colours too
    expect(dates).toHaveClass('border-b-4', 'font-bold');
    expect(within(nav).getByRole('link', { name: 'History' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'History' })).not.toHaveClass('border-b-4');
    await user.click(within(nav).getByRole('link', { name: 'Providers' }));
    expect(within(nav).getByRole('link', { name: 'Providers' })).toHaveAttribute('aria-current', 'page');
    expect(dates).not.toHaveAttribute('aria-current');
  });

  it('the date pair detail marks no nav entry as current', async () => {
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(nav.querySelector('[aria-current]')).toBeNull();
  });

  it('a skip link comes first and targets the main region; each tier wraps into rows, never a hidden sideways scroll (UI-011)', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    // why: UI-011: a sideways-scrolling nav hid views at 375 px with no affordance; the phone e2e measures the rows
    expect(nav).not.toHaveClass('overflow-x-auto');
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to the main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('alerts renders the Alerts view for the selected definition', async () => {
    renderWithProviders(<App />, { search: '?view=alerts&def=def-0001' });
    expect(await screen.findByRole('heading', { name: COPY.alertsView.heading })).toBeInTheDocument();
  });

  it('definition selector lists definitions and writes def= to the URL', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition(), definition({ id: 'def-0002', name: 'Second example' })]),
      ),
    );
    const { user } = renderWithProviders(<App />, { search: '?view=dates' });
    const select = await screen.findByLabelText('Search definition');
    await screen.findByRole('option', { name: 'Second example' });
    await user.selectOptions(select, 'def-0002');
    expect(new URLSearchParams(window.location.search).get('def')).toBe('def-0002');
  });

  it('red synthetic banner is present when the providers response says synthetic (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=history&def=def-0001' });
    const banner = await screen.findByText(/Synthetic data: the fixture provider is enabled/);
    expect(banner.closest('[role="alert"]')?.className).toContain('bg-red-700');
  });

  it('negative: no synthetic banner and no provider alert for real data', async () => {
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    await screen.findByLabelText('Search definition');
    await screen.findByRole('table', { name: 'Round trips found' });
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText(/Provider status unknown/)).toBeNull();
  });

  it('a failed GET /api/providers is an error state, never a silently absent banner (decision 36)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=dates' });
    expect(
      await screen.findByText(
        'Provider status unknown, so this page cannot say whether its prices are synthetic: database is locked',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    'dates',
    'results&depart=2027-03-14&return=2027-03-28',
    'calendar',
    'coverage',
    'history',
    'alerts',
  ])(
    'the %s view waits for /providers: while it is pending no price renders, so synthetic data never looks real',
    async (view) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`${API}/providers`, async () => {
          await gate;
          return HttpResponse.json(providersResponse({ synthetic: true }));
        }),
      );
      const { client } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001` });
      await screen.findByLabelText('Search definition');
      // why: wait until only /providers is still in flight, so a view that did render would have its data by now
      await waitFor(() => expect(client.isFetching()).toBe(1));
      const main = screen.getByRole('main');
      expect(within(main).queryByTestId('price-cell')).toBeNull();
      expect(within(main).queryByRole('table')).toBeNull();
      expect(within(main).getAllByText(COPY.loading).length).toBeGreaterThan(0);
      release();
      expect(await screen.findByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
      await waitFor(() => expect(within(screen.getByRole('main')).queryByText(COPY.loading)).toBeNull());
    },
  );

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
    renderWithProviders(<App />, { search: '?view=dates' });
    expect(await screen.findByText(/No flight data provider is configured/)).toBeInTheDocument();
  });

  it('no definitions, and a def= that names a missing one, say different things', async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([])));
    const { unmount } = renderWithProviders(<App />, { search: '?view=history' });
    expect(
      await screen.findAllByText('No search definitions yet. Create one under Definitions.'),
    ).not.toHaveLength(0);
    unmount();
    server.resetHandlers();
    renderWithProviders(<App />, { search: '?view=dates&def=gone' });
    expect(
      await screen.findByText('The definition in this link no longer exists. Pick another one above.'),
    ).toBeInTheDocument();
  });
});

describe('a failed definitions load never reads as "no definitions" (CodeRabbit batch 3)', () => {
  it('shows the load error with a retry, and the header selector says nothing rather than "none yet"', async () => {
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'defs boom' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=results' });
    expect(await screen.findByText('Could not load: defs boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(COPY.noDefinitions)).not.toBeInTheDocument();
  });

  it('while the definitions load, the main region says so and the header does not say there are none', () => {
    server.use(http.get(`${API}/definitions`, () => new Promise<never>(() => undefined)));
    renderWithProviders(<App />, { search: '?view=results' });
    expect(screen.queryByText(COPY.noDefinitions)).not.toBeInTheDocument();
    // why: PR #3 review — with the selector hidden and nothing selected, the main region was blank while loading
    expect(within(screen.getByRole('main')).getByText(COPY.loading)).toBeInTheDocument();
  });

  it('once the definitions load, the loading line goes', async () => {
    renderWithProviders(<App />, { search: '?view=definitions' });
    await screen.findByLabelText(COPY.definitionSelectorLabel);
    expect(within(screen.getByRole('main')).queryByText(COPY.loading)).not.toBeInTheDocument();
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

describe('the ?view= landing rules through the App (spec §11 URLs, WP19 Task 19.7)', () => {
  const board = () => screen.findByRole('table', { name: /^Best dates/ });
  const search = () => window.location.search;

  it('an absent view opens Dates, the default view, and the URL is rewritten with replace', async () => {
    const before = window.history.length;
    renderWithProviders(<App />, { search: '?def=def-0001' });
    expect(await board()).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?def=def-0001&view=dates'));
    expect(window.history.length).toBe(before);
  });

  it('?view=calendar with cal.dest lands on Dates filtered to that destination; other cal.* go, unknown parameters stay', async () => {
    const before = window.history.length;
    const requests: URL[] = [];
    server.use(serveDates(workedDates(), requests));
    renderWithProviders(<App />, {
      search: '?view=calendar&def=def-0001&cal.dest=JFK&cal.month=2027-03&foo=1',
    });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001&foo=1&d.to=JFK'));
    expect(await board()).toBeInTheDocument();
    expect(window.history.length).toBe(before);
    expect(requests.at(-1)?.searchParams.get('destinations')).toBe('JFK');
  });

  it('?view=duration lands on Dates keeping def=', async () => {
    renderWithProviders(<App />, { search: '?view=duration&def=def-0001' });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001'));
    expect(await board()).toBeInTheDocument();
  });

  it('?view=coverage lands on Dates with its coverage section open', async () => {
    renderWithProviders(<App />, { search: '?view=coverage&def=def-0001' });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001&d.coverage=open'));
    expect(await board()).toBeInTheDocument();
  });

  it('?view=results without a date pair or row lands on Dates', async () => {
    renderWithProviders(<App />, { search: '?view=results&def=def-0001&depart=2027-03-14&basis=verified' });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001'));
    expect(await board()).toBeInTheDocument();
  });

  it('a date pair the server says is outside the current space replaces the URL with Dates, keeping def= and d.*', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, ({ request }) =>
        new URL(request.url).searchParams.has('departureDate')
          ? HttpResponse.json(
              { error: { code: 'date_pair_outside_space', message: 'that date pair is not in this search' } },
              { status: 422 },
            )
          : HttpResponse.json(resultsResponse()),
      ),
    );
    const before = window.history.length;
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&d.to=JFK&depart=2026-01-01&return=2026-01-10&basis=verified',
    });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001&d.to=JFK'));
    expect(await board()).toBeInTheDocument();
    expect(window.history.length).toBe(before);
  });

  it('an alert link for a search over the 50,000-cell bound still opens its detail (the scoped /results read answers)', async () => {
    server.use(datesError(422, 'too_many_cells', 'too many cells', { cells: 100_000, bound: 50_000 }));
    renderWithProviders(<App />, {
      search:
        '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28&basis=verified&row=hash-verified-1',
    });
    expect(await screen.findByRole('table', { name: 'Round trips found' })).toBeInTheDocument();
    expect(search()).toContain('row=hash-verified-1');
  });

  it('with /providers synthetic and a synthetic read the red banner shows once on Dates (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await board();
    expect(screen.getAllByText(/Synthetic data: the fixture provider is enabled/)).toHaveLength(1);
  });
});

describe('filters kept across views (spec §11: the filters live in the URL and travel with every nav link)', () => {
  it("History's nav link keeps every d.*, and the Dates link back restores the same board with no request for the stay filter or the sort", async () => {
    const requests: URL[] = [];
    server.use(serveDates(workedDates({ destinations: [asIata('JFK')] }), requests));
    const filters = 'd.nights=10-11&d.from=LHR&d.to=JFK&d.journey=900&d.sort=journey.asc&d.week=best';
    const { user } = renderWithProviders(<App />, { search: `?view=dates&def=def-0001&${filters}` });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    const firstBoard = await screen.findByRole('table', { name: /^Best dates/ });
    const rowsBefore = within(firstBoard)
      .getAllByRole('row')
      .map((r) => r.textContent);
    const history = within(nav).getByRole('link', { name: 'History' });
    expect(history).toHaveAttribute('href', `/?view=history&def=def-0001&${filters}`);
    await user.click(history);
    expect(await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Dates' }));
    expect(window.location.search).toBe(`?view=dates&def=def-0001&${filters}`);
    const again = await screen.findByRole('table', { name: /^Best dates/ });
    expect(
      within(again)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual(rowsBefore);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests)
      expect([...r.searchParams.keys()].sort()).toEqual(['destinations', 'maxJourneyMinutes', 'origins']);
  });

  it("the detail's nav links drop its date pair and row, so a view opened from it is never a stale detail", async () => {
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&d.to=JFK&depart=2027-03-14&return=2027-03-28&basis=verified&row=x',
    });
    const nav = await screen.findByRole('navigation', { name: 'Views' });
    expect(within(nav).getByRole('link', { name: 'Dates' })).toHaveAttribute(
      'href',
      '/?view=dates&def=def-0001&d.to=JFK&basis=verified',
    );
  });
});

describe('the status bar on Dates (spec §11, WP19 Task 19.7)', () => {
  it('Run now shows on Dates and Definitions, never on the detail', async () => {
    const dates = renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    expect(await screen.findByRole('button', { name: /Run now/ })).toBeInTheDocument();
    dates.unmount();
    renderWithProviders(<App />, {
      search: '?view=results&def=def-0001&depart=2027-03-14&return=2027-03-28',
    });
    await screen.findByRole('table', { name: 'Round trips found' });
    await screen.findByRole('region', { name: 'Run status' });
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
  });
});
