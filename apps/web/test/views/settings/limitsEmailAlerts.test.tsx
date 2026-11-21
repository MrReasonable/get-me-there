// Settings › Limits and Settings › Email and alerts (UX redesign stage 3; settings plan rulings 5, 11, 12 and 14): the
// spend limit typed in pounds and saved in pence through core's poundsToPence, the credits a new search starts with,
// the month's spend from /budget, a save's fees warning; email by Gmail or another mail server, a stored Gmail opening
// as Gmail, the test email's every answer, Remove email unsetting the seven names; the alert rules with their last
// send, Edit, Delete confirmed in the page and both empty states. Synthetic passwords; example.com addresses; London →
// New York only.
import { apiContract, SETTING_LABELS, settingRefusal } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { HttpResponse, http, type JsonBodyType } from 'msw';
import { describe, expect, it } from 'vitest';
import { SETUP_COPY } from '../../../src/copy/setup.js';
import { COPY } from '../../../src/copy.js';
import { describeRule } from '../../../src/views/Alerts/ruleText.js';
import { SettingsView } from '../../../src/views/Settings/SettingsView.js';
import { API, budgetResponse, definition, providersResponse, settingsView, usage } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders, settled } from '../../render.js';

const S = COPY.settingsView;
const L = COPY.settingsView.limits;
const E = COPY.settingsView.email;
const A = COPY.settingsView.alerts;

type View = Parameters<typeof settingsView>[0];
type Values = Partial<Record<apiContract.PlainSettingName, string | null>>;
/** The stored view with these plain values (every other one unset) and the mail password set or not. */
const viewWith = (values: Values, passSet = false, over: View = {}) =>
  settingsView({
    values: apiContract.settingsViewSchema.shape.values.parse({
      ...Object.fromEntries(apiContract.PLAIN_SETTING_NAMES.map((n) => [n, null])),
      ...values,
    }),
    secrets: {
      TRAVELPAYOUTS_TOKEN: { set: true, last4: '91c0' },
      SEARCHAPI_KEY: { set: true, last4: '3f2a' },
      SMTP_PASS: { set: passSet, last4: null },
    },
    ...over,
  });
const serveValues = (values: Values, passSet = false, over: View = {}) =>
  server.use(http.get(`${API}/settings`, () => HttpResponse.json(viewWith(values, passSet, over))));

/** Every PUT /settings body, answered with `answer` (a save that restarts at once by default). */
function capturePuts(answer: JsonBodyType = { warnings: [], applies: 'now' }) {
  const bodies: unknown[] = [];
  server.use(
    http.put(`${API}/settings`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(answer);
    }),
  );
  return bodies;
}

/** Every POST /settings/email-test body, answered with `status` and `body`. */
function captureTests(status: number, body: JsonBodyType) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/settings/email-test`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(body, { status });
    }),
  );
  return bodies;
}

const open = (section: 'limits' | 'email') =>
  renderWithProviders(<SettingsView />, { search: `?view=settings&section=${section}` });

const GMAIL = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '465',
  SMTP_TLS: 'implicit',
  SMTP_USER: 'traveller@example.com',
  ALERT_EMAIL_FROM: 'traveller@example.com',
  ALERT_EMAIL_TO: 'alerts@example.com',
} as const;
const OTHER = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_TLS: 'starttls',
  SMTP_USER: 'mailer',
  ALERT_EMAIL_FROM: 'flights@example.com',
  ALERT_EMAIL_TO: 'alerts@example.com',
} as const;

describe('Settings › Limits (rulings 5 and 14)', () => {
  const spend = () => screen.findByRole('textbox', { name: SETTING_LABELS.MONTHLY_SPEND_CAP_PENCE });
  const credits = () => screen.findByRole('spinbutton', { name: SETTING_LABELS.EXECUTION_MAX_CALLS });
  const save = () => screen.getByRole('button', { name: S.saveLabel.limits });

  it('"Spend at most £[35] a month" and "New searches: at most [10] SearchApi credits each run", from the stored values', async () => {
    serveValues({ MONTHLY_SPEND_CAP_PENCE: '3550', EXECUTION_MAX_CALLS: '10' });
    open('limits');
    const field = await spend();
    expect(field).toHaveValue('35.50');
    expect(field.closest('p')).toHaveTextContent(`${L.spendBefore} ${L.spendAfter}`);
    expect(L.spendBefore).toBe('Spend at most £');
    const calls = await credits();
    expect(calls).toHaveValue(10);
    expect(calls.closest('p')).toHaveTextContent(`${L.creditsBefore} ${L.creditsAfter}`);
  });

  it('unset, each shows the value in use: the cap from /budget, the credits from the new-search presets', async () => {
    // why: neither is a default the page could show without reading it: £27.50 and 750 credits come only from the api
    const base = providersResponse();
    server.use(
      http.get(`${API}/budget`, () => HttpResponse.json(budgetResponse({ monthlyCapPence: 2750 }))),
      http.get(`${API}/providers`, () =>
        HttpResponse.json(
          providersResponse({
            presets: { ...base.presets, budget: { ...base.presets.budget, maxCalls: 750 } },
          }),
        ),
      ),
    );
    const puts = capturePuts();
    const { user, client } = open('limits');
    expect(await spend()).toHaveValue('27.50');
    expect(await credits()).toHaveValue(750);
    // the value in use is no edit, so nothing is sent
    await user.click(save());
    expect(await screen.findByText(S.unchanged)).toBeInTheDocument();
    await settled(client);
    expect(puts).toEqual([]);
  });

  it.each([
    ['0.29', '29'],
    ['1.15', '115'],
    ['35.55', '3555'],
    ['35', '3500'],
  ])('£%s is saved as %s pence (core poundsToPence, never a float)', async (typed, pence) => {
    serveValues({ MONTHLY_SPEND_CAP_PENCE: '4000' });
    const puts = capturePuts();
    const { user } = open('limits');
    const field = await spend();
    await user.clear(field);
    await user.type(field, typed);
    await user.click(save());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { MONTHLY_SPEND_CAP_PENCE: pence } }]);
  });

  it.each(['-1', '1.234', '£5', '12abc'])(
    '"%s" is refused in the page beside its field, and nothing is sent',
    async (typed) => {
      serveValues({ MONTHLY_SPEND_CAP_PENCE: '4000' });
      const puts = capturePuts();
      const { user, client } = open('limits');
      const field = await spend();
      await user.clear(field);
      await user.type(field, typed);
      // the section has an edit not saved
      const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
      expect(within(nav).getByRole('link', { name: 'Limits · unsaved' })).toBeInTheDocument();
      await user.click(save());
      expect(await screen.findByText(S.refused)).toBeInTheDocument();
      // the words the api would give (core settingRefusal), so the page and the api say one thing; the ✕ beside
      // them is for the eye only
      expect(field).toHaveAccessibleDescription(
        settingRefusal('MONTHLY_SPEND_CAP_PENCE', { field: 'MONTHLY_SPEND_CAP_PENCE', message: '' }),
      );
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveValue(typed);
      await settled(client);
      expect(puts).toEqual([]);
    },
  );

  it('an emptied spend limit is saved as unset, so the plan’s limit applies', async () => {
    serveValues({ MONTHLY_SPEND_CAP_PENCE: '4000' });
    const puts = capturePuts();
    const { user } = open('limits');
    await user.clear(await spend());
    await user.click(save());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { MONTHLY_SPEND_CAP_PENCE: null } }]);
  });

  it('the credits a new search starts with are saved as typed', async () => {
    serveValues({ EXECUTION_MAX_CALLS: '10' });
    const puts = capturePuts();
    const { user } = open('limits');
    const field = await credits();
    await user.clear(field);
    await user.type(field, '25');
    await user.click(save());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([{ changes: { EXECUTION_MAX_CALLS: '25' } }]);
  });

  it('the api’s refusal sits beside its field', async () => {
    server.use(
      http.put(`${API}/settings`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_settings',
              message: 'refused',
              details: { fields: [{ field: 'EXECUTION_MAX_CALLS', message: 'Give a whole number.' }] },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const { user } = open('limits');
    const field = await credits();
    await user.clear(field);
    await user.type(field, '7');
    await user.click(save());
    expect(await screen.findByText(S.refused)).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription('Give a whole number.');
  });

  it('"£0 spent this month" from /budget, and the month’s spend when there is some', async () => {
    server.use(
      http.get(`${API}/budget`, () =>
        HttpResponse.json(budgetResponse({ scopes: [usage('global-month', 0, 35_000_000, 0)] })),
      ),
    );
    open('limits');
    const line = await screen.findByText(L.spent('£0'));
    expect(line.closest('[data-cost]')).not.toBeNull();
  });

  it('£32 spent of the month', async () => {
    open('limits');
    expect(await screen.findByText(L.spent('£32'))).toBeInTheDocument();
  });

  it('the save’s fees warning is shown after it', async () => {
    const warning =
      "The monthly spend limit (£10) is below the £35 of subscription fees it counts, so it cannot stop a check: SearchApi's credits are the hard stop.";
    serveValues({ MONTHLY_SPEND_CAP_PENCE: '4000' });
    capturePuts({ warnings: [warning], applies: 'now' });
    const { user } = open('limits');
    const field = await spend();
    await user.clear(field);
    await user.type(field, '10');
    await user.click(save());
    const status = (await screen.findByText(S.restarting)).closest('[role="status"]');
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent(warning);
  });

  it('a typed spend survives a switch to Email and back', async () => {
    serveValues({ MONTHLY_SPEND_CAP_PENCE: '4000' });
    const { user } = open('limits');
    const field = await spend();
    await user.clear(field);
    await user.type(field, '12.5');
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: S.section.email }));
    await screen.findByRole('heading', { level: 2, name: S.section.email });
    await user.click(within(nav).getByRole('link', { name: 'Limits · unsaved' }));
    expect(await spend()).toHaveValue('12.5');
  });

  it('a new search’s SearchApi limit points at Settings › Limits, not at an env file', () => {
    const D = SETUP_COPY.definitions;
    for (const words of [D.maxCallsHint, D.maxCallsZero]) {
      expect(words).toContain('New searches start from the limit in Settings › Limits');
      expect(words).not.toMatch(/EXECUTION_MAX_CALLS|\.env/);
    }
  });
});

describe('Settings › Email (ruling 11)', () => {
  const mode = (name: string) => screen.findByRole('radio', { name });
  const gmailAddress = () => screen.findByRole('textbox', { name: E.gmailAddress });
  const save = () => screen.getByRole('button', { name: S.saveLabel.email });
  const testButton = () => screen.getByRole('button', { name: E.sendTest });
  const passwordField = () => screen.getByLabelText(E.appPassword, { selector: 'input' });

  it('nothing stored: Gmail is chosen; the address, app password and send-to fill the names on save (encryption stays its default)', async () => {
    const puts = capturePuts();
    const { user } = open('email');
    expect(await mode(E.modeGmail)).toBeChecked();
    expect(screen.getByRole('group', { name: E.sendWith })).toBeInTheDocument();
    await user.type(await gmailAddress(), 'traveller@example.com');
    await user.type(passwordField(), 'abcd-efgh-ijkl-mnop');
    await user.type(
      screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO }),
      'alerts@example.com',
    );
    await user.click(save());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([
      {
        changes: {
          SMTP_HOST: 'smtp.gmail.com',
          SMTP_PORT: '465',
          SMTP_USER: 'traveller@example.com',
          SMTP_PASS: 'abcd-efgh-ijkl-mnop',
          ALERT_EMAIL_TO: 'alerts@example.com',
          ALERT_EMAIL_FROM: 'traveller@example.com',
        },
      },
    ]);
  });

  it('a stored smtp.gmail.com opens as Gmail, the address shown and the password only as saved', async () => {
    serveValues(GMAIL, true);
    open('email');
    expect(await mode(E.modeGmail)).toBeChecked();
    expect(await gmailAddress()).toHaveValue('traveller@example.com');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO })).toHaveValue(
      'alerts@example.com',
    );
    expect(screen.getByText(S.secretSaved)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toBeNull();
  });

  it('a Gmail server name the app set aside opens as Other mail server, where it has its field and the note (review I3)', async () => {
    serveValues({ ...GMAIL, SMTP_PORT: '0' }, true, { setAside: ['SMTP_PORT'] });
    open('email');
    expect(await mode(E.modeOther)).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: SETTING_LABELS.SMTP_PORT })).toHaveAccessibleDescription(
      S.valueSetAside,
    );
  });

  it('another stored server opens as Other mail server, each name in its field', async () => {
    serveValues(OTHER, true);
    open('email');
    expect(await mode(E.modeOther)).toBeChecked();
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toHaveValue('smtp.example.com');
    expect(screen.getByRole('spinbutton', { name: SETTING_LABELS.SMTP_PORT })).toHaveValue(587);
    expect(screen.getByRole('combobox', { name: SETTING_LABELS.SMTP_TLS })).toHaveValue('starttls');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_USER })).toHaveValue('mailer');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_FROM })).toHaveValue(
      'flights@example.com',
    );
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO })).toHaveValue(
      'alerts@example.com',
    );
    expect(screen.queryByRole('textbox', { name: E.gmailAddress })).toBeNull();
  });

  it('switching another server to Gmail fills the server’s names; the user and sender become the address', async () => {
    serveValues(OTHER, true);
    const puts = capturePuts();
    const { user } = open('email');
    await user.click(await mode(E.modeGmail));
    const address = await gmailAddress();
    await user.clear(address);
    await user.type(address, 'traveller@example.com');
    await user.click(save());
    await screen.findByText(S.restarting);
    expect(puts).toEqual([
      {
        changes: {
          SMTP_HOST: 'smtp.gmail.com',
          SMTP_PORT: '465',
          SMTP_USER: 'traveller@example.com',
          ALERT_EMAIL_FROM: 'traveller@example.com',
          SMTP_TLS: 'implicit',
        },
      },
    ]);
  });

  it('switching a stored Gmail to Other empties the server name to be typed, and back again is no change', async () => {
    serveValues(GMAIL, true);
    const puts = capturePuts();
    const { user, client } = open('email');
    await user.click(await mode(E.modeOther));
    const host = screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST });
    expect(host).toHaveValue('');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_USER })).toHaveValue(
      'traveller@example.com',
    );
    await user.click(await mode(E.modeGmail));
    expect(await gmailAddress()).toHaveValue('traveller@example.com');
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { name: S.section.email })).toBeInTheDocument();
    await user.click(save());
    expect(await screen.findByText(S.unchanged)).toBeInTheDocument();
    await settled(client);
    expect(puts).toEqual([]);
  });

  it('the section’s one Save reads "Save email" (fix round 1, R15)', async () => {
    open('email');
    await gmailAddress();
    expect(save()).toHaveTextContent('Save email');
  });

  it('another server to Gmail and back again is no change: every name is as it was, nothing unsaved (fix round 1)', async () => {
    serveValues(OTHER, true);
    const puts = capturePuts();
    const { user, client } = open('email');
    await user.click(await mode(E.modeGmail));
    await gmailAddress();
    await user.click(await mode(E.modeOther));
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toHaveValue('smtp.example.com');
    expect(screen.getByRole('spinbutton', { name: SETTING_LABELS.SMTP_PORT })).toHaveValue(587);
    expect(screen.getByRole('combobox', { name: SETTING_LABELS.SMTP_TLS })).toHaveValue('starttls');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_USER })).toHaveValue('mailer');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_FROM })).toHaveValue(
      'flights@example.com',
    );
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    expect(within(nav).getByRole('link', { name: S.section.email })).toBeInTheDocument();
    await user.click(save());
    expect(await screen.findByText(S.unchanged)).toBeInTheDocument();
    await settled(client);
    expect(puts).toEqual([]);
  });

  it('a server typed on a fresh install is kept across Gmail and back (fix round 1)', async () => {
    const { user } = open('email');
    await user.click(await mode(E.modeOther));
    await user.type(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST }), 'smtp.example.com');
    await user.type(screen.getByRole('spinbutton', { name: SETTING_LABELS.SMTP_PORT }), '587');
    await user.type(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_USER }), 'mailer');
    await user.type(
      screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_FROM }),
      'flights@example.com',
    );
    await user.click(await mode(E.modeGmail));
    await gmailAddress();
    await user.click(await mode(E.modeOther));
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toHaveValue('smtp.example.com');
    expect(screen.getByRole('spinbutton', { name: SETTING_LABELS.SMTP_PORT })).toHaveValue(587);
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_USER })).toHaveValue('mailer');
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_FROM })).toHaveValue(
      'flights@example.com',
    );
  });

  it('after a Gmail save, back to Other does not put the edits from before Gmail over the saved server', async () => {
    capturePuts();
    const { user } = open('email');
    await user.click(await mode(E.modeOther));
    await user.type(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST }), 'smtp.example.com');
    await user.click(await mode(E.modeGmail));
    await user.type(await gmailAddress(), 'traveller@example.com');
    await user.type(passwordField(), 'abcd-efgh-ijkl-mnop');
    await user.type(
      screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO }),
      'alerts@example.com',
    );
    await user.click(save());
    await screen.findByText(S.restarting);
    await user.click(await mode(E.modeOther));
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).not.toHaveValue(
      'smtp.example.com',
    );
  });

  it('a save of Limits between Gmail and back keeps the Other edits from before Gmail', async () => {
    capturePuts();
    const { user } = open('email');
    await user.click(await mode(E.modeOther));
    await user.type(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST }), 'smtp.example.com');
    await user.click(await mode(E.modeGmail));
    await gmailAddress();
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: S.section.limits }));
    const spendField = await screen.findByRole('textbox', { name: SETTING_LABELS.MONTHLY_SPEND_CAP_PENCE });
    await user.clear(spendField);
    await user.type(spendField, '12');
    await user.click(screen.getByRole('button', { name: S.saveLabel.limits }));
    await screen.findByText(S.restarting);
    await user.click(within(nav).getByRole('link', { name: `${S.section.email} · unsaved` }));
    await user.click(await mode(E.modeOther));
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toHaveValue('smtp.example.com');
  });

  it('a test email’s refusal joins a save’s, never wiping it (fix round 1, minor 4)', async () => {
    serveValues(GMAIL, true);
    server.use(
      http.put(`${API}/settings`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_settings',
              message: 'refused',
              details: {
                fields: [
                  { field: 'ALERT_EMAIL_TO', message: 'Give one email address, like you@example.com.' },
                ],
              },
            },
          },
          { status: 422 },
        ),
      ),
    );
    captureTests(422, {
      error: {
        code: 'invalid_settings',
        message: 'refused',
        details: {
          fields: [{ field: 'SMTP_PASS', message: 'Give the password the mail server signs in with.' }],
        },
      },
    });
    const { user } = open('email');
    await gmailAddress();
    const to = screen.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO });
    await user.clear(to);
    await user.type(to, 'nobody');
    await user.click(save());
    expect(await screen.findByText(S.refused)).toBeInTheDocument();
    await user.click(testButton());
    expect(await screen.findByText(E.testRefused)).toBeInTheDocument();
    expect(to).toHaveAccessibleDescription('Give one email address, like you@example.com.');
    expect(passwordField()).toHaveAccessibleDescription(
      expect.stringContaining('Give the password the mail server signs in with.'),
    );
  });

  it('the mode chosen survives a switch to Limits and back', async () => {
    serveValues(GMAIL, true);
    const { user } = open('email');
    await user.click(await mode(E.modeOther));
    await user.type(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST }), 'smtp.example.com');
    const nav = screen.getByRole('navigation', { name: S.sectionsLabel });
    await user.click(within(nav).getByRole('link', { name: S.section.limits }));
    await screen.findByRole('heading', { level: 2, name: S.section.limits });
    await user.click(within(nav).getByRole('link', { name: `${S.section.email} · unsaved` }));
    expect(await mode(E.modeOther)).toBeChecked();
    expect(screen.getByRole('textbox', { name: SETTING_LABELS.SMTP_HOST })).toHaveValue('smtp.example.com');
  });

  it('a typed password is never in the markup', async () => {
    const { user, container } = open('email');
    await gmailAddress();
    const secret = 'synthetic-mail-pass-123';
    await user.type(passwordField(), secret);
    // why: the field holds what was typed, so its absence from the markup below is not an empty field's
    expect(passwordField()).toHaveValue(secret);
    expect(passwordField()).toHaveAttribute('type', 'password');
    expect(passwordField()).toHaveAttribute('autocomplete', 'new-password');
    expect(container.innerHTML).not.toContain(secret);
  });

  it('a refused name sits beside the Gmail field that writes it', async () => {
    server.use(
      http.put(`${API}/settings`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_settings',
              message: 'refused',
              details: {
                fields: [
                  { field: 'ALERT_EMAIL_FROM', message: 'Give one email address, like you@example.com.' },
                ],
              },
            },
          },
          { status: 422 },
        ),
      ),
    );
    serveValues(GMAIL, true);
    const { user } = open('email');
    const address = await gmailAddress();
    await user.clear(address);
    await user.type(address, 'not an address');
    await user.click(save());
    expect(await screen.findByText(S.refused)).toBeInTheDocument();
    expect(address).toHaveAccessibleDescription('Give one email address, like you@example.com.');
  });

  describe('the test email', () => {
    it('sends the form’s values, without a password when none is typed, and says it was sent', async () => {
      serveValues(GMAIL, true);
      const tests = captureTests(200, { result: 'sent', at: '2026-10-14T12:00:00.000Z' });
      const { user } = open('email');
      await gmailAddress();
      await user.click(testButton());
      expect(await screen.findByText(E.testSent('alerts@example.com'))).toBeInTheDocument();
      expect(tests).toEqual([
        {
          host: 'smtp.gmail.com',
          port: 465,
          tls: 'implicit',
          user: 'traveller@example.com',
          from: 'traveller@example.com',
          to: 'alerts@example.com',
        },
      ]);
    });

    it('carries a typed password and another server’s values', async () => {
      serveValues(OTHER, true);
      const tests = captureTests(200, { result: 'sent', at: '2026-10-14T12:00:00.000Z' });
      const { user } = open('email');
      await mode(E.modeOther);
      await user.click(screen.getByRole('button', { name: S.replace }));
      await user.type(
        screen.getByLabelText(SETTING_LABELS.SMTP_PASS, { selector: 'input' }),
        'other-pass-123',
      );
      await user.click(testButton());
      await screen.findByText(E.testSent('alerts@example.com'));
      expect(tests).toEqual([
        {
          host: 'smtp.example.com',
          port: 587,
          tls: 'starttls',
          user: 'mailer',
          pass: 'other-pass-123',
          from: 'flights@example.com',
          to: 'alerts@example.com',
        },
      ]);
    });

    it.each(apiContract.emailTestFailureSchema.options)(
      'a failure (%s) is said in its own fixed words, never the server’s',
      async (reason) => {
        serveValues(GMAIL, true);
        captureTests(502, {
          error: { code: 'email_test_failed', message: 'server said 535 5.7.8 nope', details: { reason } },
        });
        const { user } = open('email');
        await gmailAddress();
        await user.click(testButton());
        const words = await screen.findByText(E.testFailed[reason]);
        expect(words.closest('[role="status"]')).not.toBeNull();
        expect(document.body).not.toHaveTextContent('535');
      },
    );

    it('a second test within a minute is told to wait', async () => {
      serveValues(GMAIL, true);
      captureTests(429, { error: { code: 'email_limit', message: 'limited' } });
      const { user } = open('email');
      await gmailAddress();
      await user.click(testButton());
      expect(await screen.findByText(E.testLimited)).toBeInTheDocument();
    });

    it('a refusal (a changed server with no password typed) sits beside its field', async () => {
      serveValues(GMAIL, true);
      captureTests(422, {
        error: {
          code: 'invalid_settings',
          message: 'refused',
          details: {
            fields: [{ field: 'SMTP_PASS', message: 'Give the password the mail server signs in with.' }],
          },
        },
      });
      const { user } = open('email');
      const address = await gmailAddress();
      await user.clear(address);
      await user.type(address, 'someone@example.com');
      await user.click(testButton());
      expect(await screen.findByText(E.testRefused)).toBeInTheDocument();
      expect(passwordField()).toHaveAccessibleDescription(
        expect.stringContaining('Give the password the mail server signs in with.'),
      );
    });

    it('with the server not filled in, nothing is sent and the page says what is missing', async () => {
      const tests = captureTests(200, { result: 'sent', at: '2026-10-14T12:00:00.000Z' });
      const { user, client } = open('email');
      await gmailAddress();
      await user.click(testButton());
      expect(await screen.findByText(E.testIncomplete.gmail)).toBeInTheDocument();
      await settled(client);
      expect(tests).toEqual([]);
    });
  });

  describe('Remove email', () => {
    it('asks in the page first; "Remove it" unsets the seven names at once', async () => {
      serveValues(GMAIL, true);
      const puts = capturePuts();
      const { user } = open('email');
      await gmailAddress();
      await user.click(screen.getByRole('button', { name: E.remove }));
      const confirm = screen.getByRole('group', { name: E.confirmRemove });
      await user.click(within(confirm).getByRole('button', { name: S.confirmRemoveYes }));
      await screen.findByText(S.restarting);
      expect(puts).toEqual([
        {
          changes: {
            SMTP_HOST: null,
            SMTP_PORT: null,
            SMTP_USER: null,
            SMTP_PASS: null,
            ALERT_EMAIL_TO: null,
            ALERT_EMAIL_FROM: null,
            SMTP_TLS: null,
          },
        },
      ]);
    });

    it('"Keep it" sends nothing', async () => {
      serveValues(GMAIL, true);
      const puts = capturePuts();
      const { user, client } = open('email');
      await gmailAddress();
      await user.click(screen.getByRole('button', { name: E.remove }));
      await user.click(screen.getByRole('button', { name: S.confirmRemoveNo }));
      expect(screen.queryByRole('group', { name: E.confirmRemove })).toBeNull();
      await settled(client);
      expect(puts).toEqual([]);
    });

    it('is not offered with no email stored', async () => {
      open('email');
      await gmailAddress();
      expect(screen.queryByRole('button', { name: E.remove })).toBeNull();
    });
  });
});

describe('Settings › Email and alerts: the alert rules (ruling 12)', () => {
  const rule = (over: Record<string, unknown> = {}) =>
    apiContract.alertRuleListedSchema.parse({
      id: 'rule-1',
      definitionId: 'def-0001',
      type: 'absolute',
      thresholdPence: 40000,
      pct: null,
      basis: 'verified',
      requireAllVerified: null,
      cooldownHours: 336,
      enabled: true,
      lastSentAt: null,
      ...over,
    });
  const serveRules = (rules: unknown[]) =>
    server.use(
      http.get(`${API}/alerts`, () => HttpResponse.json(rules)),
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([
          definition({ id: 'def-0001', name: 'London → New York' }),
          definition({ id: 'def-0002', name: 'London → Newark' }),
        ]),
      ),
    );
  const list = () => screen.findByRole('list', { name: A.heading });

  it('each rule in words with its search, when it last sent (the route’s lastSentAt), Edit to the Alerts form and Delete', async () => {
    serveValues(GMAIL, true);
    const one = rule({ lastSentAt: '2026-10-14T12:00:00.000Z' });
    const two = rule({
      id: 'rule-2',
      definitionId: 'def-0002',
      type: 'dropPct',
      thresholdPence: null,
      pct: 10,
    });
    serveRules([one, two]);
    open('email');
    const items = within(await list()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error('two rules');
    expect(first).toHaveTextContent(`London → New York · ${describeRule(one, true)}`);
    expect(first).toHaveTextContent(A.lastSent('14 Oct 2026 13:00'));
    expect(second).toHaveTextContent(`London → Newark · ${describeRule(two, true)}`);
    expect(second).toHaveTextContent(A.lastSent(A.never));
    expect(within(first).getByRole('link', { name: A.edit })).toHaveAttribute(
      'href',
      '/?view=alerts&def=def-0001',
    );
    expect(within(second).getByRole('link', { name: A.edit })).toHaveAttribute(
      'href',
      '/?view=alerts&def=def-0002',
    );
    expect(within(first).getByRole('button', { name: A.delete })).toBeInTheDocument();
    // email is set up, so the list does not say it isn't
    expect(screen.queryByText(A.noEmail)).toBeNull();
  });

  it('a failed read of the searches names each rule’s search neutrally, never as removed (fix round 1, minor 2)', async () => {
    serveValues(GMAIL, true);
    serveRules([rule()]);
    server.use(http.get(`${API}/definitions`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    open('email');
    const [item] = within(await list()).getAllByRole('listitem');
    expect(item).toHaveTextContent(`${A.unnamedSearch} · ${describeRule(rule(), true)}`);
    expect(item).not.toHaveTextContent(A.removedSearch);
  });

  it('a rule switched off says so', async () => {
    serveValues(GMAIL, true);
    serveRules([rule({ enabled: false })]);
    open('email');
    const [item] = within(await list()).getAllByRole('listitem');
    expect(item).toHaveTextContent(A.off);
  });

  it('Delete asks in the page; "Delete it" deletes the rule and the list reads again', async () => {
    serveValues(GMAIL, true);
    serveRules([]);
    // why: the list read after the delete answers a rule the page has not seen (one added elsewhere), so only a fresh
    // read can show it: a page that only dropped the deleted rule locally would show none
    const added = rule({ id: 'rule-2', definitionId: 'def-0002' });
    let rules = [rule()];
    const deleted: string[] = [];
    server.use(
      http.get(`${API}/alerts`, () => HttpResponse.json(rules)),
      http.delete(`${API}/alerts/:id`, ({ params }) => {
        deleted.push(String(params.id));
        const gone = rules[0];
        rules = [added];
        return HttpResponse.json(gone);
      }),
    );
    const { user } = open('email');
    const [item] = within(await list()).getAllByRole('listitem');
    if (item === undefined) throw new Error('one rule');
    await user.click(within(item).getByRole('button', { name: A.delete }));
    const confirm = within(item).getByRole('group', { name: A.confirmDelete('London → New York') });
    expect(deleted).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: A.deleteYes }));
    expect(await within(await list()).findByText(/London → Newark/)).toBeInTheDocument();
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText(/London → New York ·/)).toBeNull();
    expect(deleted).toEqual(['rule-1']);
  });

  it('"Keep it" deletes nothing', async () => {
    serveValues(GMAIL, true);
    serveRules([rule()]);
    const deleted: string[] = [];
    server.use(
      http.delete(`${API}/alerts/:id`, ({ params }) => {
        deleted.push(String(params.id));
        return HttpResponse.json(rule());
      }),
    );
    const { user, client } = open('email');
    const [item] = within(await list()).getAllByRole('listitem');
    if (item === undefined) throw new Error('one rule');
    await user.click(within(item).getByRole('button', { name: A.delete }));
    await user.click(within(item).getByRole('button', { name: A.deleteNo }));
    expect(within(item).queryByRole('group')).toBeNull();
    await settled(client);
    expect(deleted).toEqual([]);
  });

  it('a failed delete says so in words', async () => {
    serveValues(GMAIL, true);
    serveRules([rule()]);
    server.use(http.delete(`${API}/alerts/:id`, () => HttpResponse.json({}, { status: 500 })));
    const { user } = open('email');
    const [item] = within(await list()).getAllByRole('listitem');
    if (item === undefined) throw new Error('one rule');
    await user.click(within(item).getByRole('button', { name: A.delete }));
    await user.click(within(item).getByRole('button', { name: A.deleteYes }));
    expect(await screen.findByText(A.deleteFailed)).toBeInTheDocument();
  });

  it('no rules: alerts come from a search’s page', async () => {
    serveValues(GMAIL, true);
    serveRules([]);
    open('email');
    expect(await screen.findByText(A.none)).toBeInTheDocument();
    expect(screen.queryByText(A.noEmail)).toBeNull();
  });

  it('no email: the rules list says alerts can’t be sent until email is set up', async () => {
    serveRules([rule()]);
    open('email');
    await list();
    expect(screen.getByText(A.noEmail)).toBeInTheDocument();
  });

  it('no email and no rules: both are said', async () => {
    serveRules([]);
    open('email');
    expect(await screen.findByText(A.none)).toBeInTheDocument();
    expect(screen.getByText(A.noEmail)).toBeInTheDocument();
  });
});
