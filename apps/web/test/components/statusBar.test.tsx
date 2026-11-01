import { NO_STOP_CAUSE_TEXT } from '@gmt/core';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../src/api/queries.js';
import { near, StatusBar } from '../../src/components/StatusBar.js';
import { ViewHeader } from '../../src/components/ViewHeader.js';
import { COPY } from '../../src/copy.js';
import {
  API,
  coverageResponse,
  definition,
  execution,
  resultsResponse,
  statusReport,
  summary,
  usage,
} from '../fixtures.js';
import { latestRun, searchCard } from '../fixtures.searches.js';
import { serveCards } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { renderWithProviders, settled } from '../render.js';
import { setViewportWidth } from '../viewport.js';

const bar = (over: Parameters<typeof definition>[0] = {}) => <StatusBar definition={definition(over)} />;

/** A stop whose fix names Resume (core's "Raise the limit in Edit, then Resume"): the bar then offers Resume. */
const RESUME_STOP = {
  sentence: "Stopped at 1 Nov 2026 00:00: SearchApi's monthly limit was reached.",
  fix: { text: 'Raise the limit in Edit, then Resume', command: null, resume: true as const },
};

afterEach(() => vi.useRealTimers());

describe('status bar (spec §11)', () => {
  it('one honest progress line per stage × provider: the six buckets, never an "attempted" umbrella (ruling 4)', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    expect(await screen.findByText('Searching')).toBeInTheDocument();
    const lines = screen.getAllByRole('progressbar');
    // why: spec rev 55 §3, §11 — a stage and a source in main-path words, the five marks in the count and the six
    // buckets under it (the coverage section's own terms)
    expect(lines.map((l) => l.getAttribute('aria-valuetext'))).toEqual([
      "the first pass across your dates · the Aviasales cache: 60 priced · 50 no price shown · 6 couldn't be read · 0 not reached · 10 not searched of 126 date and airport pairs",
      "checking fares · Google Flights via SearchApi: 0 priced · 0 no price shown · 0 couldn't be read of 10 chosen · 116 not reached · 10 not searched",
    ]);
    expect(lines.map((l) => l.textContent)).toEqual([
      "the first pass across your dates · the Aviasales cache: 60 priced · 50 no price shown · 6 couldn't be read · 0 not reached · 10 not searched of 126 date and airport pairs60 priced · 10 no fares · 40 no cached data · 6 error · 0 skipped · 10 not searched",
      "checking fares · Google Flights via SearchApi: 0 priced · 0 no price shown · 0 couldn't be read of 10 chosen · 116 not reached · 10 not searched0 priced · 0 no fares · 0 no cached data · 0 error · 116 skipped · 10 not searched",
    ]);
    // why: screen readers announce a progressbar's value text, not its child text, so the unsearched count must be in it.
    // why: the itinerary-search line counts against the selected cells (spec §3), from the results response.
    expect(lines.map((l) => [l.getAttribute('aria-valuenow'), l.getAttribute('aria-valuemax')])).toEqual([
      ['116', '126'],
      ['0', '10'],
    ]);
  });

  it("the progress breakdown links to the Dates view's coverage section, keeping the other parameters (WP19 Task 19.7)", async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    const { user } = renderWithProviders(bar(), {
      search: '?view=results&def=def-0001&d.to=JFK&depart=2027-03-14&return=2027-03-28&row=x',
    });
    const link = await screen.findByRole('link', { name: COPY.progressCoverageLink });
    expect(link).toHaveAttribute('href', '/?view=dates&def=def-0001&d.to=JFK&d.coverage=open');
    await user.click(link);
    expect(window.location.search).toBe('?view=dates&def=def-0001&d.to=JFK&d.coverage=open');
  });

  // why: ruling R-bar — on a view that shows another search (or none), the bar follows any search's run; its coverage
  // link must open that run's own search, never the URL's def= (coverage honesty: one search's coverage read as another's)
  it.each([
    ['Providers, with no search in the URL', '?view=providers'],
    ['History, naming another search and its filter', '?view=history&def=def-0001&d.to=JFK'],
  ])("on %s, the coverage link opens the shown run's own search, unfiltered", async (_name, search) => {
    server.use(
      serveCards([
        searchCard({
          id: 'def-0002',
          name: 'Another search',
          latestRun: latestRun({ id: 'exec-0001', status: 'running', finishedAt: null }),
        }),
      ]),
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
    );
    renderWithProviders(<StatusBar definition={null} />, { search });
    const link = await screen.findByRole('link', { name: COPY.progressCoverageLink });
    const href = new URLSearchParams(link.getAttribute('href')?.replace(/^\/\?/, '') ?? '');
    expect(href.get('view')).toBe('dates');
    expect(href.get('def')).toBe('def-0002');
    expect(href.get('d.coverage')).toBe('open');
    // another search's airport filter never scopes this one's coverage
    expect(href.get('d.to')).toBeNull();
  });

  it('shows spend used / cap for the run, the month and each provider-month call cap, marking a cap that is near', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    expect(await screen.findByText('this run: 42 of 2000 billed calls')).toBeInTheDocument();
    expect(screen.getByText('this run: 14 of 2000 free calls')).toBeInTheDocument();
    expect(screen.getByText('this month: SearchApi 615 of 10000 calls')).toBeInTheDocument();
    const month = screen.getByText('this month: £32 of £35');
    expect(month).toHaveTextContent('near cap');
    expect(screen.getByText('this month: SearchApi 615 of 10000 calls')).not.toHaveTextContent('near cap');
  });

  it('Cancel asks once more, then posts to /executions/:id/cancel with the CSRF header', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
      http.post(`${API}/executions/:id/cancel`, ({ request, params }) => {
        seen.push(`${String(params.id)} ${request.headers.get('x-requested-with')}`);
        return HttpResponse.json(execution({ status: 'cancelled' }));
      }),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(seen).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    await expect.poll(() => seen).toEqual(['exec-0001 get-me-there']);
  });

  it('a confirmation opened for one run cannot cancel a newer run that replaced it (cancel bound to the selected run)', async () => {
    const cancelled: string[] = [];
    let newest = 'exec-0001';
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: [summary({ id: newest, status: 'running' })] })),
      ),
      http.get(`${API}/executions/:id`, ({ params }) =>
        HttpResponse.json(execution({ id: String(params.id) })),
      ),
      http.post(`${API}/executions/:id/cancel`, ({ params }) => {
        cancelled.push(String(params.id));
        return HttpResponse.json(execution({ id: String(params.id), status: 'cancelled' }));
      }),
    );
    const { user, client } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Confirm: cancel this run' })).toBeInTheDocument();
    // why: a newer run starts while the confirmation is open; the bar now follows that run.
    newest = 'exec-0002';
    await client.invalidateQueries({ queryKey: ['results'] });
    // the open confirmation was for exec-0001, so it is gone and Cancel must be asked for again
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm: cancel this run' })).toBeNull();
    expect(cancelled).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    await expect.poll(() => cancelled).toEqual(['exec-0002']);
  });

  it('returning to a run whose confirmation was abandoned does not bring the old confirmation back', async () => {
    let newest = 'exec-0001';
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: [summary({ id: newest, status: 'running' })] })),
      ),
      http.get(`${API}/executions/:id`, ({ params }) =>
        HttpResponse.json(execution({ id: String(params.id) })),
      ),
    );
    const { user, client } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    newest = 'exec-0002';
    await client.invalidateQueries({ queryKey: ['results'] });
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    newest = 'exec-0001';
    await client.invalidateQueries({ queryKey: ['results'] });
    // why: back on the first run, Cancel must be asked for again; the earlier confirmation was abandoned
    await settled(client);
    expect(screen.queryByRole('button', { name: 'Confirm: cancel this run' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a failed action is announced (cancel answered 409)', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
      http.post(`${API}/executions/:id/cancel`, () =>
        HttpResponse.json(
          { error: { code: 'conflict', message: 'execution already finished' } },
          { status: 409 },
        ),
      ),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Confirm: cancel this run' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That did not work: execution already finished',
    );
  });

  it("a stopped run: the stop's sentence as-is, its fix, when it resumes, and Resume (the fix names it) posts /resume", async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'paused_budget',
            stop: RESUME_STOP,
            resumeAfter: '2026-11-01T00:00:00.000Z',
          }),
        ),
      ),
      http.post(`${API}/executions/:id/resume`, () => {
        resumed += 1;
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(bar());
    expect(await screen.findByText(RESUME_STOP.sentence)).toBeInTheDocument();
    expect(screen.getByText(RESUME_STOP.fix.text)).toBeInTheDocument();
    expect(screen.getByText(/resumes 1 Nov 2026 00:00 Europe\/London/)).toBeInTheDocument();
    // why: no prefix of ours: the sentence is whole (spec rev 55 §8.1)
    expect(screen.queryByText(/^Paused:/)).toBeNull();
    expect(screen.getByText('stopped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
  });

  it('an interrupted run offers Resume as well as Cancel (spec §7; derived from core)', async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ status: 'interrupted', stop: RESUME_STOP })),
      ),
      http.post(`${API}/executions/:id/resume`, () => {
        resumed += 1;
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it.each<[string, 'running' | 'pending']>([
    ['running', 'running'],
    ['pending', 'pending'],
  ])('a %s run reads "Searching", the card’s words, never the stored status word', async (_n, status) => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status }))));
    renderWithProviders(bar());
    await screen.findByText('Searching');
    const text = screen.getByRole('region', { name: COPY.statusBarLabel }).textContent ?? '';
    expect(text).not.toMatch(/\b(running|pending)\b/);
  });

  it('a running run offers no Resume', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    await screen.findByText('Searching');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('a failed results query shows the reason and a retry instead of loading forever (UI-6)', async () => {
    let ok = false;
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        ok
          ? HttpResponse.json(resultsResponse())
          : HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
    );
    const { user } = renderWithProviders(bar());
    expect(await screen.findByRole('alert')).toHaveTextContent('db is down');
    expect(screen.queryByText('Loading…')).toBeNull();
    ok = true;
    await user.click(screen.getByRole('button', { name: /Try again|Retry/ }));
    expect(await screen.findByText('Searching')).toBeInTheDocument();
  });

  it('at 375px the numbers of a finished run fold into one disclosure; an active run keeps them open (UI-14, UI-006)', async () => {
    setViewportWidth(375);
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    const first = renderWithProviders(bar());
    await screen.findByText('Searching');
    // why: ruling 15: spend against the cap is never folded away while it can still grow.
    expect(screen.getByText('Progress and spend').closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    first.unmount();
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'completed' }))),
    );
    renderWithProviders(bar());
    await screen.findByText('completed');
    expect(screen.getByText('Progress and spend').closest('details')).not.toHaveAttribute('open');
  });

  it('shows "schedule blocked since <date>" from coverage.scheduleBlockedSince', async () => {
    server.use(
      http.get(`${API}/definitions/:id/coverage`, () =>
        HttpResponse.json(coverageResponse({ scheduleBlockedSince: '2026-10-12T05:00:00.000Z' })),
      ),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('schedule blocked since 12 Oct 2026')).toBeInTheDocument();
  });

  // WP20 Task 20.3 (spec rev 55 §8.1, §11; ruling A11): Run now is gone from the bar, and a stopped run reads as its stop
  it.each<[string, Parameters<typeof execution>[0], Parameters<typeof resultsResponse>[0]]>([
    ['never run', {}, { rows: [], total: 0, executions: [], cheapest: null }],
    ['completed', { status: 'completed' }, {}],
    ['stopped', { status: 'paused_budget', stop: RESUME_STOP }, {}],
  ])(
    'no "Run now" button on a search that is %s, whatever the estimate (ruling A11)',
    async (_name, run, results) => {
      server.use(
        http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(resultsResponse(results))),
        http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(run))),
      );
      renderWithProviders(
        bar({
          needsConfirmation: {
            estimateMicroGbp: 2_500_000,
            totalCalls: 300,
            confirmedCostPence: 100,
            confirmedCalls: 154,
          },
        }),
      );
      await screen.findByRole('region', { name: COPY.statusBarLabel });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
      expect(screen.queryByText(/confirm it under Searches/)).toBeNull();
    },
  );

  it.each<[string, Parameters<typeof execution>[0]]>([
    ['the api’s NO_STOP_CAUSE_TEXT', { status: 'paused_error', stop: NO_STOP_CAUSE_TEXT }],
    ['a read that carried no stop at all', { status: 'paused_error', stop: null }],
  ])(
    'a stopped run with no stored cause (a row from before migration 0011), as %s, reads NO_STOP_CAUSE_TEXT: its sentence and fix, never "paused: error" or "Stopped: Stopped", and no Resume (Review Focus 4)',
    async (_name, run) => {
      server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(run))));
      renderWithProviders(bar());
      expect(await screen.findByText(NO_STOP_CAUSE_TEXT.sentence)).toBeInTheDocument();
      expect(screen.getByText(NO_STOP_CAUSE_TEXT.fix?.text ?? '')).toBeInTheDocument();
      const text = screen.getByRole('region', { name: COPY.statusBarLabel }).textContent ?? '';
      expect(text).not.toContain('paused: error');
      expect(text).not.toContain('Stopped: Stopped');
      expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    },
  );

  it('a browser page limit’s fix is a fresh search: the structured flag, not the words, hides Resume (finding 10)', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'paused_budget',
            stop: {
              sentence: "Stopped: the browser worker's monthly page limit was reached.",
              // why: the words even mention Resume; only the missing flag decides
              fix: { text: 'Search again to carry on (not Resume)', command: null },
            },
          }),
        ),
      ),
    );
    renderWithProviders(bar());
    await screen.findByText("Stopped: the browser worker's monthly page limit was reached.");
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('a native fix command shows as code', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'paused_error',
            stop: {
              sentence: 'The browser worker is not running.',
              fix: { text: 'Start it, then Search again', command: 'pnpm gmt start' },
            },
          }),
        ),
      ),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('The browser worker is not running.')).toBeInTheDocument();
    expect(screen.getByText('pnpm gmt start').tagName).toBe('CODE');
  });

  it('the failing count still links to Status', async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([{ id: 'schedule', area: 'schedule', state: 'fail', summary: 'down' }]),
        ),
      ),
    );
    renderWithProviders(bar());
    expect(await screen.findByRole('link', { name: 'Status: schedule failing' })).toHaveAttribute(
      'href',
      '/?view=status',
    );
  });

  it('the child-run line speaks in main-path words, even for a stopped child (finding 4)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(
          resultsResponse({
            executions: [
              summary({ id: 'exec-child-1', isChild: true, status: 'paused_error' }),
              summary({ id: 'exec-0001', status: 'running' }),
            ],
          }),
        ),
      ),
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('checking fares for one date pair: stopped')).toBeInTheDocument();
    const text = screen.getByRole('region', { name: COPY.statusBarLabel }).textContent ?? '';
    expect(text).not.toContain('paused: error');
    expect(text).not.toContain('itinerary search for one cell');
  });

  it('always shows the month’s spend, from /budget, whether or not a run is shown (ruling R-bar)', async () => {
    renderWithProviders(<StatusBar definition={null} />);
    const month = await screen.findByRole('region', { name: COPY.monthSpendLabel });
    expect(month).toHaveTextContent('this month: £32 of £35');
    expect(screen.queryByRole('region', { name: COPY.statusBarLabel })).toBeNull();
  });

  it.each<[number, number | null, boolean]>([
    [79, 100, false],
    [80, 100, true],
    [1, 0, false],
    [0, 0, false],
    [5, null, false],
  ])('near cap: %i used of %s is %s (review tsr2-013)', (used, cap, expected) => {
    expect(near(used, cap)).toBe(expected);
  });

  it("a trial plan shows SearchApi's lifetime window, worded as Providers words it, and marks it near cap (ruling 2, F2)", async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            budget: [
              usage('provider-lifetime:searchapi', 20, 24),
              usage(
                'provider-month:travelpayouts',
                2,
                50000,
                0,
                '2026-10-01T00:00:00.000Z',
                '2026-11-01T00:00:00.000Z',
              ),
            ],
          }),
        ),
      ),
    );
    renderWithProviders(bar());
    const line = await screen.findByText("SearchApi 20 of 24 calls over the plan's lifetime");
    expect(line).toHaveTextContent('near cap');
    expect(screen.getByText('this month: Travelpayouts 2 of 50000 calls')).not.toHaveTextContent('near cap');
    expect(screen.queryByText(/no cap/)).toBeNull();
  });

  it('a null cap reads "no cap" and is never marked near', async () => {
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(execution({ budget: [usage('execution-calls', 5, null)] })),
      ),
    );
    renderWithProviders(bar());
    const line = await screen.findByText('this run: 5 of no cap billed calls');
    expect(line).not.toHaveTextContent('near cap');
  });

  it('follows the newest parent run; an active one-cell child is its own line (review po-009)', async () => {
    const ids: string[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(
          resultsResponse({
            executions: [
              summary({ id: 'exec-child-1', isChild: true, status: 'running' }),
              summary({ id: 'exec-0001', status: 'paused_budget' }),
            ],
          }),
        ),
      ),
      http.get(`${API}/executions/:id`, ({ params }) => {
        ids.push(String(params.id));
        return HttpResponse.json(execution({ status: 'paused_budget', stop: RESUME_STOP }));
      }),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('checking fares for one date pair: Searching')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(ids).toEqual(['exec-0001']);
  });

  it('polls a running run every POLL_MS, refetches results when it completes, then stops polling', async () => {
    // why: fake the clear functions too, or TanStack's cleared interval keeps firing on the real clock.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let status: 'running' | 'completed' = 'running';
    const hits = { execution: 0, results: 0 };
    server.use(
      http.get(`${API}/executions/:id`, () => {
        hits.execution += 1;
        return HttpResponse.json(execution({ status }));
      }),
      http.get(`${API}/definitions/:id/results`, () => {
        hits.results += 1;
        return HttpResponse.json(resultsResponse());
      }),
    );
    renderWithProviders(bar());
    await screen.findByText('Searching');
    expect([hits.execution, hits.results]).toEqual([1, 1]);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await expect.poll(() => hits.execution).toBe(2);
    status = 'completed';
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await screen.findByText('completed');
    await expect.poll(() => hits.results).toBe(2);
    const settled = hits.execution;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(hits.execution).toBe(settled);
  });
});

describe('view header (spec §11)', () => {
  it('names the runs by start time with status and age, unknown ages included, and banners a parent run not completed', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale
        executions={[
          summary({ status: 'running', ageHours: 0, finishedAt: null }),
          summary({ id: 'exec-0000', startedAt: '2026-10-07T12:00:00.000Z', ageHours: 'unknown' }),
        ]}
      />,
    );
    expect(
      screen.getByText(
        'showing run started 14 Oct 2026 13:00 Europe/London (running, just now), run started 7 Oct 2026 13:00 Europe/London (completed, age unknown)',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The latest run is running; these results may be partial.',
    );
    expect(screen.getByText('stale')).toBeInTheDocument();
  });

  it('no banner when the latest parent run completed, whatever a child run is doing', () => {
    renderWithProviders(
      <ViewHeader
        title="Results"
        stale={false}
        executions={[summary({ id: 'c1', isChild: true, status: 'pending', startedAt: null }), summary()]}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    // why: a run with no start has no age to give (review prov-r2-011).
    expect(
      screen.getByText(/itinerary search for one cell, not started yet \(pending\), run started/),
    ).toBeInTheDocument();
  });

  it('a missed firing recorded as skipped names the firing it stands for and the reason recorded with it (R17)', () => {
    renderWithProviders(
      <ViewHeader
        title="History"
        stale={false}
        variant="span"
        executions={[
          summary({
            id: 'skip',
            status: 'skipped_missed',
            startedAt: null,
            finishedAt: null,
            scheduledFor: '2026-10-19T04:00:00.000Z',
            skipCode: 'half-cadence',
          }),
          summary({
            id: 'old-skip',
            status: 'skipped_missed',
            startedAt: null,
            finishedAt: null,
            scheduledFor: null,
            skipCode: null,
          }),
        ]}
      />,
    );
    expect(
      screen.getByText(
        'showing run scheduled for 19 Oct 2026 05:00 Europe/London (skipped: missed and not caught up: the next scheduled run was less than half the gap away), run not started yet (skipped: missed and not caught up)',
      ),
    ).toBeInTheDocument();
  });

  it('the cross-execution variant states that no single run status applies, with no banner (decision 38)', () => {
    renderWithProviders(
      <ViewHeader
        title="History"
        stale={false}
        variant="span"
        executions={[summary({ status: 'running' }), summary({ id: 'e0' })]}
      />,
    );
    expect(screen.getByText('across 2 runs; no single run status applies')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('no run yet', () => {
    renderWithProviders(<ViewHeader title="Results" stale={false} executions={[]} />);
    expect(screen.getByText('No run yet for this search.')).toBeInTheDocument();
  });
});
