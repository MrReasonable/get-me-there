// Spec §11 status bar: the link to the Status view, from the same query as the view (brief WP18 Task 18.6).
import { act, screen } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_KEY, STATUS_REFRESH_MS, STATUS_RETRY_DELAY_MS } from '../../src/api/statusQuery.js';
import { StatusBar, StatusLink } from '../../src/components/StatusBar.js';
import { StatusView } from '../../src/views/Status.js';
import { API, definition, statusReport } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders, settled } from '../render.js';

afterEach(() => vi.useRealTimers());

const serve = (body: JsonBodyType, status = 200) =>
  server.use(http.get(`${API}/status`, () => HttpResponse.json(body, { status })));
const ago = (seconds: number) =>
  new Date(Date.parse('2026-10-14T15:00:00.000Z') - seconds * 1000).toISOString();
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

describe('the status bar link (spec §11)', () => {
  it('names the area when one check fails and counts when several do', async () => {
    serve(statusReport([failing('schedule'), { id: 'app', area: 'app', summary: 'up' }]));
    const first = renderWithProviders(<StatusLink />);
    expect(await screen.findByRole('link', { name: 'Status: schedule failing' })).toHaveAttribute(
      'href',
      expect.stringContaining('view=status'),
    );
    first.unmount();
    serve(statusReport([failing('schedule'), failing('worker')]));
    renderWithProviders(<StatusLink />);
    expect(await screen.findByRole('link', { name: 'Status: 2 failing' })).toBeInTheDocument();
  });

  it('a warning is the quieter "to check", naming the area for one item', async () => {
    serve(statusReport([warning('consent')]));
    renderWithProviders(<StatusLink />);
    const link = await screen.findByRole('link', { name: 'Status: consent to check' });
    expect(link.className).not.toContain('font-semibold');
  });

  it('a failure outranks warnings and counts only the failures', async () => {
    serve(statusReport([warning('consent'), warning('data'), failing('worker')]));
    renderWithProviders(<StatusLink />);
    expect(await screen.findByRole('link', { name: 'Status: worker failing' })).toBeInTheDocument();
  });

  it('shows nothing for ok checks, notes and off checks', async () => {
    serve(
      statusReport([
        { id: 'app', area: 'app', summary: 'up', note: 'caught up the run missed at 01:30' },
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
      ]),
    );
    const { client } = renderWithProviders(<StatusLink />);
    await settled(client);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('goes to the Status view when clicked', async () => {
    serve(statusReport([failing('app')]));
    const { user } = renderWithProviders(<StatusLink />);
    await user.click(await screen.findByRole('link', { name: 'Status: app failing' }));
    expect(window.location.search).toContain('view=status');
  });

  it('after a failed refresh it says the report is stale and how old, even when the old report was clean', async () => {
    serve(statusReport([{ id: 'app', area: 'app', summary: 'up' }], { generatedAt: ago(185) }));
    const { client } = renderWithProviders(<StatusLink />);
    await settled(client);
    expect(screen.queryByRole('link')).toBeNull();
    serve({ error: { code: 'internal', message: 'boom' } }, 500);
    await act(async () => {
      await client.refetchQueries({ queryKey: STATUS_KEY });
    });
    expect(await screen.findByRole('link', { name: 'Status: stale, checked 3 min ago' })).toBeInTheDocument();
  });

  it('with no answer at all it says the app is not answering', async () => {
    server.use(http.get(`${API}/status`, () => HttpResponse.error()));
    renderWithProviders(<StatusLink />);
    expect(await screen.findByRole('link', { name: 'Status: app not answering' })).toBeInTheDocument();
  });

  it('tells a refused sign-in and an error answer apart from silence (V11)', async () => {
    serve({ error: { code: 'unauthenticated', message: 'authentication required' } }, 401);
    const first = renderWithProviders(<StatusLink />);
    expect(await screen.findByRole('link', { name: 'Status: sign-in refused' })).toBeInTheDocument();
    first.unmount();
    serve({ error: { code: 'internal', message: 'internal error; see the server log' } }, 500);
    renderWithProviders(<StatusLink />);
    expect(
      await screen.findByRole('link', { name: 'Status: report failed, see the app log' }),
    ).toBeInTheDocument();
  });

  it('labels its landmark with the key and keeps the line as the link’s own name', async () => {
    serve(statusReport([failing('schedule')]));
    renderWithProviders(<StatusLink />);
    const link = await screen.findByRole('link', { name: 'Status: schedule failing' });
    expect(link.closest('section')).toHaveAccessibleName('Status report');
  });

  it('fails fast: one retry at most, after a short delay the test steps over with fake timers', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.error();
      }),
    );
    renderWithProviders(<StatusLink />);
    await act(() => vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAY_MS));
    expect(await screen.findByRole('link', { name: 'Status: app not answering' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAY_MS * 10));
    expect(hits).toBe(2);
  });

  it('says nothing while the first answer is awaited', async () => {
    serve(statusReport([failing('app')]));
    const { client } = renderWithProviders(<StatusLink />);
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
        <StatusLink />
        <StatusView />
      </>,
    );
    expect(await screen.findByRole('link', { name: 'Status: schedule failing' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Schedule' })).toBeInTheDocument();
    expect(hits).toBe(1);
  });

  it('refreshes every 60 s: a later answer changes the line', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.json(statusReport(hits === 1 ? [warning('data')] : [failing('worker')]));
      }),
    );
    renderWithProviders(<StatusLink />);
    await screen.findByRole('link', { name: 'Status: data to check' });
    await act(() => vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS));
    expect(await screen.findByRole('link', { name: 'Status: worker failing' })).toBeInTheDocument();
  });

  it('is part of the bar on every view, with or without a definition', async () => {
    serve(statusReport([failing('app')]));
    const first = renderWithProviders(<StatusBar definition={null} showRunNow={false} />);
    expect(await screen.findByRole('link', { name: 'Status: app failing' })).toBeInTheDocument();
    // why: CodeRabbit — unmount the first render, or its link would satisfy the second assertion by itself
    first.unmount();
    renderWithProviders(<StatusBar definition={definition()} showRunNow />);
    expect(await screen.findByRole('link', { name: 'Status: app failing' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Status: app failing' })).toHaveLength(1);
  });
});
