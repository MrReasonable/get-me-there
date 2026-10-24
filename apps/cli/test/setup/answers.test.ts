import { describe, expect, it } from 'vitest';
import { answersFileSchema, defaultAnswers, loadAnswersFile } from '../../src/setup/answers.js';
import { testIo, testWorld } from '../support/deps.js';

const write = (w: ReturnType<typeof testWorld>, text: unknown, mode = 0o600) =>
  w.fs.file('/work/answers.json', typeof text === 'string' ? text : JSON.stringify(text), mode);

describe('--answers <file> (spec §13; brief Task 16b.5)', () => {
  it('a full file resolves to answers, with defaults for what it leaves out', async () => {
    const w = testWorld({ env: { TP: 'tp-token-from-env-123' } });
    write(w, {
      port: 3917,
      linger: 'enable',
      travelpayouts: { token: { fromEnv: 'TP' } },
      searchApi: { plan: 'trial', key: 'sa-key-0123456789', trialUsed: 9 },
    });
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r).toEqual({
      ok: true,
      answers: {
        ...defaultAnswers({ port: 3000, timezone: 'Europe/London' }),
        port: 3917,
        linger: 'enable',
        travelpayouts: { token: 'tp-token-from-env-123' },
        searchApi: { plan: 'trial', key: 'sa-key-0123456789', billingDay: 1, trialUsed: 9 },
      },
    });
  });

  it('defaults: the machine’s zone, GB, no source, no email, no linger, browser unset', () => {
    expect(defaultAnswers({ port: 3001, timezone: 'America/New_York' })).toEqual({
      port: 3001,
      timezone: 'America/New_York',
      pointOfSale: 'GB',
      travelpayouts: null,
      searchApi: null,
      email: null,
      linger: 'skip',
      browser: null,
    });
  });

  it.each([
    ['ALLOW_FIXTURE_PROVIDER', { ALLOW_FIXTURE_PROVIDER: 'x' }],
    ['a DATABASE_PATH override', { DATABASE_PATH: '/tmp/x.fixture.db' }],
    ['a databasePath key', { databasePath: '/tmp/x.fixture.db' }],
    ['an unknown nested key', { searchApi: { plan: 'trial', key: 'k-0123456789ab', extra: 1 } }],
    ['an env-name that is not one', { travelpayouts: { token: { fromEnv: 'lower-case' } } }],
  ])('the strict schema refuses %s', async (_n, body) => {
    const w = testWorld();
    write(w, body);
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok).toBe(false);
    expect(answersFileSchema.safeParse(body).success).toBe(false);
  });

  it('a file holding a secret and readable by group or others is refused naming chmod 600', async () => {
    for (const mode of [0o640, 0o604, 0o644]) {
      const w = testWorld();
      write(w, { travelpayouts: { token: 'tp-literal-0123456789' } }, mode);
      const r = await loadAnswersFile('/work/answers.json', w.deps);
      expect(r).toEqual({
        ok: false,
        error: '/work/answers.json holds a secret and is readable by others: chmod 600 /work/answers.json',
      });
    }
  });

  it('secrets from fromEnv or fromStdin need no 0600 file', async () => {
    const w = testWorld({
      env: { SMTP_SECRET: 'smtp-pass-from-env' },
      io: testIo({ stdin: 'tp-token-on-stdin\n' }),
    });
    write(
      w,
      {
        travelpayouts: { token: { fromStdin: true } },
        email: {
          host: 'smtp.example.com',
          port: 465,
          tls: 'implicit',
          user: 'me',
          pass: { fromEnv: 'SMTP_SECRET' },
          to: 'me@example.com',
          from: 'gmt@example.com',
        },
      },
      0o644,
    );
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok && r.answers.travelpayouts).toEqual({ token: 'tp-token-on-stdin' });
    expect(r.ok && r.answers.email?.pass).toBe('smtp-pass-from-env');
  });

  it('fromEnv naming an unset variable, two fromStdin fields, a missing or unreadable file are refused', async () => {
    const w = testWorld();
    write(w, { travelpayouts: { token: { fromEnv: 'NOPE' } } }, 0o644);
    expect(await loadAnswersFile('/work/answers.json', w.deps)).toEqual({
      ok: false,
      error: 'travelpayouts.token: the environment variable NOPE is not set',
    });
    write(
      w,
      {
        travelpayouts: { token: { fromStdin: true } },
        searchApi: { plan: '40usd', key: { fromStdin: true } },
      },
      0o644,
    );
    expect((await loadAnswersFile('/work/answers.json', w.deps)).ok).toBe(false);
    expect(await loadAnswersFile('/work/none.json', w.deps)).toEqual({
      ok: false,
      error: 'cannot read /work/none.json',
    });
    write(w, '{ not json');
    expect(await loadAnswersFile('/work/answers.json', w.deps)).toEqual({
      ok: false,
      error: '/work/answers.json is not JSON',
    });
  });

  it('trialUsed is SearchApi trial’s alone: refused with 40usd; kept with the trial whatever the database’s origin (U2)', async () => {
    const w = testWorld();
    write(w, { searchApi: { plan: '40usd', key: 'sa-key-0123456789', trialUsed: 3 } });
    expect(await loadAnswersFile('/work/answers.json', w.deps)).toEqual({
      ok: false,
      error: 'searchApi.trialUsed applies to the trial plan only',
    });
    write(w, { searchApi: { plan: 'trial', key: 'sa-key-0123456789', trialUsed: 3 } });
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok && r.answers.searchApi?.trialUsed).toBe(3);
    write(w, { searchApi: { plan: 'trial', key: 'sa-key-0123456789' } });
    const current = {
      ...defaultAnswers({ port: 3000, timezone: 'UTC' }),
      searchApi: { plan: 'trial' as const, key: 'old-key-0123456', billingDay: 1, trialUsed: 9 },
    };
    const kept = await loadAnswersFile('/work/answers.json', w.deps, { defaults: current });
    expect(kept.ok && kept.answers.searchApi?.trialUsed).toBe(9);
  });

  // why: spec §13: an invalid secret's value never appears in an error; each secret field holds a sentinel made invalid
  it.each([
    ['travelpayouts.token', (s: string) => ({ travelpayouts: { token: s } })],
    ['searchApi.key', (s: string) => ({ searchApi: { plan: 'trial', key: s } })],
    [
      'email.pass',
      (s: string) => ({
        email: {
          host: 'smtp.example.com',
          port: 465,
          tls: 'implicit',
          user: 'u',
          pass: s,
          to: 'a@example.com',
          from: 'b@example.com',
        },
      }),
    ],
  ])('an invalid %s is refused naming the field, never its value', async (field, body) => {
    const sentinel = 'SENTINEL-zq7Xv9Lm2Rk4';
    for (const bad of [`${sentinel}"x`, `${sentinel}\nx`, `${sentinel}\\x`, `${sentinel}\rx`, '']) {
      const w = testWorld();
      write(w, body(bad));
      const r = await loadAnswersFile('/work/answers.json', w.deps);
      expect(r.ok).toBe(false);
      const text = JSON.stringify(r);
      expect(text).toContain(field);
      expect(text).not.toContain(sentinel);
      expect(text).not.toContain(sentinel.slice(4, 14));
    }
  });

  it.each([
    [{ timezone: 'Mars/Olympus' }, 'timezone: not a time zone this machine knows'],
    [{ pointOfSale: 'gb' }, 'pointOfSale'],
    [{ port: 80 }, 'port'],
    [
      {
        email: {
          host: 'h',
          port: 465,
          tls: 'implicit',
          user: 'u',
          pass: 'p-0123456789',
          to: 'nobody',
          from: 'b@example.com',
        },
      },
      'email.to',
    ],
  ])('a bad plain value is refused naming it: %j', async (body, field) => {
    const w = testWorld();
    write(w, body);
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain(field);
  });

  it('an answers file whose top level is not an object is refused at the top level (ts-b1-016)', async () => {
    const w = testWorld();
    write(w, '[]');
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('(top level)');
  });
  it.each([
    ['host', '', '/work/answers.json: email.host: too_small'],
    ['to', 'not-an-address', 'email.to: not an email address'],
    ['from', 'not-an-address', 'email.from: not an email address'],
  ])('a bad email %s is refused with its exact message (ts-b1-016)', async (field, value, message) => {
    const w = testWorld();
    const email = {
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit',
      user: 'u',
      pass: 'p-0123456789',
      to: 'a@example.com',
      from: 'b@example.com',
    };
    write(w, { email: { ...email, [field]: value } });
    const r = await loadAnswersFile('/work/answers.json', w.deps);
    expect(r.ok).toBe(false);
    if (r.ok === false) {
      expect(r.error).toBe(message);
      expect(r.error).not.toContain('p-0123456789');
    }
  });
});
