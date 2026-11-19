// Design 2026-11-08 Ruling 10: the top bar's health line (from the same query as the Status page, brief WP18 Task 18.6)
// and its limits: SearchApi's credits left, the month's spend and "Searching: <name>".
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_KEY, STATUS_REFRESH_MS, STATUS_RETRY_DELAY_MS } from '../../src/api/statusQuery.js';
import { HealthLine, Limits, near, TopBar } from '../../src/components/TopBar.js';
import { StatusView } from '../../src/views/Status.js';
import { API, budgetResponse, providersResponse, statusReport, usage } from '../fixtures.js';
import { latestRun, searchCard } from '../fixtures.searches.js';
import { serveCards } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { renderWithProviders, settled } from '../render.js';

afterEach(() => vi.useRealTimers());

const serve = (body: JsonBodyType, status = 200) =>
  server.use(http.get(`${API}/status`, () => HttpResponse.json(body, { status })));
/** A report generated 3 min 5 s before the tests' clock (15:00:00Z), as a fixed instant. */
const THREE_MIN_AGO = '2026-10-14T14:56:55.000Z';
const failing = (area: 'schedule' | 'worker' | 'app') => ({
  id: area,
  area,
  state: 'fail' as const,
  summary: 'down',
});
const warning = (area: 'consent' | 'data' | 'backups') => ({
  id: area,
  area,
  state: 'warn' as const,
  summary: 'look',
});

describe('the health line (Ruling 10)', () => {
  it('all ok says "All working" with its dot and is not a link; off checks and notes never count', async () => {
    serve(
      statusReport([
        { id: 'app', area: 'app', summary: 'up', note: 'caught up the run missed at 01:30' },
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
      ]),
    );
    renderWithProviders(<HealthLine />);
    const line = await screen.findByRole('status');
    expect(line).toHaveTextContent('All working');
    expect(line.textContent).toContain('●');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('one warning is amber "<name> needs attention · fix", naming the area when it has no label', async () => {
    serve(statusReport([warning('backups')]));
    renderWithProviders(<HealthLine />);
    const link = await screen.findByRole('link', { name: 'Backups needs attention · fix' });
    expect(link).toHaveClass('health-link-warn');
    expect(link).not.toHaveClass('health-link-bad');
    expect(link).toHaveAttribute('href', expect.stringContaining('view=status'));
  });

  it('one failure is red "<name> failing · fix"', async () => {
    serve(statusReport([failing('schedule'), { id: 'app', area: 'app', summary: 'up' }]));
    renderWithProviders(<HealthLine />);
    const link = await screen.findByRole('link', { name: 'Schedule failing · fix' });
    expect(link).toHaveClass('health-link-bad');
  });

  it('a check with a label is named by it (a search by its name), else by its area in words', async () => {
    serve(
      statusReport([{ id: 'data-1', area: 'data', label: 'Worked example', state: 'warn', summary: 'x' }]),
    );
    const first = renderWithProviders(<HealthLine />);
    expect(
      await screen.findByRole('link', { name: 'Worked example needs attention · fix' }),
    ).toBeInTheDocument();
    first.unmount();
    serve(
      statusReport([
        { id: 'provider-searchapi', area: 'provider', providerId: 'searchapi', state: 'fail', summary: 'x' },
      ]),
    );
    const second = renderWithProviders(<HealthLine />);
    expect(await screen.findByRole('link', { name: 'SearchApi failing · fix' })).toBeInTheDocument();
    second.unmount();
    // a search called like an area is named as typed, never reworded
    for (const label of ['data', 'email']) {
      serve(statusReport([{ id: 'data-9', area: 'data', label, state: 'fail', summary: 'x' }]));
      const r = renderWithProviders(<HealthLine />);
      expect(await screen.findByRole('link', { name: `${label} failing · fix` })).toBeInTheDocument();
      r.unmount();
    }
    serve(statusReport([failing('worker')]));
    renderWithProviders(<HealthLine />);
    expect(await screen.findByRole('link', { name: 'Browser provider failing · fix' })).toBeInTheDocument();
  });

  it('several problems are "N things need you · fix": red when any fails, amber when all are warnings', async () => {
    serve(statusReport([warning('consent'), failing('worker')]));
    const first = renderWithProviders(<HealthLine />);
    const red = await screen.findByRole('link', { name: '2 things need you · fix' });
    expect(red).toHaveClass('health-link-bad');
    first.unmount();
    serve(statusReport([warning('consent'), warning('data'), warning('backups')]));
    renderWithProviders(<HealthLine />);
    const amber = await screen.findByRole('link', { name: '3 things need you · fix' });
    expect(amber).toHaveClass('health-link-warn');
  });

  it('keeps a glyph beside the words, so a state differs in more than colour', async () => {
    serve(statusReport([failing('app')]));
    renderWithProviders(<HealthLine />);
    const link = await screen.findByRole('link', { name: 'App failing · fix' });
    expect(link.textContent).toContain('✕');
  });

  it('goes to the Status view when clicked', async () => {
    serve(statusReport([failing('app')]));
    const { user } = renderWithProviders(<HealthLine />);
    await user.click(await screen.findByRole('link', { name: 'App failing · fix' }));
    expect(window.location.search).toContain('view=status');
  });

  it('after a failed refresh it says the report is stale and how old, even when the old report was clean', async () => {
    serve(statusReport([{ id: 'app', area: 'app', summary: 'up' }], { generatedAt: THREE_MIN_AGO }));
    const { client } = renderWithProviders(<HealthLine />);
    expect(await screen.findByText('All working')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    serve({ error: { code: 'internal', message: 'boom' } }, 500);
    await act(async () => {
      await client.refetchQueries({ queryKey: STATUS_KEY });
    });
    expect(await screen.findByRole('link', { name: 'Status: stale, checked 3 min ago' })).toBeInTheDocument();
  });

  it('with no answer at all it says the app is not answering', async () => {
    server.use(http.get(`${API}/status`, () => HttpResponse.error()));
    renderWithProviders(<HealthLine />);
    expect(await screen.findByRole('link', { name: 'Status: app not answering' })).toBeInTheDocument();
  });

  it('tells a refused sign-in and an error answer apart from silence (V11)', async () => {
    serve({ error: { code: 'unauthenticated', message: 'authentication required' } }, 401);
    const first = renderWithProviders(<HealthLine />);
    expect(await screen.findByRole('link', { name: 'Status: sign-in refused' })).toBeInTheDocument();
    first.unmount();
    serve({ error: { code: 'internal', message: 'internal error; see the server log' } }, 500);
    renderWithProviders(<HealthLine />);
    expect(
      await screen.findByRole('link', { name: 'Status: report failed, see the app log' }),
    ).toBeInTheDocument();
  });

  it('fails fast: one retry at most, after a short delay the test steps over with fake timers', async () => {
    // why: every clock is fake and nothing advances by itself: the retry timer is stepped explicitly, and the failure is
    // awaited as the query cache's own event, never as elapsed time
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    vi.setSystemTime(Date.parse('2026-10-14T15:00:00.000Z'));
    let hits = 0;
    const waiting: Array<() => void> = [];
    const nextRequest = () => new Promise<void>((resolve) => waiting.push(resolve));
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        waiting.shift()?.();
        return HttpResponse.error();
      }),
    );
    const first = nextRequest();
    const { client } = renderWithProviders(<HealthLine />);
    const failed = new Promise<void>((resolve) => {
      const off = client.getQueryCache().subscribe((e) => {
        if (e.query.state.status === 'error') {
          off();
          resolve();
        }
      });
    });
    await act(async () => {
      await first;
    });
    // the first request has landed and failed; the one retry waits for its timer, which is stepped here
    const second = nextRequest();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAY_MS);
      await second;
      await failed;
      // the query client hands its change to React on a timer of its own (also fake): step it
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole('link', { name: 'Status: app not answering' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAY_MS * 10));
    expect(hits).toBe(2);
  });

  it('says nothing while the first answer is awaited', async () => {
    serve(statusReport([failing('app')]));
    const { client } = renderWithProviders(<HealthLine />);
    expect(screen.queryByRole('link')).toBeNull();
    // why: the request in flight must finish inside this test, or it would meet the next test's handler
    await settled(client);
  });

  it('shares one query with the view: one request serves both', async () => {
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.json(statusReport([failing('schedule')]));
      }),
    );
    renderWithProviders(
      <>
        <HealthLine />
        <StatusView />
      </>,
    );
    expect(await screen.findByRole('link', { name: 'Schedule failing · fix' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Schedule' })).toBeInTheDocument();
    expect(hits).toBe(1);
  });

  it('refreshes every 60 s: a later answer changes the line', async () => {
    // why: the clock is fixed and the refresh interval moves only when stepped (CodeRabbit CR15); timeouts stay real,
    // so Testing Library's waits run on the DOM's events as elsewhere
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: false });
    vi.setSystemTime(Date.parse('2026-10-14T15:00:00.000Z'));
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.json(statusReport(hits === 1 ? [warning('data')] : [failing('worker')]));
      }),
    );
    renderWithProviders(<HealthLine />);
    await screen.findByRole('link', { name: 'Searches needs attention · fix' });
    expect(hits).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS));
    expect(await screen.findByRole('link', { name: 'Browser provider failing · fix' })).toBeInTheDocument();
  });

  it('is part of the top bar, once', async () => {
    serve(statusReport([failing('app')]));
    renderWithProviders(<TopBar />);
    expect(await screen.findByRole('link', { name: 'App failing · fix' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'App failing · fix' })).toHaveLength(1);
  });
});

describe('the limits (Ruling 10)', () => {
  const providers = (plan: 'trial' | '40usd', enabled = true) => {
    const base = providersResponse();
    return {
      ...base,
      providers: base.providers.map((p) => (p.providerId === 'searchapi' ? { ...p, plan, enabled } : p)),
    };
  };
  const serveLimits = (
    budget: ReturnType<typeof budgetResponse>,
    p: ReturnType<typeof providers> = providers('40usd'),
  ) =>
    server.use(
      http.get(`${API}/budget`, () => HttpResponse.json(budget)),
      http.get(`${API}/providers`, () => HttpResponse.json(p)),
    );
  const bothWindows = budgetResponse({
    scopes: [
      usage('provider-month:searchapi', 49, 100),
      usage('provider-lifetime:searchapi', 9, 24),
      usage('global-month', 0, 35_000_000, 32_000_000),
    ],
  });

  const serveAccount = (account: object | null) =>
    server.use(http.get(`${API}/searchapi/account`, () => HttpResponse.json({ account })));

  it('SearchApi: its own balance, with the day a monthly plan resets', async () => {
    serveLimits(bothWindows);
    serveAccount({
      remaining: 9_988,
      monthlyAllowance: 10_000,
      periodEnd: '2026-12-01',
      fetchedAt: new Date().toISOString(),
    });
    renderWithProviders(<Limits />);
    expect(await screen.findByText('SearchApi: 9,988 credits left · resets 1 Dec')).toBeInTheDocument();
  });

  it('SearchApi: a balance read more than ten minutes ago says when', async () => {
    serveLimits(bothWindows, providers('trial'));
    // why: 2026-11-19 is a day with an eleven-minute-old read at any moment the test runs; London time is GMT in winter
    serveAccount({
      remaining: 38,
      monthlyAllowance: 0,
      periodEnd: null,
      fetchedAt: '2026-11-19T14:05:00.000Z',
    });
    renderWithProviders(<Limits />);
    expect(await screen.findByText('SearchApi: 38 credits left · as of 14:05')).toBeInTheDocument();
  });

  it('SearchApi: with no balance, this app’s count of the month on the $40 plan, says whose it is', async () => {
    serveLimits(bothWindows);
    renderWithProviders(<Limits />);
    expect(
      await screen.findByText("SearchApi: 51 of 100 credits left (this app's count)"),
    ).toBeInTheDocument();
  });

  it('SearchApi: with no balance, the trial allowance from the other window', async () => {
    serveLimits(bothWindows, providers('trial'));
    renderWithProviders(<Limits />);
    expect(
      await screen.findByText("SearchApi: 15 of 24 credits left (this app's count)"),
    ).toBeInTheDocument();
  });

  it('says nothing of SearchApi when it is not enabled', async () => {
    serveLimits(bothWindows, providers('40usd', false));
    const { client } = renderWithProviders(<Limits />);
    expect(await screen.findByText('Spent £32 of £35 this month')).toBeInTheDocument();
    await settled(client);
    expect(screen.queryByText(/SearchApi/)).toBeNull();
  });

  it('"Spent" is the month\'s call cost, never a fixed fee, and stays marked as a cost', async () => {
    serveLimits(
      budgetResponse({
        scopes: [usage('global-month', 0, 35_000_000, 3_000_000)],
        fixedFeesMicroGbp: 31_000_000,
      }),
    );
    renderWithProviders(<Limits />);
    const spent = await screen.findByText('Spent £3 of £35 this month');
    expect(spent).toHaveAttribute('data-cost');
    expect(spent).not.toHaveTextContent('near cap');
  });

  it('marks the spend near its cap by core\'s rule, and a missing cap is "Spent £x this month"', async () => {
    serveLimits(budgetResponse({ scopes: [usage('global-month', 0, 35_000_000, 32_000_000)] }));
    const first = renderWithProviders(<Limits />);
    expect(await screen.findByText('Spent £32 of £35 this month')).toHaveTextContent('near cap');
    first.unmount();
    serveLimits(budgetResponse({ scopes: [usage('global-month', 0, null, 32_000_000)] }));
    renderWithProviders(<Limits />);
    const spent = await screen.findByText('Spent £32 this month');
    expect(spent).not.toHaveTextContent('near cap');
  });

  it("near is core's 80% rule: a cap of zero or none is never near", () => {
    expect(near(80, 100)).toBe(true);
    expect(near(79, 100)).toBe(false);
    expect(near(5, 0)).toBe(false);
    expect(near(5, null)).toBe(false);
  });

  it('names a running search and links to its page; a finished or stopped one is not named', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'def-0002',
          name: 'Other search',
          latestRun: latestRun({ status: 'paused_budget' }),
        }),
        searchCard({ id: 'def-0001', name: 'Worked example', latestRun: latestRun({ status: 'running' }) }),
      ]),
    );
    renderWithProviders(<Limits />);
    const link = await screen.findByRole('link', { name: 'Searching: Worked example' });
    expect(link).toHaveAttribute('href', expect.stringContaining('view=dates'));
    expect(link).toHaveAttribute('href', expect.stringContaining('def=def-0001'));
    expect(screen.queryByText(/Other search/)).toBeNull();
  });

  it('names no search when none is running', async () => {
    server.use(serveCards([searchCard({ latestRun: latestRun({ status: 'completed' }) })]));
    const { client } = renderWithProviders(<Limits />);
    await settled(client);
    expect(screen.queryByText(/^Searching:/)).toBeNull();
  });

  it('reads results, coverage and date pairs again when the running search stops going, and not while it still runs', async () => {
    const running = searchCard({ name: 'Worked example', latestRun: latestRun({ status: 'running' }) });
    server.use(serveCards([running]));
    const { client } = renderWithProviders(<Limits />);
    await screen.findByRole('link', { name: 'Searching: Worked example' });
    const spy = vi.spyOn(client, 'invalidateQueries');
    // still going: a re-read of the cards changes nothing
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['cards'] });
    });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['results'] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['date-pairs'] });
    server.use(
      serveCards([searchCard({ name: 'Worked example', latestRun: latestRun({ status: 'completed' }) })]),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['cards'] });
    });
    await waitFor(() => expect(screen.queryByText(/^Searching:/)).toBeNull());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['results'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['coverage'] });
    // why: CodeRabbit CR36: a run the search's page does not track (started elsewhere) still refreshes its date pairs
    expect(spy).toHaveBeenCalledWith({ queryKey: ['date-pairs'] });
    expect(screen.queryByText(/^Searching:/)).toBeNull();
  });
});
