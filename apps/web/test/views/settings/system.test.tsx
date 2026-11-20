// Settings › System (UX redesign stage 3, settings plan ruling 13): the status report's checks one per line (what, words,
// fix) through StatusCard's line form, refetched as Status is; an off line says "Off" in words; a fix made on the Settings
// page links to its section. The worked example only.
import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STATUS_REFRESH_MS } from '../../../src/api/statusQuery.js';
import { COPY } from '../../../src/copy.js';
import { SettingsView } from '../../../src/views/Settings/SettingsView.js';
import { API, statusReport } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const S = COPY.settingsView;

afterEach(() => vi.useRealTimers());

const serve = (body: JsonBodyType, status = 200) =>
  server.use(http.get(`${API}/status`, () => HttpResponse.json(body, { status })));
const open = () => renderWithProviders(<SettingsView />, { search: '?view=settings&section=system' });
const lines = async () => {
  const list = await screen.findByRole('list', { name: S.systemLabel });
  return within(list).getAllByRole('listitem');
};

describe('Settings › System lists the checks one per line (ruling 13)', () => {
  it('one line per check: what, the state in words, the summary, and no card', async () => {
    serve(
      statusReport([
        { id: 'app', area: 'app', summary: 'version abc1234' },
        { id: 'database', area: 'database', state: 'warn', summary: 'migrations pending' },
        { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'email is not set up' },
        { id: 'schedule', area: 'schedule', state: 'fail', summary: 'schedule blocked' },
      ]),
    );
    open();
    const items = await lines();
    expect(items).toHaveLength(4);
    // the line form, not a card: no check is a region of its own (the page's own section is the only one)
    expect(screen.getAllByRole('region')).toHaveLength(1);
    const text = items.map((li) => li.textContent);
    expect(text).toContainEqual(expect.stringContaining('Appversion abc1234'));
    expect(text).toContainEqual(expect.stringContaining('DatabaseTo check: migrations pending'));
    expect(text).toContainEqual(expect.stringContaining('ScheduleFailing: schedule blocked'));
    // an off line says Off in words, never by its dot alone
    expect(text).toContainEqual(expect.stringContaining('EmailOff: email is not set up'));
  });

  it('a line that is not ok shows its fix as words; a fix made in Settings links to its section; a command is shown', async () => {
    serve(
      statusReport([
        {
          id: 'provider-searchapi',
          area: 'provider',
          providerId: 'searchapi',
          state: 'fail',
          summary: 'SearchApi: the last call was refused',
          fix: {
            text: 'replace the SearchApi key in Settings › Price sources',
            command: null,
            settings: 'sources',
          },
        },
        {
          id: 'settings-aside-smtp-port',
          area: 'settings',
          state: 'fail',
          summary: "Saved Mail server port isn't valid any more: set it again in Settings",
          fix: { text: 'set it again in Settings › Email and alerts', command: null, settings: 'email' },
        },
        {
          id: 'worker',
          area: 'worker',
          state: 'warn',
          summary: 'the worker is not answering',
          fix: { text: 'start it', command: 'pnpm gmt start' },
        },
      ]),
    );
    open();
    const items = await lines();
    const byName = (n: RegExp) => {
      const li = items.find((x) => n.test(x.textContent ?? ''));
      if (li === undefined) throw new Error(`no line ${n}`);
      return li;
    };
    const sa = byName(/SearchApi: the last call/);
    expect(
      within(sa).getByRole('link', { name: 'replace the SearchApi key in Settings › Price sources' }),
    ).toHaveAttribute('href', '/?view=settings&section=sources');
    const aside = byName(/Mail server port/);
    expect(
      within(aside).getByRole('link', { name: 'set it again in Settings › Email and alerts' }),
    ).toHaveAttribute('href', '/?view=settings&section=email');
    const worker = byName(/not answering/);
    expect(within(worker).getByText('pnpm gmt start')).toBeInTheDocument();
    expect(within(worker).queryByRole('link')).toBeNull();
  });

  it('an ok line carries no fix, and a note shows on its line', async () => {
    serve(
      statusReport([
        {
          id: 'backups',
          area: 'backups',
          summary: 'newest backup 3 h old',
          note: 'first daily backup due 03:30',
          fix: { text: 'should not show', command: null },
        },
      ]),
    );
    open();
    const [li] = await lines();
    expect(li).toHaveTextContent('first daily backup due 03:30');
    expect(li).not.toHaveTextContent('should not show');
  });

  it('refetches every 60 s as Status does, and a later answer replaces the lines', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });
    let hits = 0;
    server.use(
      http.get(`${API}/status`, () => {
        hits += 1;
        return HttpResponse.json(statusReport([{ id: 'app', area: 'app', summary: `answer ${hits}` }]));
      }),
    );
    open();
    await screen.findByText(/answer 1/);
    await act(() => vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS));
    expect(await screen.findByText(/answer 2/)).toBeInTheDocument();
  });

  it('with no report says the app is not answering, and Try again loads it', async () => {
    server.use(http.get(`${API}/status`, () => HttpResponse.error()));
    const { user } = open();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.statusView.notAnswering);
    serve(statusReport([{ id: 'app', area: 'app', summary: 'back again' }]));
    await user.click(within(alert).getByRole('button', { name: COPY.retryLoad }));
    expect(await screen.findByText(/back again/)).toBeInTheDocument();
  });

  it('works without the settings read: a failing /settings does not hide the System lines', async () => {
    server.use(http.get(`${API}/settings`, () => HttpResponse.error()));
    serve(statusReport([{ id: 'app', area: 'app', summary: 'still shown' }]));
    open();
    expect(await screen.findByText(/still shown/)).toBeInTheDocument();
  });
});
