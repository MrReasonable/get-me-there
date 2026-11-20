import { asIata } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import { AppBoundary } from '../../src/components/AppBoundary.js';
import { COPY } from '../../src/copy.js';
import {
  airportPairIndex,
  at,
  figurePairing,
  pairingFig,
  pricedPair,
  workedDates,
} from '../fixtures.dates.js';
import { API, definition, providersResponse, resultsResponse } from '../fixtures.js';
import { cardTrip, latestRun, lowerOnCalendar, searchCard } from '../fixtures.searches.js';
import { expectConsoleErrors } from '../guards.js';
import { serveDates } from '../msw/datesHandlers.js';
import { serveCards } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';

describe('shell (spec §11 layout)', () => {
  it('the nav is two links, Trips and Settings, in one row at every width: no tiers, no search named, no menu (Ruling 9)', async () => {
    renderWithProviders(<App />, { search: '?view=searches' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Trips', 'Settings']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/?view=searches', '/?view=settings']);
    for (const link of links) {
      // why: 44 px targets (review UI-15); real links, so they work with the keyboard and new tabs
      expect(link).toHaveClass('min-h-11');
    }
    // the old tiers, their names and the phone's menu are gone; so is every per-view entry
    expect(within(nav).queryByRole('list', { name: /Decide|Set up/ })).toBeNull();
    expect(within(nav).queryByText(/Decide|Set up/)).toBeNull();
    expect(screen.queryByRole('button', { name: /All views/ })).toBeNull();
    expect(
      within(nav).queryByRole('link', { name: /Searches|History|Providers|Alerts|Status|Definitions|Edit/ }),
    ).toBeNull();
  });

  it('the logo links to Trips, dropping the search the page shows', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=history&def=def-0001&d.to=JFK' });
    const logo = await screen.findByRole('link', { name: COPY.logoLink });
    expect(logo).toHaveAttribute('href', '/?view=searches&d.to=JFK');
    await user.click(logo);
    expect(await screen.findByRole('list', { name: COPY.searchesView.listLabel })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('view')).toBe('searches');
    expect(new URLSearchParams(window.location.search).has('def')).toBe(false);
  });

  it('a search that no longer exists is not named, and no definition selector is anywhere', async () => {
    window.localStorage.setItem('gmt.lastSearch', 'gone');
    renderWithProviders(<App />, { search: '?view=searches' });
    await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByRole('list', { name: COPY.searchesView.listLabel });
    expect(screen.queryByLabelText(/Search definition/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /search/i })).toBeNull();
  });

  it('the current item carries aria-current and a cue that is not colour alone', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=searches' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const trips = within(nav).getByRole('link', { name: 'Trips' });
    expect(trips).toHaveAttribute('aria-current', 'page');
    // why: a thick bar under the current entry is drawn in currentColor, so it stays under forced colours too
    expect(trips).toHaveClass('border-b-4', 'font-bold');
    const settings = within(nav).getByRole('link', { name: 'Settings' });
    expect(settings).not.toHaveAttribute('aria-current');
    expect(settings).not.toHaveClass('border-b-4');
    await user.click(settings);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(settings).toHaveAttribute('aria-current', 'page');
    expect(trips).not.toHaveAttribute('aria-current');
  });

  it.each([
    ['a search’s page', '?view=dates&def=def-0001', 'Trips'],
    ['the Trip page', '?view=trip&def=def-0001&depart=2027-03-14&return=2027-03-28', 'Trips'],
    ['the Edit page', '?view=definitions&edit=def-0001', 'Trips'],
    ['History', '?view=history&def=def-0001', 'Trips'],
    ['Calls and caps', '?view=providers', 'Settings'],
    ['Alerts', '?view=alerts&def=def-0001', 'Settings'],
    ['System', '?view=status', 'Settings'],
  ])('%s sits under %s in the nav', async (_name, search, item) => {
    renderWithProviders(<App />, { search });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const current = [...nav.querySelectorAll('[aria-current="page"]')];
    expect(current.map((c) => c.textContent)).toEqual([item]);
  });

  it('a skip link comes first and targets the main region; the two links never scroll sideways (UI-011)', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    // why: UI-011: a sideways-scrolling nav hid views at 375 px with no affordance; the phone e2e measures the row
    expect(nav).not.toHaveClass('overflow-x-auto');
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to the main content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('on a phone the nav is the same two links, with no menu to open', async () => {
    setViewportWidth(375);
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Trips', 'Settings']);
    expect(within(nav).queryByRole('button')).toBeNull();
  });

  it('alerts renders the Alerts view for the selected definition', async () => {
    renderWithProviders(<App />, { search: '?view=alerts&def=def-0001' });
    expect(await screen.findByRole('heading', { name: COPY.alertsView.heading })).toBeInTheDocument();
  });

  it('red synthetic banner is present when the providers response says synthetic (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=history&def=def-0001' });
    const banner = await screen.findByText(/Synthetic data: the fixture provider is enabled/);
    // the alarm plate: red, with a cross beside the words (styles/world.css .alarm)
    expect(banner.closest('[role="alert"]')).toHaveClass('alarm');
  });

  it('negative: no synthetic banner and no provider alert for real data', async () => {
    // why: the Dates fixtures' prices are synthetic and raise the banner themselves; Providers has no prices of its own
    renderWithProviders(<App />, { search: '?view=providers' });
    await screen.findByRole('heading', { name: 'Calls and caps' });
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText(/Provider status unknown/)).toBeNull();
  });

  it('a failed GET /api/providers is an error state, never a silently absent banner (decision 36)', async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      ),
    );
    renderWithProviders(<App />, { search: '?view=searches' });
    expect(
      await screen.findByText(
        'Provider status unknown, so this page cannot say whether its prices are synthetic: database is locked',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    'searches',
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
      await screen.findByRole('navigation', { name: 'Main' });
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
    renderWithProviders(<App />, { search: '?view=searches' });
    expect(await screen.findByText(/No flight data provider is configured/)).toBeInTheDocument();
  });

  it('no definitions, and a def= that names a missing one, say different things', async () => {
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json([])));
    const { unmount } = renderWithProviders(<App />, { search: '?view=history' });
    expect(await screen.findAllByText('No searches yet. Plan one under Trips.')).not.toHaveLength(0);
    unmount();
    server.resetHandlers();
    renderWithProviders(<App />, { search: '?view=dates&def=gone' });
    expect(
      await screen.findByText('The search in this link no longer exists. Pick one under Trips.'),
    ).toBeInTheDocument();
  });
});

describe('a failed definitions load never reads as "no definitions" (CodeRabbit batch 3)', () => {
  it('shows the load error with a retry, and says nothing of "none yet"', async () => {
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

  it('while the definitions load, the main region says so and nothing says there are none', () => {
    server.use(http.get(`${API}/definitions`, () => new Promise<never>(() => undefined)));
    renderWithProviders(<App />, { search: '?view=results' });
    expect(screen.queryByText(COPY.noDefinitions)).not.toBeInTheDocument();
    // why: PR #3 review — with nothing selected, the main region was blank while loading
    expect(within(screen.getByRole('main')).getByText(COPY.loading)).toBeInTheDocument();
  });

  it('once the definitions load, the loading line goes', async () => {
    renderWithProviders(<App />, { search: '?view=definitions&edit=def-0001' });
    await screen.findByRole('heading', { name: COPY.editSearch.heading('Worked example') });
    await screen.findByRole('button', { name: COPY.editSearch.save });
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
  // why: a search's page has drawn once its Cheapest trips section has (design 2026-11-08 §5.2)
  const board = () => screen.findByRole('region', { name: COPY.searchPage.cheapestHeading });
  const search = () => window.location.search;

  it('an absent view opens Searches, the first screen, whatever the number of searches, and the URL is rewritten with replace', async () => {
    const before = window.history.length;
    renderWithProviders(<App />, { search: '?def=def-0001' });
    expect(await screen.findByRole('list', { name: COPY.searchesView.listLabel })).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?def=def-0001&view=searches'));
    expect(window.history.length).toBe(before);
    expect(screen.queryByRole('region', { name: COPY.searchPage.cheapestHeading })).toBeNull();
  });

  it('?view=dates without def= lands on Searches, even with one search; with def= it is that search’s page', async () => {
    const first = renderWithProviders(<App />, { search: '?view=dates' });
    expect(await screen.findByRole('list', { name: COPY.searchesView.listLabel })).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?view=searches'));
    first.unmount();
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    expect(await board()).toBeInTheDocument();
  });

  it('?view=definitions without edit= lands on Searches; with edit= it is the Edit page', async () => {
    const first = renderWithProviders(<App />, { search: '?view=definitions' });
    expect(await screen.findByRole('list', { name: COPY.searchesView.listLabel })).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?view=searches'));
    first.unmount();
    renderWithProviders(<App />, { search: '?view=definitions&edit=def-0001' });
    expect(await screen.findByRole('button', { name: COPY.editSearch.save })).toBeInTheDocument();
  });

  it('a retired ?view=calendar without def= lands on Searches too (there is no search to open)', async () => {
    renderWithProviders(<App />, { search: '?view=calendar&cal.dest=JFK' });
    expect(await screen.findByRole('list', { name: COPY.searchesView.listLabel })).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?view=searches&cal.dest=JFK'));
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

  it('?view=coverage lands on Dates with its coverage section open, the landing then consumed', async () => {
    renderWithProviders(<App />, { search: '?view=coverage&def=def-0001' });
    expect(await screen.findByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    expect(await board()).toBeInTheDocument();
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001'));
  });

  it('?view=results without a date pair or row lands on Dates', async () => {
    renderWithProviders(<App />, { search: '?view=results&def=def-0001&depart=2027-03-14&basis=verified' });
    await waitFor(() => expect(search()).toBe('?view=dates&def=def-0001'));
    expect(await board()).toBeInTheDocument();
  });

  it('an old alert link opens the Trip page, its URL rewritten with replace and basis and row dropped (Ruling 9)', async () => {
    const before = window.history.length;
    renderWithProviders(<App />, {
      search:
        '?view=results&def=def-0001&d.to=JFK&depart=2027-03-14&return=2027-03-28&basis=verified&row=hash-verified-1&f.class=failed&sort=price.asc',
    });
    await waitFor(() =>
      expect(search()).toBe('?view=trip&def=def-0001&d.to=JFK&depart=2027-03-14&return=2027-03-28'),
    );
    expect(window.history.length).toBe(before);
  });

  it('with /providers synthetic and a synthetic read the red banner shows once on Dates (spec §5.5)', async () => {
    server.use(http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))));
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await board();
    expect(screen.getAllByText(/Synthetic data: the fixture provider is enabled/)).toHaveLength(1);
  });
});

describe('filters kept across views (spec §11: the filters live in the URL and travel with every link)', () => {
  it("History's crumb back to the search keeps every d.*, and the page is restored with no request for the stay filter or an old sort", async () => {
    const requests: URL[] = [];
    server.use(serveDates(workedDates({ destinations: [asIata('JFK')] }), requests));
    const filters = 'd.nights=10-11&d.from=LHR&d.to=JFK&d.journey=900&d.sort=journey.asc&d.week=best';
    const { user } = renderWithProviders(<App />, { search: `?view=history&def=def-0001&${filters}` });
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle })).toBeInTheDocument();
    const back = within(crumbs).getByRole('link', { name: 'Worked example' });
    expect(back).toHaveAttribute('href', `/?view=dates&def=def-0001&${filters}`);
    await user.click(back);
    expect(window.location.search).toBe(`?view=dates&def=def-0001&${filters}`);
    expect(await screen.findByRole('region', { name: COPY.searchPage.cheapestHeading })).toBeInTheDocument();
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests)
      expect([...r.searchParams.keys()].sort()).toEqual(['destinations', 'maxJourneyMinutes', 'origins']);
  });

  it("the Trip page's nav links drop its dates and row, so a view opened from it is never a stale trip", async () => {
    renderWithProviders(<App />, {
      search: '?view=trip&def=def-0001&d.to=JFK&depart=2027-03-14&return=2027-03-28',
    });
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    // ruling R-bar: Trips names no search, so its link drops def=; the filters stay
    expect(within(nav).getByRole('link', { name: 'Trips' })).toHaveAttribute(
      'href',
      '/?view=searches&d.to=JFK',
    );
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/?view=settings&def=def-0001&d.to=JFK',
    );
  });
});

describe('every page has one h1, its own heading; the logo is a link, not a heading', () => {
  it.each([
    '?view=searches',
    '?view=dates&def=def-0001',
    '?view=trip&def=def-0001&depart=2027-03-14&return=2027-03-28',
    '?view=history&def=def-0001',
    '?view=definitions&edit=def-0001',
    '?view=alerts&def=def-0001',
    '?view=settings',
    '?view=providers',
    '?view=status',
  ])('%s', async (search) => {
    renderWithProviders(<App />, { search });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1));
    expect(screen.queryByRole('heading', { name: /get-me-there/ })).toBeNull();
  });
});

describe('Settings (Ruling 9) and the breadcrumbs (Ruling 12)', () => {
  it('?view=settings is the Settings page: four section links, Price sources open, and no definition needed', async () => {
    // why: settings plan ruling 14 — the page's sections are links (`section=`); the older views keep their own URLs
    renderWithProviders(<App />, { search: '?view=settings' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: COPY.settingsView.sectionsLabel });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('href')]),
    ).toEqual([
      ['Price sources', '/?view=settings&section=sources'],
      ['Limits', '/?view=settings&section=limits'],
      ['Email and alerts', '/?view=settings&section=email'],
      ['System', '/?view=settings&section=system'],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Price sources' })).toBeInTheDocument();
    // Settings is the top of its trail, so it has none of its own
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('a section link opens that section on the same page', async () => {
    const { user } = renderWithProviders(<App />, { search: '?view=settings' });
    const nav = await screen.findByRole('navigation', { name: COPY.settingsView.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: 'System' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'System' })).toBeInTheDocument();
    const url = new URLSearchParams(window.location.search);
    expect([url.get('view'), url.get('section')]).toEqual(['settings', 'system']);
  });

  it.each([
    // why: ruling R24: the Providers view is Calls and caps, never a second "Price sources"
    ['?view=providers', 'Calls and caps', 'Settings › Calls and caps'],
    ['?view=alerts&def=def-0001', 'Alerts', 'Settings › Alerts'],
    ['?view=status', 'System', 'Settings › System'],
  ])('%s: the heading reads "%s" under the trail "%s"', async (search, heading, trail) => {
    renderWithProviders(<App />, { search });
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent(trail);
    expect(within(crumbs).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      expect.stringContaining('view=settings'),
    );
    expect(within(crumbs).getByText(heading)).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['a search’s page', '?view=dates&def=def-0001', 'Trips › Worked example'],
    ['the Edit page', '?view=definitions&edit=def-0001', 'Trips › Worked example › Edit'],
    ['History', '?view=history&def=def-0001', 'Trips › Worked example › Price over time'],
  ])('%s has the trail "%s"', async (_name, search, trail) => {
    renderWithProviders(<App />, { search });
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    await waitFor(() => expect(crumbs).toHaveTextContent(trail));
    expect(within(crumbs).getByRole('list').tagName).toBe('OL');
    expect(crumbs.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('the Edit and History trails link their search name back to its page, and Trips to the list', async () => {
    renderWithProviders(<App />, { search: '?view=definitions&edit=def-0001' });
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    const name = await within(crumbs).findByRole('link', { name: 'Worked example' });
    expect(name).toHaveAttribute('href', '/?view=dates&def=def-0001');
    expect(within(crumbs).getByRole('link', { name: 'Trips' })).toHaveAttribute('href', '/?view=searches');
  });

  it('the Edit page has no back link of its own beside the trail', async () => {
    renderWithProviders(<App />, { search: '?view=definitions&edit=def-0001' });
    await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(screen.queryByRole('link', { name: /^Back to/ })).toBeNull();
  });
});

describe('the top bar has no run line and no Run now (spec rev 55 §11; design 2026-11-08 Ruling 11)', () => {
  // why: the never-run state's Search now is the page's primary action; every run action lives on the search it acts on
  it('a never-run search’s page shows one Search now, the page’s, and the bar none', async () => {
    server.use(
      serveDates({ executions: [], executionId: null }),
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [], total: 0, executions: [], cheapest: null })),
      ),
    );
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await screen.findByText('Not searched yet', { selector: 'p.font-bold' });
    // why: the page's Search now carries its estimate sentence (spec rev 55 §11 never-run state) once it is in
    expect(await screen.findAllByRole('button', { name: /^Search now/ })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Run status' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
  });

  it.each(['searches', 'dates&def=def-0001', 'definitions&edit=def-0001', 'settings', 'providers', 'status'])(
    'the %s view shows no run line, no Cancel or Resume in the bar and no Run now',
    async (view) => {
      server.use(
        serveCards([
          searchCard({
            name: 'Worked example',
            latestRun: latestRun({ status: 'running', finishedAt: null, estimatedFinishAt: null }),
          }),
        ]),
      );
      renderWithProviders(<App />, { search: `?view=${view}` });
      await screen.findByRole('navigation', { name: 'Main' });
      await screen.findByRole('link', { name: 'Searching: Worked example' });
      expect(screen.queryByRole('region', { name: 'Run status' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
      // why: CodeRabbit CR12: the bar itself (the page's own RunProgress may offer them below it)
      const bar = screen.getByRole('banner');
      expect(within(bar).queryByRole('button', { name: COPY.runProgress.cancel })).toBeNull();
      expect(within(bar).queryByRole('button', { name: COPY.runProgress.resume })).toBeNull();
    },
  );
});

describe('"Searching: <name>" in the top bar (Ruling 10; Review Focus 2)', () => {
  const running = searchCard({
    id: 'def-0001',
    name: 'London → New York',
    origins: ['LHR'],
    destinations: ['JFK'],
    trips: [cardTrip({ origin: 'LHR', destination: 'JFK' })],
    latestRun: latestRun({ id: 'exec-run', status: 'running', finishedAt: null, estimatedFinishAt: null }),
  });

  it.each(['searches', 'settings', 'providers', 'alerts', 'status', 'history'])(
    'on the %s view a running search is named, linking to its page',
    async (view) => {
      server.use(serveCards([running]));
      renderWithProviders(<App />, {
        search: `?view=${view}${view === 'history' || view === 'alerts' ? '&def=def-0001' : ''}`,
      });
      const link = await screen.findByRole('link', { name: 'Searching: London → New York' });
      expect(link).toHaveAttribute('href', expect.stringContaining('view=dates'));
      expect(link).toHaveAttribute('href', expect.stringContaining('def=def-0001'));
      expect(screen.getByRole('region', { name: COPY.topBar.limitsLabel })).toHaveTextContent(
        'Spent £32 of £35 this month',
      );
    },
  );

  it('with no search running only the limits are there', async () => {
    server.use(serveCards([searchCard()]));
    renderWithProviders(<App />, { search: '?view=status' });
    expect(await screen.findByRole('region', { name: COPY.topBar.limitsLabel })).toBeInTheDocument();
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByText(/^Searching:/)).toBeNull();
  });
});

// why: final review C2, I1 and I2 (and its recommendation of one shell-level test): an anchor (`#main`, `#calendar`) or
// an "open once" parameter (`d.coverage=open`) in the URL never reaches a parameter and never travels to another search
describe('what a URL lands at is used once (final review C2, I1, I2)', () => {
  const A = 'Worked example';
  const B = 'Second search';
  const serveTwo = () =>
    server.use(
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([definition(), definition({ id: 'def-0002', name: B })]),
      ),
      serveCards([
        searchCard({ id: 'def-0001', name: A, lowerOnCalendar: lowerOnCalendar({ count: 155 }) }),
        searchCard({ id: 'def-0002', name: B, lowerOnCalendar: lowerOnCalendar({ count: 12 }) }),
      ]),
      serveDates(workedDates()),
    );
  const calendar = () => document.getElementById('calendar');
  /** The search page that opened, by its h1, once its calendar has drawn. */
  const opened = async (name: string) => {
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
    await screen.findByTestId('calendar-months');
  };
  /** The URL holds no fragment and no parameter carries one. */
  const clean = () => {
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('%23');
    for (const v of new URLSearchParams(window.location.search).values()) expect(v).not.toContain('#');
  };
  const crumbs = () => screen.getByRole('navigation', { name: COPY.crumbsLabel });
  const cardName = (name: string) => screen.findByRole('link', { name });

  it('the skip link, a card’s counts link and "See all on the calendar", then a crumb, the nav and a card’s name', async () => {
    serveTwo();
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user } = renderWithProviders(<App />, { search: '?view=searches' });
    // a card's counts link lands on A's calendar, once: the page scrolls there and drops the fragment
    await user.click(await screen.findByRole('link', { name: '155 dates look lower on the calendar' }));
    await opened(A);
    await waitFor(() => expect(scroll.mock.contexts).toContain(calendar()));
    expect(window.location.search).toBe('?view=dates&def=def-0001');
    clean();
    // "See all on the calendar" puts the fragment back; the Trips crumb leaves it behind
    await user.click(screen.getByRole('link', { name: COPY.searchPage.seeAll }));
    expect(window.location.hash).toBe('#calendar');
    await user.click(within(crumbs()).getByRole('link', { name: COPY.crumbs.trips }));
    await cardName(B);
    expect(window.location.search).toBe('?view=searches');
    clean();
    // B opens at its heading: nothing scrolls to its calendar
    scroll.mockClear();
    await user.click(await cardName(B));
    await opened(B);
    expect(scroll.mock.contexts).not.toContain(calendar());
    clean();
    // the skip link, then Edit and the crumb with B's name: the crumb opens B, its def= whole
    await user.click(screen.getByRole('link', { name: COPY.skipToContent }));
    expect(window.location.hash).toBe('#main');
    await user.click(screen.getByRole('link', { name: COPY.searchesView.edit }));
    await screen.findByRole('button', { name: COPY.editSearch.save });
    await user.click(screen.getByRole('link', { name: COPY.skipToContent }));
    expect(window.location.hash).toBe('#main');
    await user.click(within(crumbs()).getByRole('link', { name: B }));
    await opened(B);
    expect(window.location.search).toBe('?view=dates&def=def-0002');
    clean();
    // the skip link, then the nav's Trips link and A's name: A opens at its heading
    await user.click(screen.getByRole('link', { name: COPY.skipToContent }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Trips' }),
    );
    clean();
    scroll.mockClear();
    await user.click(await cardName(A));
    await opened(A);
    expect(window.location.search).toBe('?view=dates&def=def-0001');
    expect(scroll.mock.contexts).not.toContain(calendar());
    clean();
    scroll.mockRestore();
  });

  it('the full search log opened on A is not where B opens', async () => {
    serveTwo();
    const before = window.history.length;
    const { user } = renderWithProviders(<App />, { search: '?view=coverage&def=def-0001' });
    await opened(A);
    const log = await screen.findByRole('table', { name: COPY.coverageHeading });
    expect(log.closest('details')).toHaveAttribute('open');
    // the landing is consumed: the log stays open, and the URL no longer asks for it
    await waitFor(() => expect(window.location.search).toBe('?view=dates&def=def-0001'));
    expect(window.history.length).toBe(before);
    expect(screen.getByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    await user.click(within(crumbs()).getByRole('link', { name: COPY.crumbs.trips }));
    await user.click(await cardName(B));
    await opened(B);
    expect(new URLSearchParams(window.location.search).has('d.coverage')).toBe(false);
    const folds = screen.getByTestId('search-folds');
    for (const d of folds.querySelectorAll('details')) expect(d).not.toHaveAttribute('open');
    expect(screen.queryByRole('table', { name: COPY.coverageHeading })).toBeNull();
    expect(folds.contains(document.activeElement)).toBe(false);
  });
});

// final review M3: the Trip page's crumb back restores the Search page's own airport filter (or none), never the trip's
// pair
describe('the Trip page’s crumb back (final review M3)', () => {
  const lgw = pairingFig({
    origin: asIata('LGW'),
    destination: asIata('EWR'),
    airportPair: airportPairIndex('LGW', 'EWR'),
    pairing: figurePairing({ pricePence: 41_300, fromPence: 41_300 }),
    price: { ...pairingFig().price, pricePence: 41_300 },
  });
  const there = async (user: ReturnType<typeof renderWithProviders>['user']) => {
    const trips = await screen.findByRole('region', { name: COPY.searchPage.cheapestHeading });
    await user.click(within(trips).getByRole('link', { name: /^Details for LGW → EWR/ }));
    await screen.findByTestId('trip-page');
    const q = new URLSearchParams(window.location.search);
    expect([q.get('t.from'), q.get('t.to')]).toEqual(['LGW', 'EWR']);
  };
  const back = async (user: ReturnType<typeof renderWithProviders>['user']) => {
    await user.click(screen.getByTestId('trip-back'));
    await screen.findByRole('region', { name: COPY.searchPage.cheapestHeading });
    return new URLSearchParams(window.location.search);
  };

  it('a multi-airport search with no airport filter comes back with none', async () => {
    server.use(serveDates({ pairs: { [at('2027-03-15', 10)]: pricedPair(lgw) } }));
    const { user } = renderWithProviders(<App />, { search: '?view=dates&def=def-0001&d.nights=10-11' });
    await there(user);
    const p = await back(user);
    expect(Object.fromEntries(p)).toEqual({ view: 'dates', def: 'def-0001', 'd.nights': '10-11' });
  });

  it('a page filtered to one origin comes back filtered to it alone', async () => {
    server.use(serveDates({ pairs: { [at('2027-03-15', 10)]: pricedPair(lgw) } }));
    const { user } = renderWithProviders(<App />, { search: '?view=dates&def=def-0001&d.from=LGW' });
    await there(user);
    const p = await back(user);
    expect(Object.fromEntries(p)).toEqual({ view: 'dates', def: 'def-0001', 'd.from': 'LGW' });
  });
});
