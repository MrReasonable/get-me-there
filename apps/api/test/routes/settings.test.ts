// The Settings page's routes (settings plan rulings 5, 8 and 11; Review Focus 2 and 5). GET gives the stored values and
// never a secret; PUT keeps a secret it does not name, unsets one sent null, refuses a change the schema refuses (422
// with the page's labels and words, nothing written), never echoes a name it does not own, and returns the boot's
// warnings; the email test uses the stored password only for the stored server, refuses before any connection, answers
// a failure in fixed words, and shares its one-a-minute limit with /alerts/test-email. Every body and log line is
// swept for the secrets (expectNoSecrets).
import {
  apiContract,
  asIsoDate,
  fixedClock,
  microGbpToPence,
  type OwnedName,
  SETTING_LABELS,
  Secret,
  SMTP_ALL_OR_NOTHING,
  settingRefusal,
} from '@gmt/core';
import {
  EmailNotifier,
  type MailMessage,
  type SmtpTransportOptions,
  TestSendLimit,
  type TransportFactory,
} from '@gmt/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppOptions } from '../../src/app.js';
import type { ReloadPort } from '../../src/bootstrap/reload.js';
import { newSearchSourcesFor } from '../../src/defaults.js';
import { providerBudget } from '../../src/read/usage.js';
import { API_TEXT } from '../../src/text.js';
import { errorOf, expectContract } from '../helpers/contract.js';
import { silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness, T0 } from '../helpers/harness.js';
import { expectNoSecrets, SETTINGS_SECRETS as S } from '../helpers/secrets.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const ALL_SECRETS = Object.values(S);
const EMAIL = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_TLS: 'implicit',
  SMTP_USER: 'alerts@example.com',
  SMTP_PASS: S.SMTP_PASS,
  ALERT_EMAIL_TO: 'operator@example.com',
  ALERT_EMAIL_FROM: 'alerts@example.com',
};

async function harness(env: Record<string, string> = {}, app: AppOptions = {}): Promise<Harness> {
  h = await createHarness({ env, app });
  return h;
}

type Changes = Partial<Record<OwnedName | 'NOT_A_SETTING', string | null>>;
const put = (x: Harness, changes: Changes) =>
  x.request('/api/settings', { method: 'PUT', json: { changes } });
const view = async (x: Harness) =>
  expectContract(await x.request('/api/settings'), 'GET', '/api/settings', apiContract.settingsViewSchema);
/** Every stored row as the table holds it, value and time, so "nothing written" means byte for byte. */
const rawRows = (x: Harness) =>
  x.ports.db.raw.prepare('SELECT name, value, updated_at FROM settings ORDER BY name').all();
/** The 422's refusals as the page reads them: name, label and words (the envelope's field and message repeat them). */
const refused = z.object({ error: z.object({ details: apiContract.settingsRefusalDetailsSchema }) });
const refusalsOf = async (res: Response) =>
  refused.parse(await res.json()).error.details.fields.map((f) => {
    expect({ field: f.field, message: f.message }).toEqual({ field: f.name, message: f.words });
    return { name: f.name, label: f.label, words: f.words };
  });

describe('GET /api/settings (settings plan ruling 5, 8)', () => {
  it('gives each plain value or null, each secret as set and last four (the two keys only), and the sources', async () => {
    const x = await harness({
      TRAVELPAYOUTS_TOKEN: S.TRAVELPAYOUTS_TOKEN,
      SEARCHAPI_KEY: S.SEARCHAPI_KEY,
      SEARCHAPI_PLAN: '40usd',
      ...EMAIL,
    });
    const res = await x.request('/api/settings');
    const text = await res.clone().text();
    const v = await view(x);
    expect(v.secrets).toEqual({
      TRAVELPAYOUTS_TOKEN: { set: true, last4: S.TRAVELPAYOUTS_TOKEN.slice(-4) },
      SEARCHAPI_KEY: { set: true, last4: S.SEARCHAPI_KEY.slice(-4) },
      SMTP_PASS: { set: true, last4: null },
    });
    expect(v.values).toMatchObject({
      SEARCHAPI_PLAN: '40usd',
      SMTP_HOST: 'smtp.example.com',
      FLIGHT_READ_PATIENCE: null,
      NEW_SEARCH_DISCOVERY: null,
    });
    expect(v.newSearchSources).toEqual(newSearchSourcesFor(x.ports.config, x.ports.providers));
    expect(v).toMatchObject({
      envOnly: { camoufoxEnabled: false, searchApiTrialUsed: 0 },
      envIgnored: [],
      setAside: [],
      pending: null,
    });
    expectNoSecrets(ALL_SECRETS, { 'GET /api/settings': text, log: x.logLines.join('') });
  });

  it('a secret that is not set reads as not set, with no last four', async () => {
    const x = await harness();
    expect((await view(x)).secrets).toEqual({
      TRAVELPAYOUTS_TOKEN: { set: false, last4: null },
      SEARCHAPI_KEY: { set: false, last4: null },
      SMTP_PASS: { set: false, last4: null },
    });
  });
});

describe('PUT /api/settings (settings plan ruling 5)', () => {
  it('writes the changed names; a secret not named is kept and one sent null is removed', async () => {
    const x = await harness({ TRAVELPAYOUTS_TOKEN: S.TRAVELPAYOUTS_TOKEN, SEARCHAPI_KEY: S.SEARCHAPI_KEY });
    const saved = await put(x, { SEARCHAPI_KEY: S.SEARCHAPI_KEY, FLIGHT_READ_PATIENCE: '20' });
    const savedText = await saved.clone().text();
    expect(
      await expectContract(saved, 'PUT', '/api/settings', apiContract.settingsUpdateResponseSchema),
    ).toEqual({ warnings: [], applies: 'now' });
    expect((await view(x)).values.FLIGHT_READ_PATIENCE).toBe('20');
    // why: the token was not named, so it is kept (here, from the environment); the key sent null is unset
    const removed = await put(x, { SEARCHAPI_KEY: null });
    expect(removed.status).toBe(200);
    const v = await view(x);
    expect(v.secrets.TRAVELPAYOUTS_TOKEN.set).toBe(true);
    expect(v.secrets.SEARCHAPI_KEY).toEqual({ set: false, last4: null });
    expect(rawRows(x)).toEqual([
      { name: 'FLIGHT_READ_PATIENCE', value: '20', updated_at: T0 },
      { name: 'SEARCHAPI_KEY', value: '', updated_at: T0 },
    ]);
    expectNoSecrets(ALL_SECRETS, { 'PUT 200': savedText, log: x.logLines.join('') });
  });

  it('a refused change answers 422 with the label and the words, and leaves every row as it was', async () => {
    const x = await harness();
    expect((await put(x, { FLIGHT_READ_PATIENCE: '20' })).status).toBe(200);
    const before = rawRows(x);
    const res = await put(x, { FLIGHT_READ_PATIENCE: '2', DISCOVERY_REFRESH_DAYS: '5' });
    expect(res.status).toBe(422);
    expect(await refusalsOf(res)).toEqual([
      {
        name: 'FLIGHT_READ_PATIENCE',
        label: SETTING_LABELS.FLIGHT_READ_PATIENCE,
        words: 'Choose a whole number of reads from 3 to 50.',
      },
    ]);
    expect(rawRows(x)).toEqual(before);
  });

  it('a name the page does not own is 422 without echoing it, and nothing is written', async () => {
    const x = await harness();
    const res = await put(x, { NOT_A_SETTING: S.SEARCHAPI_KEY, FLIGHT_READ_PATIENCE: '20' });
    expect(res.status).toBe(422);
    const text = await res.clone().text();
    expect(await errorOf(res)).toEqual({ code: 'unknown_setting', message: API_TEXT.unknownSetting });
    expect(text).not.toContain('NOT_A_SETTING');
    expect(rawRows(x)).toEqual([]);
    expectNoSecrets(ALL_SECRETS, { 'PUT 422': text, log: x.logLines.join('') });
  });

  it('a half email setup is refused naming each missing field in the words of its label', async () => {
    const x = await harness();
    const res = await put(x, { SMTP_HOST: 'smtp.example.com', SMTP_PASS: S.SMTP_PASS });
    const text = await res.clone().text();
    expect(res.status).toBe(422);
    const missing = ['SMTP_PORT', 'SMTP_USER', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM'] as const;
    expect(await refusalsOf(res)).toEqual(
      missing.map((name) => ({
        name,
        label: SETTING_LABELS[name],
        words: settingRefusal(name, { field: name, message: SMTP_ALL_OR_NOTHING }),
      })),
    );
    expect(text).toContain('Email needs mail server port too: fill it in, or remove email.');
    expect(rawRows(x)).toEqual([]);
    expectNoSecrets(ALL_SECRETS, { 'PUT 422': text, log: x.logLines.join('') });
  });

  it('a stored value that no longer parses never blocks an unrelated save; a save that names it fixes it (Review Focus 2)', async () => {
    const x = await harness();
    // why: a row an earlier version saved under a wider bound, written past the repository's checks
    x.ports.db.raw
      .prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)')
      .run('DISCOVERY_REFRESH_DAYS', '90', T0);
    expect((await put(x, { FLIGHT_READ_PATIENCE: '20' })).status).toBe(200);
    const again = await put(x, { DISCOVERY_REFRESH_DAYS: '45' });
    expect(again.status).toBe(422);
    expect((await refusalsOf(again)).map((f) => f.name)).toEqual(['DISCOVERY_REFRESH_DAYS']);
    expect((await put(x, { DISCOVERY_REFRESH_DAYS: '14' })).status).toBe(200);
    expect((await view(x)).values.DISCOVERY_REFRESH_DAYS).toBe('14');
  });

  it('returns the warning of a spend limit below the plan fees, in the page words', async () => {
    const x = await harness({ SEARCHAPI_KEY: S.SEARCHAPI_KEY, SEARCHAPI_PLAN: '40usd' });
    const fees = microGbpToPence(providerBudget(x.ports.config, 'searchapi').planFixedMicroGbp);
    expect(fees).toBeGreaterThan(100);
    const res = await put(x, { MONTHLY_SPEND_CAP_PENCE: '100' });
    expect(
      await expectContract(res, 'PUT', '/api/settings', apiContract.settingsUpdateResponseSchema),
    ).toEqual({ warnings: [API_TEXT.settingsSpendBelowFees(100, fees)], applies: 'now' });
    expect(API_TEXT.settingsSpendBelowFees(100, fees)).not.toMatch(/MONTHLY_SPEND_CAP_PENCE/);
  });

  it('asks for the restart in place and, while runs are in flight, names their searches', async () => {
    const asks: string[] = [];
    let pending = false;
    const reload: ReloadPort = {
      request: () => {
        asks.push('request');
        pending = true;
        return 'after-runs';
      },
      pending: () => pending,
    };
    const x = await harness({}, { reload });
    const def = x.ports.repos.definitions.create({ ...exampleDefinitionInput(), name: 'Autumn trip' });
    // why: a read in flight is one of the things a restart waits for; its search is named like a run's
    vi.spyOn(x.engine, 'flightReadInFlight').mockReturnValue({
      definitionId: def.id,
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-12'),
    });
    const res = await put(x, { FLIGHT_READ_PATIENCE: '20' });
    expect(
      await expectContract(res, 'PUT', '/api/settings', apiContract.settingsUpdateResponseSchema),
    ).toEqual({ warnings: [], applies: 'after-runs', running: ['Autumn trip'] });
    expect(asks).toEqual(['request']);
    expect((await view(x)).pending).toEqual({ running: ['Autumn trip'] });
  });
});

/** A mail transport double: records options and messages; `fail` throws an error that echoes the credentials. */
function mailDouble(o: { fail?: boolean } = {}) {
  const options: SmtpTransportOptions[] = [];
  const sent: MailMessage[] = [];
  const factory: TransportFactory = (opts) => {
    options.push(opts);
    return {
      sendMail: async (m) => {
        if (o.fail === true)
          throw Object.assign(new Error(`535 ${opts.auth.user} ${opts.auth.pass} refused by ${opts.host}`), {
            code: 'EAUTH',
            response: `535 ${opts.auth.pass}`,
          });
        sent.push(m);
        return { messageId: 'stub' };
      },
    };
  };
  return { factory, options, sent };
}

const emailForm = {
  host: 'smtp.example.com',
  port: 465,
  tls: 'implicit',
  user: 'alerts@example.com',
  from: 'alerts@example.com',
  to: 'operator@example.com',
} as const;
const emailTest = (x: Harness, body: object) =>
  x.request('/api/settings/email-test', { method: 'POST', json: body });

describe('POST /api/settings/email-test (settings plan ruling 11)', () => {
  it('uses the stored password for the stored server, and sends the fixed test message', async () => {
    const mail = mailDouble();
    const x = await harness(EMAIL, { emailTransport: mail.factory, testSendLimit: new TestSendLimit() });
    const res = await emailTest(x, emailForm);
    expect(
      await expectContract(
        res,
        'POST',
        '/api/settings/email-test',
        apiContract.settingsEmailTestResponseSchema,
      ),
    ).toEqual({ result: 'sent', at: T0 });
    expect(mail.options.map((o) => ({ host: o.host, port: o.port, auth: o.auth }))).toEqual([
      { host: 'smtp.example.com', port: 465, auth: { user: 'alerts@example.com', pass: S.SMTP_PASS } },
    ]);
    expect(mail.sent).toHaveLength(1);
  });

  it('a changed server with no password is 422 before any connection', async () => {
    const mail = mailDouble();
    const x = await harness(EMAIL, { emailTransport: mail.factory, testSendLimit: new TestSendLimit() });
    for (const changed of [
      { host: 'mail.example.org' },
      { port: 587 },
      { tls: 'starttls' },
      { user: 'someone@example.com' },
    ]) {
      const res = await emailTest(x, { ...emailForm, ...changed });
      expect(res.status).toBe(422);
      expect(await refusalsOf(res)).toEqual([
        {
          name: 'SMTP_PASS',
          label: SETTING_LABELS.SMTP_PASS,
          words: settingRefusal('SMTP_PASS', { field: 'SMTP_PASS', message: '' }),
        },
      ]);
    }
    expect(mail.options).toEqual([]);
  });

  it('refuses a plain-text server off this machine and an address that is not one mailbox, before any connection', async () => {
    const mail = mailDouble();
    const x = await harness({}, { emailTransport: mail.factory, testSendLimit: new TestSendLimit() });
    const res = await emailTest(x, {
      ...emailForm,
      tls: 'none',
      pass: S.SMTP_PASS,
      to: 'a@example.com\r\nBcc: b@example.com',
    });
    expect(res.status).toBe(422);
    expect((await refusalsOf(res)).map((f) => f.name)).toEqual(['SMTP_TLS', 'ALERT_EMAIL_TO']);
    expect(mail.options).toEqual([]);
  });

  it('a server that echoes the credentials in its error gives fixed words, and no body or log line carries them', async () => {
    const mail = mailDouble({ fail: true });
    const x = await harness({}, { emailTransport: mail.factory, testSendLimit: new TestSendLimit() });
    const res = await emailTest(x, { ...emailForm, pass: S.SMTP_PASS });
    const text = await res.clone().text();
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({
      code: 'email_test_failed',
      message: API_TEXT.emailTestFailed['sign-in-refused'],
      details: { reason: 'sign-in-refused' },
    });
    expectNoSecrets([...ALL_SECRETS, 'alerts@example.com refused'], {
      'email-test 502': text,
      log: x.logLines.join(''),
    });
  });

  it('holds one limit across both test routes', async () => {
    const limit = new TestSendLimit();
    const clock = fixedClock(T0);
    const notifier = new EmailNotifier({
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'implicit',
        user: 'alerts@example.com',
        pass: new Secret(S.SMTP_PASS),
        to: 'operator@example.com',
        from: 'alerts@example.com',
      },
      nodeEnv: 'production',
      log: silentLog,
      clock,
      maxPerHour: 20,
      createTransport: mailDouble().factory,
      testLimit: limit,
    });
    const x = await harness(EMAIL, {
      emailTransport: mailDouble().factory,
      testSendLimit: limit,
      email: notifier,
    });
    expect((await emailTest(x, emailForm)).status).toBe(200);
    expect((await x.request('/api/alerts/test-email', { method: 'POST' })).status).toBe(429);
    clock.advance(60_000);
    expect((await x.request('/api/alerts/test-email', { method: 'POST' })).status).toBe(200);
    const limited = await emailTest(x, emailForm);
    expect(limited.status).toBe(429);
    expect(await errorOf(limited)).toMatchObject({ code: 'email_limit', message: API_TEXT.emailLimit });
  });
});
