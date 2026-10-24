import { parseEnv } from 'node:util';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import { type Answers, defaultAnswers } from '../../src/setup/answers.js';
import {
  answersFromRecord,
  checkAppEnv,
  entriesFor,
  GROUP_NAMES,
  ownedDiff,
  renderAppEnv,
  replaceGroups,
} from '../../src/setup/appEnv.js';

const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/op' } });
const PASS = 'Abcdefghijklmnopqrstuvwxyz012345';
const base = defaultAnswers({ port: 3000, timezone: 'Europe/London' });
const full: Answers = {
  ...base,
  travelpayouts: { token: 'tp-token-0123456789' },
  searchApi: { plan: 'trial' as const, key: 'sa-key-0123456789', billingDay: 3, trialUsed: 9 },
  email: {
    host: 'smtp.example.com',
    port: 587,
    tls: 'starttls' as const,
    user: 'me',
    pass: 'smtp-pass-0123',
    to: 'me@example.com',
    from: 'gmt@example.com',
  },
  browser: { window: 'any' as const },
};
const emailOf = (a: Answers) => {
  if (a.email === null) throw new Error('no email');
  return a.email;
};
const record = (a: Answers = full) => Object.fromEntries(entriesFor(a, { paths: p.paths, password: PASS }));

describe('app.env (spec §12 "Where settings live")', () => {
  it('a clean machine’s record: production, the native database, loopback, operator and the answers', () => {
    expect(record(base)).toEqual({
      NODE_ENV: 'production',
      DATABASE_PATH: '/Users/op/.local/share/get-me-there/get-me-there.db',
      BIND_ADDRESS: '127.0.0.1',
      PORT: '3000',
      SCHEDULER_TIMEZONE: 'Europe/London',
      POINT_OF_SALE: 'GB',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: PASS,
    });
  });

  it('vendor, email and browser lines follow the answers', () => {
    expect(record()).toMatchObject({
      TRAVELPAYOUTS_TOKEN: 'tp-token-0123456789',
      SEARCHAPI_KEY: 'sa-key-0123456789',
      SEARCHAPI_PLAN: 'trial',
      SEARCHAPI_BILLING_DAY: '3',
      SEARCHAPI_TRIAL_USED: '9',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_TLS: 'starttls',
      SMTP_USER: 'me',
      SMTP_PASS: 'smtp-pass-0123',
      ALERT_EMAIL_TO: 'me@example.com',
      ALERT_EMAIL_FROM: 'gmt@example.com',
      CAMOUFOX_BROWSER_WINDOW: 'any',
    });
    expect(
      record({
        ...full,
        searchApi: { plan: '40usd', key: 'sa-key-0123456789', billingDay: 3, trialUsed: null },
      }),
    ).not.toHaveProperty('SEARCHAPI_TRIAL_USED');
  });

  it('the rendered text parsed with parseEnv equals the record, and passes core’s schema', () => {
    const entries = entriesFor(full, { paths: p.paths, password: PASS });
    const text = renderAppEnv(entries);
    expect(parseEnv(text)).toEqual(Object.fromEntries(entries));
    expect(checkAppEnv(text, Object.fromEntries(entries))).toEqual({
      ok: true,
      record: Object.fromEntries(entries),
    });
    expect(text.startsWith('# get-me-there settings')).toBe(true);
  });

  it('property: hostile operator values with $, #, quote, backtick and spaces round-trip', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom('a', '$', '#', "'", '`', ' ', '{', '}', '=', 'é') }),
        (user) => {
          const a: Answers = { ...full, email: { ...emailOf(full), user: `u${user}` } };
          const entries = entriesFor(a, { paths: p.paths, password: PASS });
          expect(parseEnv(renderAppEnv(entries)).SMTP_USER).toBe(`u${user}`);
          expect(checkAppEnv(renderAppEnv(entries), Object.fromEntries(entries)).ok).toBe(true);
        },
      ),
    );
  });

  it.each(['"', '\\', '\r', '\n'])(
    'a value holding %j is refused naming the field, never the value',
    (ch) => {
      const a: Answers = { ...full, email: { ...emailOf(full), user: `SENTINELvalue${ch}x` } };
      const entries = entriesFor(a, { paths: p.paths, password: PASS });
      const r = checkAppEnv(renderAppEnv(entries), Object.fromEntries(entries));
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).toContain('SMTP_USER');
      expect(JSON.stringify(r)).not.toContain('SENTINEL');
    },
  );

  it('a schema failure refuses naming the field, never its value', () => {
    const a: Answers = { ...full, email: { ...emailOf(full), tls: 'none' } };
    const entries = entriesFor(a, { paths: p.paths, password: PASS });
    const r = checkAppEnv(renderAppEnv(entries), Object.fromEntries(entries));
    expect(r).toEqual({ ok: false, error: 'app.env would not pass the app’s settings check: SMTP_TLS' });
    const short = entriesFor(base, { paths: p.paths, password: 'SENTINELsh' });
    const s = checkAppEnv(renderAppEnv(short), Object.fromEntries(short));
    expect(JSON.stringify(s)).toContain('APP_BASIC_AUTH_PASS');
    expect(JSON.stringify(s)).not.toContain('SENTINEL');
  });

  it('a camoufox window outside scheduled|any fails core’s schema', () => {
    const entries = [
      ...entriesFor(base, { paths: p.paths, password: PASS }),
      ['CAMOUFOX_BROWSER_WINDOW', 'sometimes'] as const,
    ];
    expect(checkAppEnv(renderAppEnv(entries), Object.fromEntries(entries))).toEqual({
      ok: false,
      error: 'app.env would not pass the app’s settings check: CAMOUFOX_BROWSER_WINDOW',
    });
  });

  it('ownedDiff names the wizard-owned names whose values differ, never unowned ones', () => {
    const now = record(base);
    expect(ownedDiff({ ...now, PORT: '3917', LOG_LEVEL: 'debug' }, now)).toEqual(['PORT']);
    expect(ownedDiff({ ...now, SMTP_HOST: 'x' }, now)).toEqual(['SMTP_HOST']);
    expect(ownedDiff(now, now)).toEqual([]);
  });

  it('replaceGroups replaces only the group’s lines and keeps every other line as written', () => {
    const before = `${renderAppEnv(entriesFor(base, { paths: p.paths, password: PASS }))}LOG_LEVEL=debug\n# a note\nEXTRA_THING="kept value"\n`;
    const after = replaceGroups(
      before,
      entriesFor({ ...base, port: 3917 }, { paths: p.paths, password: PASS }),
      ['port'],
    );
    expect(after.split('\n').filter((l) => !before.split('\n').includes(l))).toEqual(['PORT="3917"']);
    expect(parseEnv(after)).toMatchObject({ PORT: '3917', LOG_LEVEL: 'debug', EXTRA_THING: 'kept value' });
    // a group turned off loses its lines; a group turned on gains them at the end
    const withEmail = replaceGroups(before, entriesFor(full, { paths: p.paths, password: PASS }), ['email']);
    expect(parseEnv(withEmail)).toMatchObject({ SMTP_HOST: 'smtp.example.com', LOG_LEVEL: 'debug' });
    const without = replaceGroups(withEmail, entriesFor(base, { paths: p.paths, password: PASS }), ['email']);
    expect(
      Object.keys(parseEnv(without)).filter((k) => k.startsWith('SMTP_') || k.startsWith('ALERT_EMAIL_')),
    ).toEqual([]);
    expect(GROUP_NAMES.email).toContain('ALERT_EMAIL_FROM');
  });

  it('answersFromRecord reads back what entriesFor wrote', () => {
    expect(answersFromRecord(record(), { linger: 'skip' })).toEqual(full);
    expect(answersFromRecord(record(base), { linger: 'enable' })).toEqual({ ...base, linger: 'enable' });
    expect(answersFromRecord({ ...record(base), PORT: 'x' }, { linger: 'skip' }).port).toBe(3000);
  });
});
