// The Settings page and its Price sources (UX redesign stage 3; settings plan rulings 5, 6, 8, 9, 10 and 14): sections
// in the URL, edits that survive a section switch, the browser block both ways, the source switches, the plan's billing
// day, only changed names sent, a refusal beside its field, the restart watched to a new boot id, the pending line,
// Remove confirmed in the page, and the balance's states told apart. Synthetic keys; London → New York only.
import { type ProviderId, SETTING_LABELS } from '@gmt/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/App.js';
import { COPY } from '../../../src/copy.js';
import { SettingsView } from '../../../src/views/Settings/SettingsView.js';
import { RESTART_LIMIT_MS, RESTART_POLL_MS } from '../../../src/views/Settings/useSettingsForm.js';
import {
  API,
  budgetResponse,
  healthDetail,
  providersResponse,
  settingsView,
  statusReport,
  usage,
} from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

const S = COPY.settingsView;

afterEach(() => vi.useRealTimers());

type View = Parameters<typeof settingsView>[0];
const serveView = (over: View = {}) =>
  server.use(http.get(`${API}/settings`, () => HttpResponse.json(settingsView(over))));

/** Every PUT /settings body, answered with `answer` (a save that restarts at once by default). */
function capturePuts(answer: JsonBodyType = { warnings: [], applies: 'now' }, status = 200) {
  const bodies: unknown[] = [];
  server.use(
    http.put(`${API}/settings`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(answer, { status });
    }),
  );
  return bodies;
}

const open = (search = '?view=settings') => renderWithProviders(<SettingsView />, { search });
const sourceCard = (name: string) => screen.findByRole('region', { name });
const browserCard = () => sourceCard(COPY.newSearch.source.camoufox);
const searchApiCard = () => sourceCard(COPY.newSearch.source.searchapi);
const cacheCard = () => sourceCard(COPY.newSearch.source.travelpayouts);
const switchOf = (card: HTMLElement, source: string) =>
  within(card).getByRole('switch', { name: S.switchLabel(source) });
const saveButton = () => screen.getByRole('button', { name: S.save(S.section.sources) });
const patience = () => screen.findByRole('spinbutton', { name: SETTING_LABELS.FLIGHT_READ_PATIENCE });

describe('the sections are in the URL (ruling 14)', () => {
  it('a side list of four links, each to its section, the open one marked; Price sources is the first', async () => {
    open();
    const nav = await screen.findByRole('navigation', { name: S.sectionsLabel });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Price sources', '/?view=settings&section=sources'],
      ['Limits', '/?view=settings&section=limits'],
      ['Email and alerts', '/?view=settings&section=email'],
      ['System', '/?view=settings&section=system'],
    ]);
    expect(links.map((l) => l.getAttribute('aria-current'))).toEqual(['page', null, null, null]);
    expect(screen.getByRole('heading', { level: 2, name: 'Price sources' })).toBeInTheDocument();
    expect(screen.getByText(S.lede.sources)).toBeInTheDocument();
  });

  it.each([
    ['limits', 'Limits'],
    ['email', 'Email and alerts'],
    ['system', 'System'],
    ['nonsense', 'Price sources'],
  ])('section=%s opens %s', async (section, heading) => {
    open(`?view=settings&section=${section}`);
    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { current: 'page' })).toHaveTextContent(heading);
  });

  it('a section link switches the section in place and writes it to the URL', async () => {
    const { user } = open();
    await browserCard();
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: 'Limits' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Limits' })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('section')).toBe('limits');
  });

  it("the top bar's health line opens Settings › System", async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(statusReport([{ id: 'backups', area: 'backups', state: 'warn', summary: 'old' }])),
      ),
    );
    const { user } = renderWithProviders(<App />, { search: '?view=searches' });
    const link = await screen.findByRole('link', { name: /Backups needs attention · fix/ });
    expect(link).toHaveAttribute('href', '/?view=settings&section=system');
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 2, name: 'System' })).toBeInTheDocument();
  });
});

describe('unsaved edits survive a section switch and mark it (ruling 14)', () => {
  it('an edit to Price sources is kept across Limits and back, and its link says "unsaved" meanwhile', async () => {
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { name: 'Price sources · unsaved' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Limits' }));
    await screen.findByRole('heading', { level: 2, name: 'Limits' });
    expect(within(nav).getByRole('link', { name: 'Price sources · unsaved' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Limits' })).toBeInTheDocument();
    await user.click(within(nav).getByRole('link', { name: 'Price sources · unsaved' }));
    expect(await patience()).toHaveValue(20);
  });

  it('putting the value back is no edit: the mark goes and nothing is sent', async () => {
    const puts = capturePuts();
    const { user, client } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.clear(field);
    await user.type(field, '12');
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { name: 'Price sources' })).toBeInTheDocument();
    await user.click(saveButton());
    expect(await screen.findByText(S.unchanged)).toBeInTheDocument();
    await settled(client);
    expect(puts).toEqual([]);
  });
});

describe('the browser block, both ways (ruling 9)', () => {
  it('with the browser not set up: how to set it up, and no controls', async () => {
    serveView({ envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 } });
    open();
    const card = await browserCard();
    expect(card).toHaveTextContent(`${S.browserNotSetUp} ${S.browserCommand} ${S.browserSetUpDoc}`);
    expect(within(card).queryByRole('switch')).toBeNull();
    expect(within(card).queryByRole('spinbutton')).toBeNull();
    expect(within(card).queryByRole('combobox')).toBeNull();
  });

  it('set up: its state and consent from the status report, pages at once with its command, the stopping rule, when it may run, and Advanced', async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport(
            [
              { id: 'worker', area: 'worker', providerId: 'camoufox', summary: 'ready' },
              { id: 'consent', area: 'consent', summary: 'consent rejected, expires 18 Nov 2027 (cookie)' },
            ],
            { pagesAtOnce: 2 },
          ),
        ),
      ),
    );
    open();
    const card = await browserCard();
    expect(switchOf(card, COPY.newSearch.source.camoufox)).toBeChecked();
    expect(await within(card).findByText(S.browserReady)).toBeInTheDocument();
    expect(
      within(card).getByText(S.consentLine('consent rejected, expires 18 Nov 2027 (cookie)')),
    ).toBeInTheDocument();
    expect(within(card).getByText(S.pagesAtOnce(2)).closest('p')).toHaveTextContent(
      `${S.pagesAtOnce(2)} · ${S.changeWith} ${S.browserCommand}`,
    );
    // the pages are read only: no field for them
    expect(within(card).queryByRole('spinbutton', { name: /pages/i })).toBeNull();
    expect(within(card).getByRole('spinbutton', { name: SETTING_LABELS.FLIGHT_READ_PATIENCE })).toHaveValue(
      12,
    );
    expect(within(card).getByText(S.patienceBefore, { exact: false })).toHaveTextContent(
      `${S.patienceBefore} ${S.patienceAfter(5)}`,
    );
    const when = within(card).getByRole('combobox', { name: SETTING_LABELS.CAMOUFOX_BROWSER_WINDOW });
    expect(when).toHaveValue('scheduled');
    expect(
      within(when)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['only during scheduled searches', 'any time']);
    expect(within(card).getByText(S.advanced)).toBeInTheDocument();
    expect(within(card).getByRole('spinbutton', { name: SETTING_LABELS.DISCOVERY_REFRESH_DAYS })).toHaveValue(
      7,
    );
    // spec revision 38: the pause after an unrecognised page is not a setting
    expect(card).not.toHaveTextContent(/unrecognised/i);
  });

  it('a worker that is not answering says so in words, and pages at once is then not known', async () => {
    server.use(
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            { id: 'worker', area: 'worker', providerId: 'camoufox', state: 'fail', summary: 'not answering' },
          ]),
        ),
      ),
    );
    open();
    const card = await browserCard();
    expect(await within(card).findByText(S.browserState('failing', 'not answering'))).toBeInTheDocument();
    expect(within(card).getByText(S.pagesAtOnceUnknown)).toBeInTheDocument();
  });
});

describe('the source switches (ruling 8)', () => {
  it.each<[string, ProviderId[], ProviderId[], boolean, boolean, boolean]>([
    ['neither box', ['travelpayouts'], [], false, false, false],
    ['the trip check', ['travelpayouts'], ['searchapi'], true, false, true],
    ['the calendar', ['travelpayouts', 'searchapi'], [], false, true, true],
    ['both boxes', ['searchapi'], ['searchapi'], true, true, true],
  ])('SearchApi with %s ticked: the boxes and the switch', async (_n, discovery, verification, v, d, on) => {
    serveView({ newSearchSources: { discovery, verification } });
    open();
    const card = await searchApiCard();
    expect(within(card).getByRole('checkbox', { name: S.verificationBox })).toHaveProperty('checked', v);
    expect(
      within(card).getByRole('checkbox', { name: `${S.discoveryBox} ${S.discoveryBoxNote}` }),
    ).toHaveProperty('checked', d);
    const sw = switchOf(card, COPY.newSearch.source.searchapi);
    expect(sw).toHaveProperty('checked', on);
    expect(within(card).getByText(on ? S.switchOn : S.switchOff)).toBeInTheDocument();
  });

  it('SearchApi On ticks the first box only, and the save sends the trip check list alone', async () => {
    const puts = capturePuts();
    const { user } = open();
    const card = await searchApiCard();
    await user.click(switchOf(card, COPY.newSearch.source.searchapi));
    expect(within(card).getByRole('checkbox', { name: S.verificationBox })).toBeChecked();
    expect(
      within(card).getByRole('checkbox', { name: `${S.discoveryBox} ${S.discoveryBoxNote}` }),
    ).not.toBeChecked();
    expect(within(card).getByText(S.switchOn)).toBeInTheDocument();
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { NEW_SEARCH_VERIFICATION: 'searchapi' } }]);
  });

  it('SearchApi Off unticks both boxes and stores none for a list it empties', async () => {
    serveView({
      newSearchSources: { discovery: ['travelpayouts', 'searchapi'], verification: ['searchapi'] },
    });
    const puts = capturePuts();
    const { user } = open();
    const card = await searchApiCard();
    await user.click(switchOf(card, COPY.newSearch.source.searchapi));
    expect(
      within(card)
        .getAllByRole('checkbox')
        .map((c) => (c instanceof HTMLInputElement ? c.checked : null)),
    ).toEqual([false, false]);
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([
      { changes: { NEW_SEARCH_DISCOVERY: 'travelpayouts', NEW_SEARCH_VERIFICATION: 'none' } },
    ]);
  });

  it('ticking a box turns the switch on; unticking the last turns it off', async () => {
    const { user } = open();
    const card = await searchApiCard();
    const calendar = within(card).getByRole('checkbox', { name: `${S.discoveryBox} ${S.discoveryBoxNote}` });
    await user.click(calendar);
    expect(switchOf(card, COPY.newSearch.source.searchapi)).toBeChecked();
    await user.click(calendar);
    expect(switchOf(card, COPY.newSearch.source.searchapi)).not.toBeChecked();
    expect(within(card).getByText(S.switchOff)).toBeInTheDocument();
  });

  it.each([
    ['the Aviasales cache', COPY.newSearch.source.travelpayouts, cacheCard, 'camoufox'],
    ['the browser', COPY.newSearch.source.camoufox, browserCard, 'travelpayouts'],
  ])('%s: its switch is its place in the calendar list, both ways', async (_n, name, card, other) => {
    const puts = capturePuts();
    const { user } = open();
    const c = await card();
    const sw = switchOf(c, name);
    expect(sw).toBeChecked();
    expect(within(c).getByText(S.switchOn)).toBeInTheDocument();
    await user.click(sw);
    expect(sw).not.toBeChecked();
    expect(within(c).getByText(S.switchOff)).toBeInTheDocument();
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { NEW_SEARCH_DISCOVERY: other } }]);
  });

  it('switching the last calendar source off stores none', async () => {
    serveView({ newSearchSources: { discovery: ['travelpayouts'], verification: [] } });
    const puts = capturePuts();
    const { user } = open();
    await user.click(switchOf(await cacheCard(), COPY.newSearch.source.travelpayouts));
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { NEW_SEARCH_DISCOVERY: 'none' } }]);
  });

  it('a source with no key saved cannot be switched on, and says why', async () => {
    serveView({
      secrets: {
        TRAVELPAYOUTS_TOKEN: { set: false, last4: null },
        SEARCHAPI_KEY: { set: false, last4: null },
        SMTP_PASS: { set: false, last4: null },
      },
      newSearchSources: { discovery: ['camoufox'], verification: [] },
    });
    const { user } = open();
    const sa = await searchApiCard();
    expect(switchOf(sa, COPY.newSearch.source.searchapi)).toBeDisabled();
    expect(within(sa).getByText(S.needsKey)).toBeInTheDocument();
    expect(switchOf(await cacheCard(), COPY.newSearch.source.travelpayouts)).toBeDisabled();
    // a key typed in is enough to switch it on in the same save
    await user.type(
      within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' }),
      'sk-test-0123456789abcdef',
    );
    expect(switchOf(sa, COPY.newSearch.source.searchapi)).toBeEnabled();
  });
});

describe('SearchApi’s plan and billing day (ruling 10)', () => {
  it('the billing day shows only on the $40 plan', async () => {
    const { user } = open();
    const card = await searchApiCard();
    const plan = within(card).getByRole('combobox', { name: SETTING_LABELS.SEARCHAPI_PLAN });
    expect(plan).toHaveValue('trial');
    expect(
      within(plan)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Free trial', '$40 a month']);
    expect(within(card).queryByRole('spinbutton', { name: SETTING_LABELS.SEARCHAPI_BILLING_DAY })).toBeNull();
    await user.selectOptions(plan, '40usd');
    expect(within(card).getByRole('spinbutton', { name: SETTING_LABELS.SEARCHAPI_BILLING_DAY })).toHaveValue(
      1,
    );
    await user.selectOptions(plan, 'trial');
    expect(within(card).queryByRole('spinbutton', { name: SETTING_LABELS.SEARCHAPI_BILLING_DAY })).toBeNull();
  });

  it('a stored $40 plan opens with its billing day', async () => {
    serveView({ values: { ...settingsView().values, SEARCHAPI_PLAN: '40usd', SEARCHAPI_BILLING_DAY: '14' } });
    open();
    const card = await searchApiCard();
    expect(within(card).getByRole('spinbutton', { name: SETTING_LABELS.SEARCHAPI_BILLING_DAY })).toHaveValue(
      14,
    );
  });
});

describe('only the changed names are sent (ruling 5)', () => {
  it('a changed number, a changed choice and a typed key, nothing else; the key field is cleared after the save', async () => {
    const puts = capturePuts();
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.selectOptions(
      screen.getByRole('combobox', { name: SETTING_LABELS.CAMOUFOX_BROWSER_WINDOW }),
      'any',
    );
    const card = await searchApiCard();
    await user.click(within(card).getByRole('button', { name: S.replace }));
    const key = within(card).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' });
    expect(key).toHaveAttribute('type', 'password');
    expect(key).toHaveAttribute('autocomplete', 'new-password');
    await user.type(key, 'sk-test-new-0123456789abcdef');
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([
      {
        changes: {
          SEARCHAPI_KEY: 'sk-test-new-0123456789abcdef',
          CAMOUFOX_BROWSER_WINDOW: 'any',
          FLIGHT_READ_PATIENCE: '20',
        },
      },
    ]);
    // the typed key is gone from the page: the field closed, its saved form shown again
    expect(within(card).queryByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' })).toBeNull();
    expect(document.body.innerHTML).not.toContain('sk-test-new-0123456789abcdef');
  });
});

describe('a refusal sits beside its field (ruling 5)', () => {
  it("each 422 field's words are tied to its input, and the save says nothing was saved", async () => {
    const words = 'Choose a whole number of reads from 3 to 50.';
    capturePuts(
      {
        error: {
          code: 'invalid_settings',
          message: 'nothing was saved',
          details: { fields: [{ field: 'FLIGHT_READ_PATIENCE', message: words }] },
        },
      },
      422,
    );
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '99');
    await user.click(saveButton());
    expect(await screen.findByText(S.refused)).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(words);
    // editing the field takes its refusal away
    await user.type(field, '{Backspace}');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(words)).toBeNull();
  });
});

describe('after Save: the restart, or the runs it waits for (ruling 14)', () => {
  /**
   * Answers GET /health with each boot id in turn ("down" fails), the last one repeated. `reads` counts them; `read(n)`
   * resolves when the n-th read has reached the handler (an event, never a wait for time).
   */
  function serveHealth(ids: readonly string[]) {
    const seen = { reads: 0 };
    const arrived: Array<() => void> = [];
    const reached: Array<Promise<void>> = [];
    const slot = (n: number) => {
      while (reached.length <= n) reached.push(new Promise<void>((resolve) => arrived.push(resolve)));
      return reached[n];
    };
    server.use(
      http.get(`${API}/health`, () => {
        const id = ids[Math.min(seen.reads, ids.length - 1)] ?? 'boot-1';
        void slot(seen.reads);
        arrived[seen.reads]?.();
        seen.reads += 1;
        return id === 'down' ? HttpResponse.error() : HttpResponse.json(healthDetail(id));
      }),
    );
    return { seen, read: (n: number) => slot(n - 1) };
  }

  /**
   * Under fake timers testing-library's findBy* never returns (its flush waits on a faked setTimeout), so the page is
   * read with getBy* once an answer that already reached its handler has been delivered: a few turns of the I/O queue
   * (setImmediate is not faked), inside act so React renders what it set.
   */
  const delivered = () =>
    act(async () => {
      for (let turn = 0; turn < 10; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    });

  async function editAndSave(health: ReturnType<typeof serveHealth>) {
    const view = open();
    const field = await patience();
    await view.user.clear(field);
    await view.user.type(field, '20');
    // why: from here the watch's polls and its 60 s are the test's, stepped explicitly
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(saveButton());
    // the boot id is read before the save
    await act(() => health.read(1));
    await delivered();
    expect(screen.getByText(S.restarting)).toBeInTheDocument();
    return view;
  }

  it('says "Restarting the app…" until /api/health answers a new boot id, through a spell of no answer', async () => {
    const puts = capturePuts();
    const health = serveHealth(['boot-1', 'boot-1', 'down', 'boot-2']);
    await editAndSave(health);
    expect(puts).toHaveLength(1);
    for (const n of [2, 3]) {
      await act(() => vi.advanceTimersByTimeAsync(RESTART_POLL_MS));
      await act(() => health.read(n));
      await delivered();
      expect(screen.getByText(S.restarting)).toBeInTheDocument();
    }
    await act(() => vi.advanceTimersByTimeAsync(RESTART_POLL_MS));
    await act(() => health.read(4));
    await delivered();
    expect(screen.getByText(S.restarted)).toBeInTheDocument();
    // the watch is over: no more reads
    await act(() => vi.advanceTimersByTimeAsync(RESTART_POLL_MS * 5));
    await delivered();
    expect(health.seen.reads).toBe(4);
  });

  it('after 60 s with no new boot id it says the app did not come back, and stops asking', async () => {
    capturePuts();
    const health = serveHealth(['boot-1']);
    await editAndSave(health);
    await act(() => vi.advanceTimersByTimeAsync(RESTART_LIMIT_MS - 1));
    await delivered();
    expect(screen.getByText(S.restarting)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1));
    await delivered();
    expect(screen.getByText("The app didn't come back: run pnpm gmt status")).toBeInTheDocument();
    const reads = health.seen.reads;
    await act(() => vi.advanceTimersByTimeAsync(RESTART_POLL_MS * 5));
    await delivered();
    expect(health.seen.reads).toBe(reads);
  });

  it('a save the app holds for running searches names them; nothing restarts', async () => {
    capturePuts({
      warnings: [],
      applies: 'after-runs',
      running: ['London → New York', 'Weekend in New York'],
    });
    const health = serveHealth(['boot-1']);
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    expect(
      await screen.findByText(
        'Saved. Applies when London → New York and Weekend in New York finish; new searches wait until then.',
      ),
    ).toBeInTheDocument();
    expect(health.seen.reads).toBe(1);
  });

  it('a page loaded while a save waits says so, every load', async () => {
    serveView({ pending: { running: ['London → New York'] } });
    open();
    expect(
      await screen.findByText('Saved. Applies when London → New York finish; new searches wait until then.'),
    ).toBeInTheDocument();
  });

  it("the save's warnings are shown with its result", async () => {
    capturePuts({ warnings: ['The spend limit is below the plan’s fees.'], applies: 'now' });
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    expect(await screen.findByText('The spend limit is below the plan’s fees.')).toBeInTheDocument();
  });

  it('with no boot id to compare, nothing is saved', async () => {
    const puts = capturePuts();
    server.use(http.get(`${API}/health`, () => HttpResponse.error()));
    const { user, client } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    expect(await screen.findByText(S.noAnswer)).toBeInTheDocument();
    await settled(client);
    expect(puts).toEqual([]);
  });

  it('a save that changed nothing on the server says so', async () => {
    capturePuts({ warnings: [], applies: 'unchanged' });
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    expect(await screen.findByText(S.unchanged)).toBeInTheDocument();
  });

  it('the result is in a polite live region', async () => {
    capturePuts();
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    const line = await screen.findByText(S.restarting);
    expect(line.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('Remove confirms in the page first (ruling 14)', () => {
  it('Keep it sends nothing; Remove it saves the key unset', async () => {
    const puts = capturePuts();
    const { user, client } = open();
    const card = await searchApiCard();
    await user.click(within(card).getByRole('button', { name: S.remove }));
    const ask = within(card).getByRole('group', { name: S.confirmRemove(SETTING_LABELS.SEARCHAPI_KEY) });
    expect(ask).toHaveTextContent('Remove the saved SearchApi key?');
    await user.click(within(ask).getByRole('button', { name: S.confirmRemoveNo }));
    await settled(client);
    expect(puts).toEqual([]);
    await user.click(within(card).getByRole('button', { name: S.remove }));
    await user.click(within(card).getByRole('button', { name: S.confirmRemoveYes }));
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { SEARCHAPI_KEY: null } }]);
  });
});

describe('the key and the balance: every state told apart (ruling 10)', () => {
  const account = (remaining: number) =>
    server.use(
      http.get(`${API}/searchapi/account`, () =>
        HttpResponse.json({
          account: {
            remaining,
            monthlyAllowance: 10_000,
            periodEnd: '2026-12-01',
            fetchedAt: '2026-10-14T14:58:00.000Z',
          },
        }),
      ),
    );

  it('a saved key shows only its last four, never the key, with SearchApi’s own balance', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T15:00:00.000Z'));
    account(412);
    open();
    const card = await searchApiCard();
    expect(within(card).getByText(S.secretEnds('3f2a'))).toBeInTheDocument();
    expect(await within(card).findByText(S.credits(412, null))).toBeInTheDocument();
    expect(within(card).getByText('· resets 1 Dec')).toBeInTheDocument();
    expect(within(card).queryByText(S.searchapiNoKey)).toBeNull();
  });

  it('none left is "0 credits left", not unread', async () => {
    account(0);
    open();
    const card = await searchApiCard();
    expect(await within(card).findByText('0 credits left')).toBeInTheDocument();
    expect(within(card).queryByText(S.balanceUnread)).toBeNull();
  });

  it("a balance that couldn't be read, with no count of this app's own, says so", async () => {
    // the default budget has no SearchApi window, and the default balance read is null
    open();
    const card = await searchApiCard();
    expect(await within(card).findByText(S.balanceUnread)).toBeInTheDocument();
    expect(within(card).queryByText(/credits? left/)).toBeNull();
  });

  it("a balance that couldn't be read is this app's count when it has one", async () => {
    server.use(
      http.get(`${API}/budget`, () =>
        HttpResponse.json(budgetResponse({ scopes: [usage('provider-month:searchapi', 49, 100)] })),
      ),
    );
    open();
    const card = await searchApiCard();
    expect(await within(card).findByText(S.credits(51, 100))).toBeInTheDocument();
    expect(within(card).getByText("(this app's count)")).toBeInTheDocument();
    expect(within(card).queryByText(S.balanceUnread)).toBeNull();
  });

  it('no key saved: says so, with no balance', async () => {
    serveView({
      secrets: {
        TRAVELPAYOUTS_TOKEN: { set: false, last4: null },
        SEARCHAPI_KEY: { set: false, last4: null },
        SMTP_PASS: { set: false, last4: null },
      },
    });
    open();
    const card = await searchApiCard();
    expect(within(card).getByText(S.searchapiNoKey)).toBeInTheDocument();
    expect(within(card).getByText(S.secretNotSet)).toBeInTheDocument();
    expect(within(card).queryByText(S.balanceUnread)).toBeNull();
    expect(within(card).queryByText(/credits? left/)).toBeNull();
    expect(within(await cacheCard()).getByText(S.travelpayoutsNoKey)).toBeInTheDocument();
  });

  it('a saved key the app set aside says to paste it again, not "not set", and shows no balance', async () => {
    account(412);
    serveView({ setAside: ['SEARCHAPI_KEY'] });
    open();
    const card = await searchApiCard();
    expect(within(card).getByText(S.secretSetAside)).toBeInTheDocument();
    expect(within(card).queryByText(S.secretNotSet)).toBeNull();
    expect(within(card).queryByText(S.searchapiNoKey)).toBeNull();
    expect(within(card).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' })).toHaveAttribute(
      'type',
      'password',
    );
    expect(within(card).queryByText(/credits? left/)).toBeNull();
  });

  it('a plain value the app set aside says the default is in use', async () => {
    serveView({
      setAside: ['FLIGHT_READ_PATIENCE'],
      values: { ...settingsView().values, FLIGHT_READ_PATIENCE: '99' },
    });
    open();
    const field = await patience();
    expect(field).toHaveAccessibleDescription(S.valueSetAside);
  });

  it("the Aviasales cache shows its token's last four and this month's calls", async () => {
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          providersResponse({
            providers: providersResponse().providers.map((p) =>
              p.providerId === 'travelpayouts'
                ? { ...p, usage: [usage('provider-month:travelpayouts', 64, 50_000)] }
                : p,
            ),
          }),
        ),
      ),
    );
    open();
    const card = await cacheCard();
    expect(within(card).getByText(S.secretEnds('91c0'))).toBeInTheDocument();
    expect(await within(card).findByText('64 calls this month (limit 50,000)')).toBeInTheDocument();
  });
});
