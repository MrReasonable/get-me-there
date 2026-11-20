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
  MIN_SECRET_LENGTH,
  microGbpToPence,
  type OwnedName,
  SECRET_TOO_SHORT,
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
/**
 * The 422's refusals, one shape: the envelope's own `field` (the owned name) and `message` (the words). The strict
 * schema proves nothing else is sent; the envelope parse (the web client's) keeps every field.
 */
const strictRefusal = z.object({ error: z.object({ details: apiContract.settingsRefusalDetailsSchema }) });
const refusalsOf = async (res: Response) => {
  const body: unknown = await res.json();
  const fields = strictRefusal.parse(body).error.details.fields;
  expect(apiContract.errorEnvelopeSchema.parse(body).error.details?.fields).toEqual(fields);
  return fields;
};
/** The refusal of `name` in the words core gives for `message`. */
const refusal = (name: OwnedName, message = '') => ({
  field: name,
  message: settingRefusal(name, { field: name, message }),
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
      { field: 'FLIGHT_READ_PATIENCE', message: 'Choose a whole number of reads from 3 to 50.' },
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
    expect(await refusalsOf(res)).toEqual(missing.map((name) => refusal(name, SMTP_ALL_OR_NOTHING)));
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
    expect((await refusalsOf(again)).map((f) => f.field)).toEqual(['DISCOVERY_REFRESH_DAYS']);
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
      held: () => pending,
      toolStarted: () => undefined,
      toolEnded: () => undefined,
      tools: () => ['Smoke test'],
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
    ).toEqual({ warnings: [], applies: 'after-runs', running: ['Autumn trip', 'Smoke test'] });
    expect(asks).toEqual(['request']);
    expect((await view(x)).pending).toEqual({ running: ['Autumn trip', 'Smoke test'] });
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

/** A ReloadPort that records what it was told; `pending`, `held` and `tools` answer as set. */
function fakeReload(o: { pending?: boolean; held?: boolean; answer?: 'now' | 'after-runs' } = {}) {
  const told: string[] = [];
  let pending = o.pending ?? false;
  const held = o.held ?? pending;
  const tools: string[] = [];
  const port: ReloadPort = {
    request: () => {
      told.push('request');
      if (o.answer === 'after-runs') pending = true;
      return o.answer ?? 'now';
    },
    pending: () => pending,
    held: () => held || told.includes('request'),
    toolStarted: (label) => {
      told.push(`started:${label}`);
      tools.push(label);
    },
    toolEnded: () => {
      told.push('ended');
      tools.shift();
    },
    tools: () => [...tools],
  };
  return { port, told };
}

/** A value under the secret floor, distinctive enough to search for. */
const SHORT = 'q7Zk2';

describe('PUT /api/settings: fix round 1 (secrets, refusals, unchanged saves, warnings)', () => {
  it('a secret shorter than the floor is refused before it is stored, so no later boot can trip over it', async () => {
    const x = await harness();
    const res = await put(x, { ...EMAIL, SMTP_PASS: 'abc12' });
    expect(res.status).toBe(422);
    expect(await refusalsOf(res)).toEqual([refusal('SMTP_PASS', SECRET_TOO_SHORT)]);
    expect(rawRows(x)).toEqual([]);
    const keys = await put(x, {
      TRAVELPAYOUTS_TOKEN: 'short',
      SEARCHAPI_KEY: 'k'.repeat(MIN_SECRET_LENGTH - 1),
    });
    expect(await refusalsOf(keys)).toEqual([
      refusal('TRAVELPAYOUTS_TOKEN', SECRET_TOO_SHORT),
      refusal('SEARCHAPI_KEY', SECRET_TOO_SHORT),
    ]);
  });

  it('a value shorter than any secret never joins the shared scrub lists; a secret does; an error quoting the short one is scrubbed', async () => {
    const x = await harness();
    const before = x.ports.secrets.length;
    expect((await put(x, { SMTP_PASS: SHORT, ...{ SMTP_HOST: 'smtp.example.com' } })).status).toBe(422);
    expect((await put(x, { NOT_A_SETTING: SHORT })).status).toBe(422);
    expect((await emailTest(x, { ...emailForm, pass: SHORT, to: 'not a mailbox' })).status).toBe(422);
    expect(x.ports.secrets).toHaveLength(before);
    expect(x.ports.secrets.some((s) => s.reveal() === SHORT)).toBe(false);
    expect((await put(x, { SEARCHAPI_KEY: S.SEARCHAPI_KEY })).status).toBe(200);
    expect(x.ports.secrets.map((s) => s.reveal())).toContain(S.SEARCHAPI_KEY);
    // why: the request's own short value is still kept out of its error's log line
    vi.spyOn(x.ports.db, 'immediateTransaction').mockImplementation(() => {
      throw new Error(`disk full while saving ${SHORT}`);
    });
    const failed = await put(x, { SMTP_PASS: SHORT });
    expect(failed.status).toBe(500);
    expect(x.logLines.join('')).toContain('disk full while saving');
    expect(x.logLines.join('')).not.toContain(SHORT);
  });

  it('a 422 names only the changed settings, never a stored one the save leaves alone', async () => {
    const x = await harness();
    x.ports.db.raw
      .prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)')
      .run('DISCOVERY_REFRESH_DAYS', '90', T0);
    const res = await put(x, { FLIGHT_READ_PATIENCE: '2' });
    expect(await refusalsOf(res)).toEqual([
      { field: 'FLIGHT_READ_PATIENCE', message: 'Choose a whole number of reads from 3 to 50.' },
    ]);
  });

  it('a save that changes nothing writes nothing and restarts nothing', async () => {
    const reload = fakeReload();
    const x = await harness({}, { reload: reload.port });
    const unchanged = { warnings: [], applies: 'unchanged' };
    expect(
      await expectContract(
        await put(x, {}),
        'PUT',
        '/api/settings',
        apiContract.settingsUpdateResponseSchema,
      ),
    ).toEqual(unchanged);
    expect(await (await put(x, { FLIGHT_READ_PATIENCE: '20' })).json()).toEqual({
      warnings: [],
      applies: 'now',
    });
    const rows = rawRows(x);
    expect(await (await put(x, { FLIGHT_READ_PATIENCE: '20' })).json()).toEqual(unchanged);
    expect(rawRows(x)).toEqual(rows);
    expect(reload.told).toEqual(['request']);
  });

  it('a save that makes the app read a refused .env line is 422 naming the line, never a 500, and saves nothing (review M7)', async () => {
    // why: with no SearchApi key the provider's own lines are not read, so this app boots; a saved key would read them
    const x = await harness({ SEARCHAPI_MONTHLY_CALL_CAP: 'lots' });
    const res = await put(x, { SEARCHAPI_KEY: S.SEARCHAPI_KEY });
    const text = await res.clone().text();
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toEqual({
      code: 'invalid_env',
      message: API_TEXT.settingsEnvRefused(['SEARCHAPI_MONTHLY_CALL_CAP']),
      details: { lines: ['SEARCHAPI_MONTHLY_CALL_CAP'] },
    });
    expect(API_TEXT.settingsEnvRefused(['SEARCHAPI_MONTHLY_CALL_CAP'])).toContain(
      'SEARCHAPI_MONTHLY_CALL_CAP in .env',
    );
    expect(text).not.toContain('lots');
    expect(rawRows(x)).toEqual([]);
    expectNoSecrets(ALL_SECRETS, { 'PUT /api/settings': text, log: x.logLines.join('') });
  });

  it("passes on the config's own warnings in the page's words", async () => {
    const x = await harness({ SEARCHAPI_KEY: S.SEARCHAPI_KEY, SEARCHAPI_TRIAL_USED: '9' });
    const res = await put(x, { SEARCHAPI_PLAN: '40usd' });
    const answer = await expectContract(
      res,
      'PUT',
      '/api/settings',
      apiContract.settingsUpdateResponseSchema,
    );
    expect(answer.warnings).toContain(API_TEXT.settingsTrialUsedIgnored);
  });

  it('GET shows the saved new-search sources while the restart waits, read from the same stored config as the values', async () => {
    const reload = fakeReload({ answer: 'after-runs' });
    const x = await harness({ TRAVELPAYOUTS_TOKEN: S.TRAVELPAYOUTS_TOKEN }, { reload: reload.port });
    expect((await view(x)).newSearchSources.discovery).toEqual(['travelpayouts']);
    expect((await put(x, { NEW_SEARCH_DISCOVERY: 'none' })).status).toBe(200);
    const v = await view(x);
    expect(v.values.NEW_SEARCH_DISCOVERY).toBe('none');
    expect(v.newSearchSources.discovery).toEqual([]);
    // why: the running app keeps its own until the restart
    expect(x.ports.config.newSearchSources.discovery).toBeNull();
    expect(v.pending).toEqual({ running: [] });
  });
});

describe('the tools while a restart in place waits (settings plan ruling 6)', () => {
  it('a tool run is refused in the words while a save waits; otherwise the restart is told of its start and end', async () => {
    const held = fakeReload({ pending: true });
    const x = await harness({}, { reload: held.port, tools: { smoke: async () => smokeOk } });
    const refusedRun = await x.request('/api/tools/smoke', { method: 'POST', json: SMOKE_BODY });
    expect(refusedRun.status).toBe(503);
    expect(await errorOf(refusedRun)).toEqual({ code: 'reload-pending', message: API_TEXT.applyingSettings });
    expect(held.told).toEqual([]);

    // why: once the restart has begun `pending` is false, but the pass is still held until it closes
    const firing = fakeReload({ pending: false, held: true });
    const w = await harness({}, { reload: firing.port, tools: { smoke: async () => smokeOk } });
    const late = await w.request('/api/tools/smoke', { method: 'POST', json: SMOKE_BODY });
    expect(late.status).toBe(503);
    expect(await errorOf(late)).toEqual({ code: 'reload-pending', message: API_TEXT.applyingSettings });
    expect(firing.told).toEqual([]);

    const idle = fakeReload();
    const y = await harness({}, { reload: idle.port, tools: { smoke: async () => smokeOk } });
    expect((await y.request('/api/tools/smoke', { method: 'POST', json: SMOKE_BODY })).status).toBe(200);
    expect(idle.told).toEqual([`started:${API_TEXT.toolRunLabel.smoke}`, 'ended']);
    const failing = fakeReload();
    const z2 = await harness(
      {},
      {
        reload: failing.port,
        tools: {
          smoke: async () => {
            throw new Error('boom');
          },
        },
      },
    );
    expect((await z2.request('/api/tools/smoke', { method: 'POST', json: SMOKE_BODY })).status).toBe(500);
    expect(failing.told).toEqual([`started:${API_TEXT.toolRunLabel.smoke}`, 'ended']);
  });
});

const SMOKE_BODY = { origin: 'LHR', destination: 'JFK', budget: 2 };
const smokeOk = {
  exitCode: 0,
  summary: 'done',
  lines: [],
  fixturesWritten: [],
  searchApiCreditsLedgered: null,
};

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
      expect(await refusalsOf(res)).toEqual([refusal('SMTP_PASS')]);
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
    const text = await res.clone().text();
    expect((await refusalsOf(res)).map((f) => f.field)).toEqual(['SMTP_TLS', 'ALERT_EMAIL_TO']);
    expect(mail.options).toEqual([]);
    expectNoSecrets(ALL_SECRETS, { 'email-test 422': text, log: x.logLines.join('') });
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
