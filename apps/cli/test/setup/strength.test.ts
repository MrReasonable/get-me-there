import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { currentPlatform } from '../../src/platform/current.js';
import {
  type Answers,
  answersFileSchema,
  defaultAnswers,
  loadAnswersFile,
  plainProblems,
} from '../../src/setup/answers.js';
import {
  answersFromRecord,
  checkAppEnv,
  entriesFor,
  renderAppEnv,
  replaceGroups,
} from '../../src/setup/appEnv.js';
import { generatePassword, resolveSecrets, valueProblem } from '../../src/setup/secrets.js';
import { testWorld } from '../support/deps.js';

// The edges of the settings rules, one assertion a rule (the mutation run's survivors, Task 16b.11).
const p = currentPlatform({ platform: 'darwin', arch: 'arm64', uid: 501, env: { HOME: '/Users/op' } });
const base = defaultAnswers({ port: 3000, timezone: 'Europe/London' });
const PASS = 'Abcdefghijklmnopqrstuvwxyz012345';
const env = (a: Answers) => Object.fromEntries(entriesFor(a, { paths: p.paths, password: PASS }));

describe('secrets', () => {
  it('generatePassword is 24 random bytes as base64url', () => {
    const asked: number[] = [];
    const bytes = Buffer.from(Array.from({ length: 24 }, (_, i) => i * 11));
    expect(
      generatePassword((n) => {
        asked.push(n);
        return bytes;
      }),
    ).toBe(bytes.toString('base64url'));
    expect(asked).toEqual([24]);
  });
  it('a secret of 512 characters is fine and one of 513 is refused; plain values have no limit', () => {
    expect(valueProblem('k', 'x'.repeat(512), { secret: true })).toBeNull();
    expect(valueProblem('k', 'x'.repeat(513), { secret: true })).toBe('k: is longer than 512 characters');
    expect(valueProblem('k', 'x'.repeat(600), { secret: false })).toBeNull();
    expect(valueProblem('k', '', { secret: false })).toBeNull();
  });
  it('two stdin secrets are refused, naming exactly those fields; one is read once and its last newline dropped', async () => {
    const r = await resolveSecrets(
      [
        { field: 'a', input: { fromEnv: 'A' } },
        { field: 'b', input: { fromStdin: true } },
        { field: 'c', input: { fromStdin: true } },
      ],
      { A: 'x' },
      async () => '',
    );
    expect(r).toEqual({
      ok: false,
      error: 'only one secret may come from standard input (b, c); use fromEnv for the others',
    });
    let reads = 0;
    const one = await resolveSecrets(
      [
        { field: 'lit', input: 'literal' },
        { field: 's', input: { fromStdin: true } },
      ],
      {},
      async () => {
        reads++;
        return 'line one\nline two\r\n';
      },
    );
    expect(one.ok && [...one.values]).toEqual([
      ['lit', 'literal'],
      ['s', 'line one\nline two'],
    ]);
    expect(reads).toBe(1);
  });
});

describe('the answers file schema and checks', () => {
  const parse = (x: unknown) => answersFileSchema.safeParse(x).success;
  it('fromEnv names an environment variable exactly', () => {
    expect(parse({ travelpayouts: { token: { fromEnv: 'TP_1' } } })).toBe(true);
    for (const name of ['myVAR', 'VAR-x', 'my_VAR', '1VAR'])
      expect(parse({ travelpayouts: { token: { fromEnv: name } } })).toBe(false);
  });
  it('pointOfSale is two capital letters', () => {
    expect(parse({ pointOfSale: 'GB' })).toBe(true);
    for (const v of ['GBR', 'G', 'gb', '12', 'xGB']) expect(parse({ pointOfSale: v })).toBe(false);
  });
  it('billingDay is 1 to 28; trialUsed 0 to 100; tls, linger and the browser window take their words only', () => {
    const sa = (x: object) => ({ searchApi: { plan: 'trial', key: 'k', ...x } });
    for (const d of [1, 28]) expect(parse(sa({ billingDay: d }))).toBe(true);
    for (const d of [0, 29, 1.5]) expect(parse(sa({ billingDay: d }))).toBe(false);
    for (const u of [0, 100]) expect(parse(sa({ trialUsed: u }))).toBe(true);
    for (const u of [-1, 101]) expect(parse(sa({ trialUsed: u }))).toBe(false);
    const email = (tls: string) => ({
      email: { host: 'h', port: 465, tls, user: 'u', pass: 'p', to: 't', from: 'f' },
    });
    for (const t of ['implicit', 'starttls', 'none']) expect(parse(email(t))).toBe(true);
    expect(parse(email('tls'))).toBe(false);
    for (const l of ['skip', 'enable']) expect(parse({ linger: l })).toBe(true);
    expect(parse({ linger: 'yes' })).toBe(false);
    for (const w of ['scheduled', 'any']) expect(parse({ browser: { window: w } })).toBe(true);
    for (const b of [{}, { window: 'later' }, { window: 'any', x: 1 }])
      expect(parse({ browser: b })).toBe(false);
  });
  it('plainProblems: a bad market, an unsafe email field and a non-address, each named; none for good answers', () => {
    expect(plainProblems({ ...base, pointOfSale: 'GBR' })).toEqual([
      'pointOfSale: must be two capital letters (an ISO 3166 country)',
    ]);
    const email = {
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit' as const,
      user: 'u"x',
      pass: 'p',
      to: 'a@example.com',
      from: 'nobody',
    };
    expect(plainProblems({ ...base, email })).toEqual([
      'email.user: holds a character app.env cannot carry (", \\, CR or LF)',
      'email.from: not an email address',
    ]);
    expect(plainProblems({ ...base, email: { ...email, user: 'u', from: 'b@example.com' } })).toEqual([]);
    expect(plainProblems(base)).toEqual([]);
  });

  const load = async (
    body: unknown,
    opts: { mode?: number; defaults?: Answers; importedDb?: boolean } = {},
  ) => {
    const w = testWorld();
    w.fs.file('/w/a.json', JSON.stringify(body), opts.mode ?? 0o600);
    return loadAnswersFile('/w/a.json', w.deps, {
      importedDb: opts.importedDb ?? false,
      ...(opts.defaults ? { defaults: opts.defaults } : {}),
    });
  };
  it('a literal SearchApi key or SMTP password alone also needs a 0600 file', async () => {
    expect((await load({ searchApi: { plan: '40usd', key: 'k-0123456789ab' } }, { mode: 0o644 })).ok).toBe(
      false,
    );
    const email = {
      host: 'h.example.com',
      port: 465,
      tls: 'implicit',
      user: 'u',
      pass: 'p-0123456789',
      to: 'a@example.com',
      from: 'b@example.com',
    };
    expect((await load({ email }, { mode: 0o644 })).ok).toBe(false);
    expect((await load({ email: { ...email, pass: { fromEnv: 'NOPE' } } }, { mode: 0o644 })).ok).toBe(false);
  });
  it('schema errors name each issue’s path and code, joined', async () => {
    const r = await load({ port: 1, pointOfSale: 'x', extra: true });
    expect(r.ok).toBe(false);
    const e = r.ok ? '' : r.error;
    expect(e).toContain('/w/a.json: ');
    expect(e).toContain('port: too_small');
    expect(e).toContain('pointOfSale: invalid_format');
    expect(e).toContain('(top level): unrecognized_keys');
    expect(e.split('; ')).toHaveLength(3);
  });
  it('40usd without trialUsed loads, with trialUsed null', async () => {
    const r = await load({ searchApi: { plan: '40usd', key: 'k-0123456789ab' } });
    expect(r.ok && r.answers.searchApi).toEqual({
      plan: '40usd',
      key: 'k-0123456789ab',
      billingDay: 1,
      trialUsed: null,
    });
  });
  it('a group the file leaves out keeps its current value; one set to null is turned off', async () => {
    const current: Answers = {
      ...base,
      travelpayouts: { token: 'tp-current-0123' },
      email: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'implicit',
        user: 'u',
        pass: 'p-0123456789',
        to: 'a@example.com',
        from: 'b@example.com',
      },
      searchApi: { plan: '40usd', key: 'k-0123456789ab', billingDay: 2, trialUsed: null },
      linger: 'enable',
      browser: { window: 'any' },
    };
    const kept = await load({}, { defaults: current });
    expect(kept.ok && kept.answers).toEqual(current);
    const off = await load({ travelpayouts: null, searchApi: null, email: null }, { defaults: current });
    expect(off.ok && [off.answers.travelpayouts, off.answers.searchApi, off.answers.email]).toEqual([
      null,
      null,
      null,
    ]);
  });
  it('several problems are joined with "; "', async () => {
    const r = await load({ timezone: 'Mars/Olympus', pointOfSale: 'GB', travelpayouts: { token: 'a"b' } });
    expect(r.ok ? '' : r.error).toBe(
      'travelpayouts.token: holds a character app.env cannot carry (", \\, CR or LF); timezone: not a time zone this machine knows',
    );
  });
});

describe('app.env edges', () => {
  it('SEARCHAPI_TRIAL_USED only for the trial with a count', () => {
    expect(
      env({ ...base, searchApi: { plan: 'trial', key: 'k', billingDay: 1, trialUsed: null } }),
    ).not.toHaveProperty('SEARCHAPI_TRIAL_USED');
    expect(
      env({ ...base, searchApi: { plan: '40usd', key: 'k', billingDay: 1, trialUsed: 4 } }),
    ).not.toHaveProperty('SEARCHAPI_TRIAL_USED');
    expect(
      env({ ...base, searchApi: { plan: 'trial', key: 'k', billingDay: 1, trialUsed: 0 } })
        .SEARCHAPI_TRIAL_USED,
    ).toBe('0');
  });
  it('a fresh file starts with the two header lines', () => {
    expect(renderAppEnv([['A', 'b']])).toBe(
      '# get-me-there settings for the native app, written by `pnpm gmt setup` (docs/setup.md section 0).\n# Keep this file 0600. Lines under names setup does not own are kept as they are written.\nA="b"\n',
    );
  });
  it('replaceGroups reads a name with spaces or export, ignores comments and longer names, drops a duplicate, and adds nothing else', () => {
    const text = '# PORT=1\nMYPORT=2\n  PORT = "3000"\nexport PORT="3001"\nLOG_LEVEL=debug\n';
    expect(
      replaceGroups(text, entriesFor({ ...base, port: 3917 }, { paths: p.paths, password: PASS }), ['port']),
    ).toBe('# PORT=1\nMYPORT=2\nPORT="3917"\nLOG_LEVEL=debug\n');
    expect(replaceGroups('X=1\n', entriesFor(base, { paths: p.paths, password: PASS }), ['port'])).toBe(
      'X=1\nPORT="3000"\n',
    );
  });
  it('a text that does not read back as intended is refused naming the names', () => {
    const intended = env(base);
    const text = renderAppEnv(entriesFor(base, { paths: p.paths, password: PASS })).replace(
      'PORT="3000"\n',
      '',
    );
    expect(checkAppEnv(text, intended)).toEqual({
      ok: false,
      error: 'app.env would not read back as written: PORT',
    });
    expect(checkAppEnv('A="1"\n', { A: 'x"' })).toEqual({
      ok: false,
      error: 'a value holds a character app.env cannot carry (", \\, CR or LF): A',
    });
  });
  it('several schema failures are named together', () => {
    const a: Answers = {
      ...base,
      timezone: 'Mars/Olympus',
      email: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'none',
        user: 'u',
        pass: 'p',
        to: 'a@example.com',
        from: 'b@example.com',
      },
    };
    const entries = entriesFor(a, { paths: p.paths, password: PASS });
    expect(checkAppEnv(renderAppEnv(entries), Object.fromEntries(entries))).toEqual({
      ok: false,
      error: 'app.env would not pass the app’s settings check: SCHEDULER_TIMEZONE, SMTP_TLS',
    });
    expect(parseEnv(renderAppEnv(entries)).SMTP_TLS).toBe('none');
  });
  it('answersFromRecord: its defaults, each mapping and each fallback', () => {
    expect(answersFromRecord({}, { linger: 'skip' })).toEqual(base);
    expect(answersFromRecord({ PORT: '3917abc' }, { linger: 'skip' }).port).toBe(3000);
    expect(answersFromRecord({ PORT: 'abc3917' }, { linger: 'skip' }).port).toBe(3000);
    expect(
      answersFromRecord({ SCHEDULER_TIMEZONE: 'UTC', POINT_OF_SALE: 'US' }, { linger: 'skip' }),
    ).toMatchObject({
      timezone: 'UTC',
      pointOfSale: 'US',
    });
    expect(
      answersFromRecord({ SEARCHAPI_KEY: 'k', SEARCHAPI_PLAN: '40usd' }, { linger: 'skip' }).searchApi,
    ).toEqual({
      plan: '40usd',
      key: 'k',
      billingDay: 1,
      trialUsed: null,
    });
    expect(
      answersFromRecord(
        { SEARCHAPI_KEY: 'k', SEARCHAPI_PLAN: 'x', SEARCHAPI_TRIAL_USED: '7' },
        { linger: 'skip' },
      ).searchApi,
    ).toMatchObject({
      plan: 'trial',
      trialUsed: 7,
    });
    expect(answersFromRecord({ SMTP_HOST: 'h' }, { linger: 'skip' }).email).toEqual({
      host: 'h',
      port: 465,
      tls: 'implicit',
      user: '',
      pass: '',
      to: '',
      from: '',
    });
    for (const [t, want] of [
      ['none', 'none'],
      ['starttls', 'starttls'],
      ['ssl', 'implicit'],
    ])
      expect(answersFromRecord({ SMTP_HOST: 'h', SMTP_TLS: t }, { linger: 'skip' }).email?.tls).toBe(want);
    expect(answersFromRecord({ CAMOUFOX_BROWSER_WINDOW: 'scheduled' }, { linger: 'skip' }).browser).toEqual({
      window: 'scheduled',
    });
    expect(answersFromRecord({ CAMOUFOX_BROWSER_WINDOW: 'later' }, { linger: 'skip' }).browser).toBeNull();
  });
});
