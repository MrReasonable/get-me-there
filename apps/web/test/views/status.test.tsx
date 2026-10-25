// Spec §11 Status (brief WP18 Task 18.6): one card per check of GET /status, grouped by area, worst first. The worked
// example only.
import { findBannedWords } from '@gmt/core';
import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_KEY, STATUS_REFRESH_MS } from '../../src/api/statusQuery.js';
import { COPY } from '../../src/copy.js';
import { StatusView } from '../../src/views/Status.js';
import { API, statusReport } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const serve = (body: JsonBodyType, status = 200) =>
  server.use(http.get(`${API}/status`, () => HttpResponse.json(body, { status })));
const ago = (seconds: number) =>
  new Date(Date.parse('2026-10-14T15:00:00.000Z') - seconds * 1000).toISOString();
const card = (name: string) => screen.getByRole('region', { name });

describe('the Status view: states (spec §11)', () => {
  it('says it is loading, then shows the report', async () => {
    serve(statusReport([{ id: 'app', area: 'app', summary: 'version abc1234' }]));
    renderWithProviders(<StatusView />);
    expect(screen.getByRole('status')).toHaveTextContent(COPY.loading);
    expect(await screen.findByRole('heading', { name: COPY.statusView.heading })).toBeInTheDocument();
    expect(card('App')).toHaveTextContent('ok version abc1234');
  });

  it('an empty report shows the heading and its age and no card', async () => {
    serve(statusReport([], { generatedAt: ago(40) }));
    renderWithProviders(<StatusView />);
    expect(await screen.findByText('checked 40 s ago')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toEqual([]);
  });

  it('with no report the view says the app is not answering, and Try again loads it', async () => {
    serve({ error: { code: 'internal', message: 'boom' } }, 500);
    const { user } = renderWithProviders(<StatusView />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.statusView.notAnswering);
    serve(statusReport([{ id: 'app', area: 'app', summary: 'back again' }]));
    await user.click(within(alert).getByRole('button', { name: COPY.retryLoad }));
    expect(await screen.findByText(/back again/)).toBeInTheDocument();
  });

  it('"checked N s ago" and "N min ago" come from the report generatedAt', async () => {
    serve(statusReport([{}], { generatedAt: ago(185) }));
    renderWithProviders(<StatusView />);
    expect(await screen.findByText('checked 3 min ago')).toBeInTheDocument();
  });

  it('a failed refresh keeps the last report, marked stale with its age', async () => {
    serve(statusReport([{ id: 'app', area: 'app', summary: 'kept report' }], { generatedAt: ago(185) }));
    const { client } = renderWithProviders(<StatusView />);
    await screen.findByText(/kept report/);
    serve({ error: { code: 'internal', message: 'boom' } }, 500);
    await act(async () => {
      await client.refetchQueries({ queryKey: STATUS_KEY });
    });
    expect(await screen.findByText('stale, checked 3 min ago')).toBeInTheDocument();
    expect(screen.getByText(/kept report/)).toBeInTheDocument();
  });

  it('refreshes every 60 s, redraws its age while it waits, and a later answer replaces the report', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.json(
          statusReport([{ id: 'app', area: 'app', summary: `answer ${hits}` }], { generatedAt: ago(0) }),
        );
      }),
    );
    renderWithProviders(<StatusView />);
    await screen.findByText(/answer 1/);
    await act(() => vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS));
    expect(await screen.findByText(/answer 2/)).toBeInTheDocument();
  });
});

describe('the Status view: cards (spec §11)', () => {
  const report = () =>
    statusReport([
      {
        id: 'app',
        area: 'app',
        state: 'ok',
        summary: 'version abc1234',
        note: 'caught up the run missed at 01:30',
      },
      {
        id: 'schedule',
        area: 'schedule',
        state: 'fail',
        summary: 'schedule blocked since 2026-10-12',
        fix: { text: 'restart the app', command: 'pnpm gmt restart' },
      },
      {
        id: 'data-1',
        area: 'data',
        state: 'warn',
        summary: 'London to New York: last run 2026-10-14: priced 90 of 100 cells',
        fix: { text: 'start a run for newer prices', command: null },
      },
      {
        id: 'provider-travelpayouts',
        area: 'provider',
        providerId: 'travelpayouts',
        state: 'ok',
        summary: 'Travelpayouts: configured; not used yet; this month: 120 of 50000 calls',
      },
    ]);

  it('groups by area, worst first, each card a labelled region with the state as text before the summary', async () => {
    serve(report());
    renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    const order = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(order).toEqual(['Schedule', 'Data', 'App', 'Provider']);
    expect(card('Schedule').textContent?.startsWith('failing schedule blocked since 2026-10-12')).toBe(true);
    expect(card('Data').textContent?.startsWith('to check London to New York')).toBe(true);
    expect(card('Provider, Travelpayouts').textContent?.startsWith('ok Travelpayouts')).toBe(true);
  });

  it('a card that is not ok shows its fix; an ok card shows a note but no fix', async () => {
    serve(report());
    renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    expect(card('Schedule')).toHaveTextContent('Fix: restart the app');
    expect(card('Data')).toHaveTextContent('Fix: start a run for newer prices');
    expect(within(card('Data')).queryByRole('button')).toBeNull();
    expect(card('App')).toHaveTextContent('Note: caught up the run missed at 01:30');
    expect(card('App')).not.toHaveTextContent('Fix:');
  });

  it('a provider card links to the Providers view', async () => {
    serve(report());
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Provider, Travelpayouts' });
    const link = within(card('Provider, Travelpayouts')).getByRole('link', {
      name: COPY.statusView.providersLink,
    });
    expect(link).toHaveAttribute('href', expect.stringContaining('view=providers'));
    await user.click(link);
    expect(window.location.search).toContain('view=providers');
    expect(within(card('Schedule')).queryByRole('link')).toBeNull();
  });

  it('copies exactly the command and says "Copied"', async () => {
    serve(report());
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(
      within(card('Schedule')).getByRole('button', { name: COPY.statusView.copyCommand('pnpm gmt restart') }),
    );
    expect(write).toHaveBeenCalledExactlyOnceWith('pnpm gmt restart');
    expect(await within(card('Schedule')).findByText(COPY.statusView.copied)).toBeInTheDocument();
  });

  it.each([
    [
      'unavailable',
      () => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }),
    ],
    [
      'refusing',
      () =>
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: () => Promise.reject(new Error('not allowed')) },
          configurable: true,
        }),
    ],
  ])('with the clipboard %s the command is shown selected instead', async (_n, break_) => {
    serve(report());
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    break_();
    await user.click(
      within(card('Schedule')).getByRole('button', { name: COPY.statusView.copyCommand('pnpm gmt restart') }),
    );
    const field = await within(card('Schedule')).findByRole('textbox');
    expect(field).toHaveValue('pnpm gmt restart');
    expect(field).toHaveFocus();
    expect(field).toHaveProperty('selectionStart', 0);
    expect(field).toHaveProperty('selectionEnd', 'pnpm gmt restart'.length);
    expect(within(card('Schedule')).queryByText(COPY.statusView.copied)).toBeNull();
  });

  it('folds off checks into one line per reason, naming each; the container backups card keeps its own', async () => {
    serve(
      statusReport([
        {
          id: 'provider-searchapi',
          area: 'provider',
          providerId: 'searchapi',
          state: 'off',
          offReason: 'not-set-up',
          summary: 'SearchApi is not set up',
        },
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
        {
          id: 'worker',
          area: 'worker',
          providerId: 'camoufox',
          state: 'off',
          offReason: 'awaiting-verification',
          summary: 'awaiting verification for this build: browser flags are unset',
        },
        {
          id: 'consent',
          area: 'consent',
          state: 'off',
          offReason: 'not-set-up',
          summary: 'browser provider not enabled',
        },
        {
          id: 'backups',
          area: 'backups',
          state: 'off',
          offReason: 'not-visible',
          summary: "not visible from the container: check your host's backup job (docs/setup.md section 6)",
        },
      ]),
    );
    renderWithProviders(<StatusView />);
    expect(await screen.findByText('not set up: SearchApi, email')).toBeInTheDocument();
    expect(screen.getByText('awaiting verification for this build: browser provider')).toBeInTheDocument();
    expect(card('Backups')).toHaveTextContent("not visible from the container: check your host's backup job");
    expect(screen.queryByRole('region', { name: 'Email' })).toBeNull();
    expect(screen.queryByText(/SearchApi is not set up/)).toBeNull();
  });
});

describe('the email card: Send test (spec §11)', () => {
  const email = () =>
    statusReport([
      { id: 'email', area: 'email', state: 'ok', summary: 'configured; no test send since the app started' },
      { id: 'app', area: 'app', summary: 'up' },
    ]);
  const post = (status: number, body: JsonBodyType) =>
    server.use(http.post(`${API}/alerts/test-email`, () => HttpResponse.json(body, { status })));

  it('is only on the email card', async () => {
    serve(email());
    renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Email' });
    expect(screen.getAllByRole('button', { name: COPY.statusView.sendTest })).toHaveLength(1);
    expect(within(card('App')).queryByRole('button')).toBeNull();
  });

  it('is disabled while sending and shows a message for each outcome', async () => {
    serve(email());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/alerts/test-email`, async () => {
        await gate;
        return HttpResponse.json({ result: 'sent', at: '2026-10-14T15:00:00.000Z' });
      }),
    );
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Email' });
    await user.click(screen.getByRole('button', { name: COPY.statusView.sendTest }));
    const busy = await screen.findByRole('button', { name: COPY.statusView.sending });
    expect(busy).toBeDisabled();
    release();
    expect(await screen.findByText(COPY.statusView.testSent)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.statusView.sendTest })).toBeEnabled();
  });

  it.each([
    [
      'not configured (409)',
      409,
      { error: { code: 'email_not_configured', message: 'email is not set up' } },
      COPY.statusView.testNotConfigured,
    ],
    [
      'the hourly limit (429)',
      429,
      { error: { code: 'email_limit', message: 'the hourly email limit (20) is reached; try again later' } },
      COPY.statusView.testLimit,
    ],
    ['a failed send', 200, { result: 'failed', at: '2026-10-14T15:00:00.000Z' }, COPY.statusView.testFailed],
  ])('says so for %s', async (_n, status, body, words) => {
    serve(email());
    post(status, body);
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Email' });
    await user.click(screen.getByRole('button', { name: COPY.statusView.sendTest }));
    expect(await screen.findByText(words)).toBeInTheDocument();
  });

  it('another failure says the request failed', async () => {
    serve(email());
    post(500, { error: { code: 'internal', message: 'internal error; see the server log' } });
    const { user } = renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Email' });
    await user.click(screen.getByRole('button', { name: COPY.statusView.sendTest }));
    expect(
      await screen.findByText(COPY.statusView.testFailedCall('internal error; see the server log')),
    ).toBeInTheDocument();
  });

  it('an email that is off has no card and so no button', async () => {
    serve(
      statusReport([
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
      ]),
    );
    renderWithProviders(<StatusView />);
    expect(await screen.findByText('not set up: email')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.statusView.sendTest })).toBeNull();
  });
});

describe('the Status view: words and size', () => {
  it('uses no banned word anywhere on the page, state words and fixes included', async () => {
    serve(
      statusReport([
        {
          id: 'schedule',
          area: 'schedule',
          state: 'fail',
          summary: 'schedule blocked since 2026-10-12',
          fix: { text: 'restart the app', command: 'pnpm gmt restart' },
        },
        { id: 'email', area: 'email', state: 'ok', summary: 'configured' },
      ]),
    );
    renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    const text = document.body.textContent ?? '';
    expect(findBannedWords(text)).toEqual([]);
    for (const word of Object.values(COPY.statusView.state)) expect(findBannedWords(word)).toEqual([]);
  });

  it('at 375 px every control is a 44 px target that can wrap and nothing is a fixed-width table', async () => {
    setViewportWidth(375);
    serve(
      statusReport([
        {
          id: 'schedule',
          area: 'schedule',
          state: 'fail',
          summary: 'schedule blocked since 2026-10-12',
          fix: { text: 'restart the app', command: 'pnpm gmt restart' },
        },
        { id: 'email', area: 'email', state: 'ok', summary: 'configured' },
      ]),
    );
    renderWithProviders(<StatusView />);
    await screen.findByRole('region', { name: 'Schedule' });
    for (const button of screen.getAllByRole('button')) expect(button.className).toContain('min-h-11');
    expect(document.querySelector('table')).toBeNull();
    expect(card('Schedule').className).not.toMatch(/\bw-\[|min-w-/);
  });
});
