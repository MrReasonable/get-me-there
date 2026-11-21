// The Settings page and its Price sources (UX redesign stage 3; settings plan rulings 5, 6, 8, 9, 10 and 14): sections
// in the URL, edits that survive a section switch, the browser block both ways, the source switches, the plan's billing
// day, only changed names sent, a refusal beside its field, the restart watched to a new boot id, the pending line,
// Remove confirmed in the page, and the balance's states told apart. Synthetic keys; London → New York only.
import { type ProviderId, SETTING_LABELS } from '@gmt/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/App.js';
import { SETTINGS_KEY } from '../../../src/api/queries.js';
import { COPY } from '../../../src/copy.js';
import { RestartClockContext } from '../../../src/views/Settings/restartClock.js';
import { SettingsView } from '../../../src/views/Settings/SettingsView.js';
import {
  RESTART_LIMIT_MS,
  RESTART_POLL_MS,
  useSettingsForm,
} from '../../../src/views/Settings/useSettingsForm.js';
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
import { manualClock } from './manualClock.js';

const S = COPY.settingsView;

afterEach(() => vi.useRealTimers());

type View = Parameters<typeof settingsView>[0];
const serveView = (over: View = {}) =>
  server.use(http.get(`${API}/settings`, () => HttpResponse.json(settingsView(over))));

/** Every PUT /settings body, answered with `answer` (a save that restarts at once by default). */
function capturePuts(answer: JsonBodyType = { warnings: [], applies: 'now' }, status = 200) {
  return capturePutEvents(answer, status).bodies;
}

/** As capturePuts, with `reached(n)`: resolves when the n-th PUT has reached the handler (an event, never a wait). */
function capturePutEvents(answer: JsonBodyType = { warnings: [], applies: 'now' }, status = 200) {
  const bodies: unknown[] = [];
  const waiting: Array<{ n: number; resolve: () => void }> = [];
  server.use(
    http.put(`${API}/settings`, async ({ request }) => {
      bodies.push(await request.json());
      for (const w of waiting.filter((x) => bodies.length >= x.n)) w.resolve();
      return HttpResponse.json(answer, { status });
    }),
  );
  const reached = (n: number) =>
    bodies.length >= n ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ n, resolve }));
  return { bodies, reached };
}

const open = (search = '?view=settings') => renderWithProviders(<SettingsView />, { search });
const sourceCard = (name: string) => screen.findByRole('region', { name });
const browserCard = () => sourceCard(COPY.newSearch.source.camoufox);
const searchApiCard = () => sourceCard(COPY.newSearch.source.searchapi);
const cacheCard = () => sourceCard(COPY.newSearch.source.travelpayouts);
const everyCard = () => sourceCard(S.everySource);
const switchOf = (card: HTMLElement, source: string) =>
  within(card).getByRole('switch', { name: S.switchLabel(source) });
const saveButton = () => screen.getByRole('button', { name: S.saveLabel.sources });
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
              {
                id: 'consent',
                area: 'consent',
                summary: 'consent rejected, expires Thu, 18 Nov 2027, 10:00 (Europe/London) (cookie)',
                expiresOn: '2027-11-18',
              },
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
    expect(within(card).getByText("Google's cookie choice saved until 18 Nov 2027")).toBeInTheDocument();
    // the report's own summary, with its internal bound, is never shown
    expect(card).not.toHaveTextContent(/consent rejected|\(cookie\)/);
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
    // review I3 (ruling R21): how often a calendar price is read again is every source's, not the browser's
    expect(within(card).queryByText(S.advanced)).toBeNull();
    expect(
      within(card).queryByRole('spinbutton', { name: SETTING_LABELS.DISCOVERY_REFRESH_DAYS }),
    ).toBeNull();
    // spec revision 38: the pause after an unrecognised page is not a setting
    expect(card).not.toHaveTextContent(/unrecognised/i);
  });

  it.each([
    ['held, its date unknown', { state: 'ok' }, "Google's cookie choice is saved"],
    ['running out', { state: 'warn', expiresOn: '2026-11-30' }, S.consentEnding('30 Nov 2026')],
    ['run out', { state: 'fail', expiresOn: '2026-11-01' }, S.consentEnded('1 Nov 2026')],
    ['missing', { state: 'fail' }, S.consentProblem],
    ['not checked yet', { state: 'off', offReason: 'awaiting-verification' }, S.consentUnchecked],
  ] as const)(
    'the consent record %s is said in the page’s words, never the summary',
    async (_n, over, words) => {
      server.use(
        http.get(`${API}/status`, () =>
          HttpResponse.json(
            statusReport([
              { id: 'worker', area: 'worker', providerId: 'camoufox', summary: 'ready' },
              { id: 'consent', area: 'consent', summary: 'internal summary words', ...over },
            ]),
          ),
        ),
      );
      open();
      const card = await browserCard();
      expect(await within(card).findByText(words)).toBeInTheDocument();
      expect(card).not.toHaveTextContent('internal summary words');
    },
  );

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
    // each disabled switch is described by its own card's reason (fix round 1, minor 2)
    expect(switchOf(sa, COPY.newSearch.source.searchapi)).toHaveAccessibleDescription(S.needsKey);
    const cache = await cacheCard();
    expect(switchOf(cache, COPY.newSearch.source.travelpayouts)).toBeDisabled();
    expect(switchOf(cache, COPY.newSearch.source.travelpayouts)).toHaveAccessibleDescription(S.needsKey);
    const reasons = document.querySelectorAll('[id^="needs-key-"]');
    expect([...reasons].map((r) => r.id)).toEqual(['needs-key-searchapi', 'needs-key-travelpayouts']);
    // a key typed in is enough to switch it on in the same save
    await user.type(
      within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' }),
      'sk-test-0123456789abcdef',
    );
    expect(switchOf(sa, COPY.newSearch.source.searchapi)).toBeEnabled();
  });
});

describe('every source, and a setting the app set aside always has its field (review I1 and I3, rulings R19 and R21)', () => {
  it.each([true, false])(
    'with the browser set up %s, Advanced holds the refresh days and Calls and caps links the Providers view',
    async (camoufoxEnabled) => {
      serveView({ envOnly: { camoufoxEnabled, searchApiTrialUsed: 0 } });
      const { user } = open();
      const card = await everyCard();
      const link = within(card).getByRole('link', { name: S.callsAndCapsLink });
      expect(link.closest('p')).toHaveTextContent(`${S.callsAndCapsBefore} ${S.callsAndCapsLink}.`);
      const url = new URL(link.getAttribute('href') ?? '', 'http://localhost');
      expect([url.searchParams.get('view'), url.searchParams.get('section')]).toEqual(['providers', null]);
      await user.click(within(card).getByText(S.advanced));
      expect(
        within(card).getByRole('spinbutton', { name: SETTING_LABELS.DISCOVERY_REFRESH_DAYS }),
      ).toHaveValue(7);
    },
  );

  it('the refresh days the app set aside open Advanced with the note', async () => {
    serveView({
      setAside: ['DISCOVERY_REFRESH_DAYS'],
      envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 },
    });
    open();
    const card = await everyCard();
    const field = within(card).getByRole('spinbutton', { name: SETTING_LABELS.DISCOVERY_REFRESH_DAYS });
    expect(field).toBeVisible();
    expect(field).toHaveAccessibleDescription(S.valueSetAside);
  });

  it('with the browser not set up, its own settings the app set aside still get their fields, and a save sends them', async () => {
    const puts = capturePuts();
    serveView({
      setAside: ['FLIGHT_READ_PATIENCE', 'CAMOUFOX_BROWSER_WINDOW'],
      values: { ...settingsView().values, FLIGHT_READ_PATIENCE: '99', CAMOUFOX_BROWSER_WINDOW: 'never' },
      envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 },
    });
    const { user } = open();
    const card = await browserCard();
    expect(card).toHaveTextContent(S.browserNotSetUp);
    expect(within(card).queryByRole('switch')).toBeNull();
    const patienceField = within(card).getByRole('spinbutton', { name: SETTING_LABELS.FLIGHT_READ_PATIENCE });
    expect(patienceField).toHaveAccessibleDescription(S.valueSetAside);
    const when = within(card).getByRole('combobox', { name: SETTING_LABELS.CAMOUFOX_BROWSER_WINDOW });
    expect(when).toHaveAccessibleDescription(S.valueSetAside);
    await user.clear(patienceField);
    await user.type(patienceField, '12');
    await user.selectOptions(when, 'any');
    await user.click(saveButton());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { CAMOUFOX_BROWSER_WINDOW: 'any', FLIGHT_READ_PATIENCE: '12' } }]);
  });

  it('with the browser not set up and nothing set aside, its card has no field', async () => {
    serveView({ setAside: ['SEARCHAPI_KEY'], envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 } });
    open();
    const card = await browserCard();
    expect(within(card).queryByRole('spinbutton')).toBeNull();
    expect(within(card).queryByRole('combobox')).toBeNull();
  });

  it('a source list the app set aside is said in each card whose switches write it, and is saved as none with every switch disabled (review residual (c))', async () => {
    const puts = capturePuts();
    serveView({
      setAside: ['NEW_SEARCH_DISCOVERY'],
      values: { ...settingsView().values, NEW_SEARCH_DISCOVERY: 'searchapi' },
      secrets: {
        TRAVELPAYOUTS_TOKEN: { set: false, last4: null },
        SEARCHAPI_KEY: { set: false, last4: null },
        SMTP_PASS: { set: false, last4: null },
      },
      newSearchSources: { discovery: [], verification: [] },
      envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 },
    });
    const { user } = open();
    const note = S.listSetAside(SETTING_LABELS.NEW_SEARCH_DISCOVERY);
    for (const [card, source] of [
      [await cacheCard(), COPY.newSearch.source.travelpayouts],
      [await searchApiCard(), COPY.newSearch.source.searchapi],
    ] as const) {
      expect(within(card).getByText(note)).toBeInTheDocument();
      const sw = switchOf(card, source);
      expect(sw).toBeDisabled();
      expect(sw).toHaveAccessibleDescription(expect.stringContaining(note));
    }
    // the verification list is not set aside, so its own box says nothing of it
    expect(screen.queryByText(S.listSetAside(SETTING_LABELS.NEW_SEARCH_VERIFICATION))).toBeNull();
    const every = await everyCard();
    expect(within(every).getByText(S.listChoose(SETTING_LABELS.NEW_SEARCH_DISCOVERY))).toBeInTheDocument();
    await user.click(within(every).getByRole('button', { name: S.listUseNone }));
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { NEW_SEARCH_DISCOVERY: 'none' } }]);
  });

  it('a source list the app set aside can be cleared so the default applies; one not set aside offers no choice', async () => {
    const puts = capturePuts();
    serveView({ setAside: ['NEW_SEARCH_VERIFICATION'] });
    const { user } = open();
    const sa = await searchApiCard();
    expect(within(sa).getByText(S.listSetAside(SETTING_LABELS.NEW_SEARCH_VERIFICATION))).toBeInTheDocument();
    expect(within(await cacheCard()).queryByText(/the list isn't valid/)).toBeNull();
    const every = await everyCard();
    expect(within(every).queryByText(S.listChoose(SETTING_LABELS.NEW_SEARCH_DISCOVERY))).toBeNull();
    await user.click(within(every).getByRole('button', { name: S.listUseDefault }));
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { NEW_SEARCH_VERIFICATION: null } }]);
  });

  it('a billing day the app set aside has its field on the trial plan', async () => {
    serveView({
      setAside: ['SEARCHAPI_BILLING_DAY'],
      values: { ...settingsView().values, SEARCHAPI_BILLING_DAY: '31' },
    });
    open();
    const card = await searchApiCard();
    expect(within(card).getByRole('combobox', { name: SETTING_LABELS.SEARCHAPI_PLAN })).toHaveValue('trial');
    const day = within(card).getByRole('spinbutton', { name: SETTING_LABELS.SEARCHAPI_BILLING_DAY });
    expect(day).toHaveAccessibleDescription(S.valueSetAside);
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
    await user.click(within(card).getByRole('button', { name: S.replace.SEARCHAPI_KEY }));
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

  /** The page on a restart clock the test steps (no global timer is faked), with one edit ready to save. */
  async function editAndSave(health: ReturnType<typeof serveHealth>) {
    const m = manualClock();
    const view = renderWithProviders(
      <RestartClockContext.Provider value={m.clock}>
        <SettingsView />
      </RestartClockContext.Provider>,
      { search: '?view=settings' },
    );
    const field = await patience();
    await view.user.clear(field);
    await view.user.type(field, '20');
    await view.user.click(saveButton());
    expect(await screen.findByText(S.restarting)).toBeInTheDocument();
    // the boot id was read before the save; the watch has set its limit and its first poll
    expect(health.seen.reads).toBe(1);
    await m.scheduled(2);
    return { ...view, m };
  }

  it('says "Restarting the app…" until /api/health answers a new boot id, through a spell of no answer', async () => {
    const puts = capturePuts();
    const health = serveHealth(['boot-1', 'boot-1', 'down', 'boot-2']);
    const { m } = await editAndSave(health);
    expect(puts).toHaveLength(1);
    for (const n of [2, 3]) {
      act(() => m.advance(RESTART_POLL_MS));
      await health.read(n);
      // the next poll is set only once this read has settled, and it was not a new boot id
      await m.scheduled(n + 1);
      expect(screen.getByText(S.restarting)).toBeInTheDocument();
    }
    act(() => m.advance(RESTART_POLL_MS));
    await health.read(4);
    expect(await screen.findByText(S.restarted)).toBeInTheDocument();
    // the watch is over: nothing is left to ask again
    expect(m.pending()).toBe(0);
    expect(health.seen.reads).toBe(4);
  });

  it('after 60 s with no new boot id it says the app did not come back, and stops asking', async () => {
    capturePuts();
    const health = serveHealth(['boot-1']);
    const { m } = await editAndSave(health);
    act(() => m.advance(RESTART_LIMIT_MS - 1));
    expect(screen.getByText(S.restarting)).toBeInTheDocument();
    act(() => m.advance(1));
    expect(screen.getByText("The app didn't come back: run pnpm gmt status")).toBeInTheDocument();
    expect(m.pending()).toBe(0);
  });

  it('a save the app holds for running searches says Restarted only once /api/health answers a new boot id, with no time limit; a settings read without pending is not the restart (review M6)', async () => {
    let pending: { running: string[] } | null = null;
    server.use(http.get(`${API}/settings`, () => HttpResponse.json(settingsView({ pending }))));
    server.use(
      http.put(`${API}/settings`, () => {
        pending = { running: ['London → New York'] };
        return HttpResponse.json({ warnings: [], applies: 'after-runs', running: ['London → New York'] });
      }),
    );
    let providerReads = 0;
    server.use(
      http.get(`${API}/providers`, () => {
        providerReads += 1;
        return HttpResponse.json(providersResponse());
      }),
    );
    // why: more polls than the 60 s the restart at once is given, all on the old boot id, then the new one
    const polls = RESTART_LIMIT_MS / RESTART_POLL_MS + 2;
    const health = serveHealth(Array<string>(polls + 2).fill('boot-1'));
    const m = manualClock();
    const { user, client } = renderWithProviders(
      <RestartClockContext.Provider value={m.clock}>
        <SettingsView />
      </RestartClockContext.Provider>,
      { search: '?view=settings' },
    );
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    const waiting = 'Saved. Applies when London → New York finish; new searches wait until then.';
    expect(await screen.findByText(waiting)).toBeInTheDocument();
    const r0 = health.seen.reads;
    // only the first poll is set: no limit
    await m.scheduled(1);
    expect(m.pending()).toBe(1);
    // a settings read answered while the app closes has no pending: that is not the restart
    pending = null;
    await act(() => client.refetchQueries({ queryKey: SETTINGS_KEY }));
    expect(screen.queryByText(S.restarted)).toBeNull();
    expect(screen.getByText(waiting)).toBeInTheDocument();
    for (let k = 1; k <= polls; k++) {
      act(() => m.advance(RESTART_POLL_MS));
      await health.read(r0 + k);
      await m.scheduled(k + 1);
    }
    // past the restart's own 60 s, still waiting for the runs, never "didn't come back"
    expect(screen.getByText(waiting)).toBeInTheDocument();
    expect(screen.queryByText(S.notBack)).toBeNull();
    const before = providerReads;
    // the runs end and the app restarts: the next poll answers the new boot id
    const back = serveHealth(['boot-2']);
    act(() => m.advance(RESTART_POLL_MS));
    await back.read(1);
    expect(await screen.findByText(S.restarted)).toBeInTheDocument();
    expect(screen.queryByText(waiting)).toBeNull();
    expect(m.pending()).toBe(0);
    await settled(client);
    expect(providerReads).toBeGreaterThan(before);
  });

  it('a save that makes the app read a refused .env line names the line, and nothing is restarted (review M7)', async () => {
    capturePuts(
      {
        error: {
          code: 'invalid_env',
          message: 'nothing was saved',
          details: { lines: ['SEARCHAPI_MONTHLY_CALL_CAP'] },
        },
      },
      422,
    );
    const health = serveHealth(['boot-1']);
    const m = manualClock();
    const { user } = renderWithProviders(
      <RestartClockContext.Provider value={m.clock}>
        <SettingsView />
      </RestartClockContext.Provider>,
      { search: '?view=settings' },
    );
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    const words = S.envLine(['SEARCHAPI_MONTHLY_CALL_CAP']);
    expect(words).toBe(
      "Nothing was saved: SEARCHAPI_MONTHLY_CALL_CAP in .env isn't valid with these settings. Fix the line in .env and restart the app so it reads .env again (pnpm gmt restart, or docker compose up -d in Docker), then save again.",
    );
    expect(await screen.findByText(words)).toHaveClass('st-bad');
    expect(health.seen.reads).toBe(1);
    // why: no restart watch is set, so a poll interval later the pre-save read is still the only one
    expect(m.pending()).toBe(0);
    act(() => m.advance(RESTART_POLL_MS));
    expect(health.seen.reads).toBe(1);
    expect(S.envLine([])).toBe("Nothing was saved: a line in .env isn't valid with these settings.");
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

  it('a field changed while its save is out keeps the new text, still marked unsaved', async () => {
    let reached: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let answer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const puts: unknown[] = [];
    server.use(
      http.put(`${API}/settings`, async ({ request }) => {
        puts.push(await request.json());
        reached();
        await gate;
        return HttpResponse.json({ warnings: [], applies: 'now' });
      }),
    );
    serveHealth(['boot-1']);
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    await arrived;
    await user.clear(field);
    await user.type(field, '25');
    answer();
    expect(await screen.findByText(S.restarting)).toBeInTheDocument();
    expect(puts).toEqual([{ changes: { FLIGHT_READ_PATIENCE: '20' } }]);
    expect(await patience()).toHaveValue(25);
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { name: 'Price sources · unsaved' })).toBeInTheDocument();
  });

  it('a save held for running searches is still said on System, which has no Save bar', async () => {
    let pending: { running: string[] } | null = null;
    server.use(http.get(`${API}/settings`, () => HttpResponse.json(settingsView({ pending }))));
    server.use(
      http.put(`${API}/settings`, () => {
        pending = { running: ['London → New York'] };
        return HttpResponse.json({ warnings: [], applies: 'after-runs', running: ['London → New York'] });
      }),
    );
    serveHealth(['boot-1']);
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    const waiting = 'Saved. Applies when London → New York finish; new searches wait until then.';
    expect(await screen.findByText(waiting)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('navigation', { name: S.sectionsLabel })).getByRole('link', { name: 'System' }),
    );
    expect(await screen.findByText(waiting)).toBeInTheDocument();
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

describe('Replace names what it replaces (revision 74)', () => {
  it('a saved key says "Replace key" and a saved token "Replace token", as its accessible name too', async () => {
    open();
    const key = within(await searchApiCard()).getByRole('button', { name: 'Replace key' });
    expect(key).toHaveTextContent('Replace key');
    const token = within(await cacheCard()).getByRole('button', { name: 'Replace token' });
    expect(token).toHaveTextContent('Replace token');
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
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
    // why: the balance's age is judged on the page's clock, which renderWithProviders pins at 15:00, two minutes after
    // the read
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

  it('a failed providers or budget read still shows SearchApi’s own balance, never nothing', async () => {
    account(412);
    server.use(
      http.get(`${API}/providers`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    open();
    const card = await searchApiCard();
    expect(await within(card).findByText(S.credits(412, null))).toBeInTheDocument();
  });

  it('a failed budget read with no balance read says the balance could not be read, never nothing', async () => {
    server.use(
      http.get(`${API}/budget`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    open();
    const card = await searchApiCard();
    expect(await within(card).findByText(S.balanceUnread)).toBeInTheDocument();
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
    const { client } = open();
    const card = await searchApiCard();
    // why: every read has answered, the balance's included, before its absence is checked
    await settled(client);
    expect(within(card).getByText(S.secretSetAside)).toBeInTheDocument();
    expect(within(card).queryByText(S.secretNotSet)).toBeNull();
    expect(within(card).queryByText(S.searchapiNoKey)).toBeNull();
    const input = within(card).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    // the note describes the field it is about (fix round 1, minor 5)
    expect(input).toHaveAccessibleDescription(expect.stringContaining(S.secretSetAside));
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

describe('fix round 1', () => {
  it('a refused calendar list is said in each card whose control writes it, and describes those controls (important 1)', async () => {
    const words = 'Choose calendar sources this app has set up, or none.';
    capturePuts(
      {
        error: {
          code: 'invalid_settings',
          message: 'nothing was saved',
          details: { fields: [{ field: 'NEW_SEARCH_DISCOVERY', message: words }] },
        },
      },
      422,
    );
    const { user } = open();
    await user.click(switchOf(await cacheCard(), COPY.newSearch.source.travelpayouts));
    await user.click(saveButton());
    expect(await screen.findByText(S.refused)).toBeInTheDocument();
    const cards = [
      [await browserCard(), COPY.newSearch.source.camoufox],
      [await cacheCard(), COPY.newSearch.source.travelpayouts],
      [await searchApiCard(), COPY.newSearch.source.searchapi],
    ] as const;
    for (const [card, name] of cards) {
      expect(within(card).getByText(words)).toBeInTheDocument();
      expect(switchOf(card, name)).toHaveAccessibleDescription(words);
    }
    const sa = await searchApiCard();
    expect(
      within(sa).getByRole('checkbox', { name: `${S.discoveryBox} ${S.discoveryBoxNote}` }),
    ).toHaveAccessibleDescription(words);
    // the trip check box writes the other list, which was not refused
    expect(within(sa).getByRole('checkbox', { name: S.verificationBox })).toHaveAccessibleDescription('');
  });

  it('a refused trip check list is said only in SearchApi’s card, on its switch and its first box', async () => {
    const words = 'Choose trip check sources this app has set up, or none.';
    capturePuts(
      {
        error: {
          code: 'invalid_settings',
          message: 'nothing was saved',
          details: { fields: [{ field: 'NEW_SEARCH_VERIFICATION', message: words }] },
        },
      },
      422,
    );
    const { user } = open();
    const sa = await searchApiCard();
    await user.click(switchOf(sa, COPY.newSearch.source.searchapi));
    await user.click(saveButton());
    await screen.findByText(S.refused);
    expect(screen.getAllByText(words)).toHaveLength(1);
    expect(switchOf(sa, COPY.newSearch.source.searchapi)).toHaveAccessibleDescription(words);
    expect(within(sa).getByRole('checkbox', { name: S.verificationBox })).toHaveAccessibleDescription(words);
    expect(switchOf(await cacheCard(), COPY.newSearch.source.travelpayouts)).toHaveAccessibleDescription('');
  });

  it('a key typed into one field stays, and is sent later, when another key is removed (minor 3)', async () => {
    const KEY = 'sk-test-kept-0123456789abcdef';
    const { bodies: puts, reached } = capturePutEvents();
    const { user } = open();
    const sa = await searchApiCard();
    await user.click(within(sa).getByRole('button', { name: S.replace.SEARCHAPI_KEY }));
    await user.type(within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' }), KEY);
    const cache = await cacheCard();
    await user.click(within(cache).getByRole('button', { name: S.remove }));
    await user.click(within(cache).getByRole('button', { name: S.confirmRemoveYes }));
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { TRAVELPAYOUTS_TOKEN: null } }]);
    const field = within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' });
    expect(field).toHaveProperty('value', KEY);
    await user.click(saveButton());
    await reached(2);
    expect(puts[1]).toEqual({ changes: { SEARCHAPI_KEY: KEY } });
  });

  it('a typed key is never in the markup while it is typed: the field is uncontrolled (minor 10)', async () => {
    const KEY = 'sk-test-typing-0123456789abcdef';
    const { user, container } = open();
    const sa = await searchApiCard();
    await user.click(within(sa).getByRole('button', { name: S.replace.SEARCHAPI_KEY }));
    const field = within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' });
    await user.type(field, KEY);
    expect(field).toHaveProperty('value', KEY);
    expect(field.outerHTML).not.toContain(KEY);
    expect(container.innerHTML).not.toContain(KEY);
    expect(field).not.toHaveAttribute('value');
  });

  it('a typed key survives a section switch: shown again as the field’s value, never in the markup, and sent (fix round 2)', async () => {
    const KEY = 'sk-test-switch-0123456789abcdef';
    const { bodies: puts, reached } = capturePutEvents();
    const { user, container } = open();
    let sa = await searchApiCard();
    await user.click(within(sa).getByRole('button', { name: S.replace.SEARCHAPI_KEY }));
    await user.type(within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' }), KEY);
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: 'Limits' }));
    await screen.findByRole('heading', { level: 2, name: 'Limits' });
    await user.click(within(nav).getByRole('link', { name: 'Price sources · unsaved' }));
    sa = await searchApiCard();
    const field = within(sa).getByLabelText(SETTING_LABELS.SEARCHAPI_KEY, { selector: 'input' });
    expect(field).toHaveProperty('value', KEY);
    expect(field.outerHTML).not.toContain(KEY);
    expect(container.innerHTML).not.toContain(KEY);
    await user.click(saveButton());
    await reached(1);
    expect(puts).toEqual([{ changes: { SEARCHAPI_KEY: KEY } }]);
  });

  it('an error answer is said in the page’s words, never the api’s message (minor 9)', async () => {
    capturePuts({ error: { code: 'internal', message: 'internal error 7f3a: database is locked' } }, 500);
    const { user } = open();
    const field = await patience();
    await user.clear(field);
    await user.type(field, '20');
    await user.click(saveButton());
    expect(await screen.findByText(S.failed)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('database is locked');
  });

  it('a save answered after the page has gone starts no restart watch (minor 8)', async () => {
    const m = manualClock();
    let reached: () => void = () => undefined;
    const putReached = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.put(`${API}/settings`, async () => {
        reached();
        await gate;
        return HttpResponse.json({ warnings: [], applies: 'now' });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <RestartClockContext.Provider value={m.clock}>{children}</RestartClockContext.Provider>
      </QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useSettingsForm(settingsView()), { wrapper });
    const saving = result.current.save('sources', { FLIGHT_READ_PATIENCE: '20' });
    await putReached;
    unmount();
    release();
    await saving;
    expect(m.sets()).toBe(0);
  });
});
