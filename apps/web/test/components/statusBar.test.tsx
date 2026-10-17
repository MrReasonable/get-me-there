import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../src/api/queries.js';
import { near, StatusBar } from '../../src/components/StatusBar.js';
import { ViewHeader } from '../../src/components/ViewHeader.js';
import {
  API,
  coverageResponse,
  definition,
  execution,
  resultsResponse,
  summary,
  usage,
} from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders, settled } from '../render.js';
import { setViewportWidth } from '../viewport.js';

const bar = (over: Parameters<typeof definition>[0] = {}, showRunNow = true) => (
  <StatusBar definition={definition(over)} showRunNow={showRunNow} />
);

afterEach(() => vi.useRealTimers());

describe('status bar (spec §11)', () => {
  it('one honest progress line per stage × provider: the six buckets, never an "attempted" umbrella (ruling 4)', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    expect(await screen.findByText('running')).toBeInTheDocument();
    const lines = screen.getAllByRole('progressbar');
    expect(lines.map((l) => l.textContent)).toEqual([
      'discovery · Travelpayouts: 60 priced · 10 no fares · 40 no cached data · 6 error · 0 skipped · 10 not searched of 126 cells',
      'itinerary search · SearchApi: 0 priced · 0 no fares · 0 no cached data · 0 error of 10 selected · 116 skipped · 10 not searched',
    ]);
    // why: screen readers announce a progressbar's value text, not its child text, so the unsearched count must be in it.
    expect(lines.map((l) => l.getAttribute('aria-valuetext'))).toEqual(lines.map((l) => l.textContent));
    // why: the itinerary-search line counts against the selected cells (spec §3), from the results response.
    expect(lines.map((l) => [l.getAttribute('aria-valuenow'), l.getAttribute('aria-valuemax')])).toEqual([
      ['116', '126'],
      ['0', '10'],
    ]);
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

  it('paused: shows the reason and when it resumes, and Resume posts /resume', async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () =>
        HttpResponse.json(
          execution({
            status: 'paused_budget',
            reason: 'searchapi provider-month cap reached',
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
    expect(
      await screen.findByText(
        'Paused: searchapi provider-month cap reached · resumes 1 Nov 2026 00:00 Europe/London',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
  });

  it('an interrupted run offers Resume as well as Cancel, and no Run now (spec §7; derived from core)', async () => {
    let resumed = 0;
    server.use(
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'interrupted' }))),
      http.post(`${API}/executions/:id/resume`, () => {
        resumed += 1;
        return HttpResponse.json(execution());
      }),
    );
    const { user } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    await expect.poll(() => resumed).toBe(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
  });

  it('a running run offers no Resume', async () => {
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    renderWithProviders(bar());
    await screen.findByText('running');
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
    expect(await screen.findByText('running')).toBeInTheDocument();
  });

  it('Run now shows a working state and cannot be double-tapped (UI-2)', async () => {
    let posts = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ executions: [] })),
      ),
      http.post(`${API}/definitions/:id/executions`, async () => {
        posts += 1;
        await gate;
        return HttpResponse.json({ executionId: 'exec-0002' });
      }),
    );
    const { user, client } = renderWithProviders(bar());
    await user.click(await screen.findByRole('button', { name: /Run now/ }));
    const working = await screen.findByRole('button', { name: 'Working…' });
    expect(working).toBeDisabled();
    expect(working).toHaveAttribute('aria-busy', 'true');
    await user.click(working);
    release();
    // why: wait until the mutation and every refetch it caused settled, so a late second POST would be counted.
    await settled(client);
    expect(posts).toBe(1);
  });

  it('at 375px the numbers of a finished run fold into one disclosure; an active run keeps them open (UI-14, UI-006)', async () => {
    setViewportWidth(375);
    server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution())));
    const first = renderWithProviders(bar());
    await screen.findByText('running');
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

  it('no run yet: Run now names its worst case and posts the stored confirmation', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [], total: 0, executions: [], cheapest: null })),
      ),
      http.post(`${API}/definitions/:id/executions`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ executionId: 'exec-0002' });
      }),
    );
    const { user } = renderWithProviders(bar({ confirmedCostPence: 0 }));
    expect(await screen.findByText('No run yet for this definition.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run now: about 154 calls, hard stop 2000 · £0' }));
    // why: decision 43: the stored confirmation covers a run only with both its pence and its calls.
    await expect.poll(() => bodies).toEqual([{ confirmCostPence: 0, confirmCalls: 154 }]);
  });

  it('Run now is disabled while the estimate is above the confirmation, and absent where the view does not offer it', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [], executions: [], cheapest: null })),
      ),
    );
    const { unmount } = renderWithProviders(
      bar({
        needsConfirmation: {
          estimateMicroGbp: 2_500_000,
          totalCalls: 300,
          confirmedCostPence: 100,
          confirmedCalls: 154,
        },
      }),
    );
    expect(await screen.findByRole('button', { name: /Run now/ })).toBeDisabled();
    expect(
      screen.getByText(
        'The estimate is above what you confirmed; confirm it under Definitions before running.',
      ),
    ).toBeInTheDocument();
    unmount();
    renderWithProviders(bar({}, false));
    await screen.findByText('No run yet for this definition.');
    expect(screen.queryByRole('button', { name: /Run now/ })).toBeNull();
  });

  it.each<[number, number | null, boolean]>([
    [79, 100, false],
    [80, 100, true],
    [1, 0, true],
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
        return HttpResponse.json(execution({ status: 'paused_budget', reason: 'cap' }));
      }),
    );
    renderWithProviders(bar());
    expect(await screen.findByText('itinerary search for one cell: running')).toBeInTheDocument();
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
    await screen.findByText('running');
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
    expect(screen.getByText('No run yet for this definition.')).toBeInTheDocument();
  });
});
