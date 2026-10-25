import { describe, expect, it } from 'vitest';
import { defaultAnswers } from '../../src/setup/answers.js';
import { carryOver } from '../../src/setup/importDocker.js';
import { scriptedAsk, testIo, testWorld } from '../support/deps.js';

// why: U2 (cb-b1-001..003): SEARCHAPI_TRIAL_USED counts credits spent outside any ledger (decision 14), so it is never in
// an imported database and always carries; a confirmed group carries every line of it, caps and rates included
const base = defaultAnswers({ port: 3000, timezone: 'Europe/London' });
const COMPOSE = {
  APP_BASIC_AUTH_USER: 'ci',
  APP_BASIC_AUTH_PASS: 'compose-pass-0123',
  SEARCHAPI_KEY: 'sa-key-0123456789',
  SEARCHAPI_PLAN: 'trial',
  SEARCHAPI_TRIAL_USED: '9',
  SEARCHAPI_MONTHLY_CALL_CAP: '80',
  TRAVELPAYOUTS_TOKEN: 'tp-token-0123456789',
  TRAVELPAYOUTS_MONTHLY_CALL_CAP: '1000',
  MONTHLY_SPEND_CAP_PENCE: '0',
  EXECUTION_MAX_FREE_CALLS: '300',
  AUTO_RESUME: 'false',
  SCHEDULER_TIMEZONE: 'America/New_York',
  ALLOWED_HOSTS: 'nas.local:3000',
  CAMOUFOX_ENABLED: 'false',
};

describe('carryOver from the Docker .env', () => {
  it('non-interactively carries every group whole: answers for the wizard’s names, the rest verbatim', async () => {
    const io = testIo();
    const r = await carryOver(testWorld({ io }).deps, scriptedAsk([]), COMPOSE, base, false);
    if (!r.ok) throw new Error(r.error);
    expect(r.answers.searchApi).toEqual({
      plan: 'trial',
      key: 'sa-key-0123456789',
      billingDay: 1,
      trialUsed: 9,
    });
    expect(r.answers.travelpayouts).toEqual({ token: 'tp-token-0123456789' });
    expect(r.answers.timezone).toBe('America/New_York');
    expect(r.extra).toEqual([
      ['TRAVELPAYOUTS_MONTHLY_CALL_CAP', '1000'],
      ['SEARCHAPI_MONTHLY_CALL_CAP', '80'],
      ['MONTHLY_SPEND_CAP_PENCE', '0'],
      ['EXECUTION_MAX_FREE_CALLS', '300'],
      ['AUTO_RESUME', 'false'],
    ]);
    expect([...r.rows].sort()).toEqual([2, 4, 5]);
    expect(io.stdout).toContain('ALLOWED_HOSTS=nas.local:3000; it is not copied');
    expect(io.stdout).toContain('CAMOUFOX_ENABLED is not copied');
    for (const secret of ['sa-key-0123456789', 'tp-token-0123456789', 'compose-pass-0123'])
      expect(io.stdout).not.toContain(secret);
  });
  it('interactively each group is confirmed, naming the lines it carries; a declined group carries nothing', async () => {
    const ask = scriptedAsk([true, false, true, false]);
    const r = await carryOver(testWorld().deps, ask, COMPOSE, base, true);
    if (!r.ok) throw new Error(r.error);
    expect(ask.asked).toEqual([
      'Carry the Travelpayouts lines (TRAVELPAYOUTS_TOKEN, TRAVELPAYOUTS_MONTHLY_CALL_CAP) from the Docker .env into app.env?',
      'Carry the SearchApi lines (SEARCHAPI_KEY, SEARCHAPI_PLAN, SEARCHAPI_TRIAL_USED, SEARCHAPI_MONTHLY_CALL_CAP) from the Docker .env into app.env?',
      'Carry the time zone (SCHEDULER_TIMEZONE) from the Docker .env into app.env?',
      'Carry the spending caps and run settings (MONTHLY_SPEND_CAP_PENCE, EXECUTION_MAX_FREE_CALLS, AUTO_RESUME) from the Docker .env into app.env?',
    ]);
    expect(r.answers.searchApi).toBeNull();
    expect(r.extra).toEqual([['TRAVELPAYOUTS_MONTHLY_CALL_CAP', '1000']]);
  });
  it('a Docker .env the app would refuse is refused by its fields', async () => {
    const r = await carryOver(
      testWorld().deps,
      scriptedAsk([]),
      { ...COMPOSE, SEARCHAPI_PLAN: 'cheap' },
      base,
      false,
    );
    expect(r).toEqual({
      ok: false,
      error: 'the Docker .env would not pass the app’s settings check: SEARCHAPI_PLAN',
    });
  });
});

// why: Ian's ruling on PR #11 (survivors before merge): which lines an import carries, asks about, shows or reports as
// left behind, and the exact Docker steps it plans, asserted as behaviour.
describe('carryOver: what is carried, asked, shown and left (survivors, PR #11)', () => {
  const AUTH = { APP_BASIC_AUTH_USER: 'ci', APP_BASIC_AUTH_PASS: 'compose-pass-0123' };
  const run = async (
    record: Record<string, string>,
    answers: Array<string | boolean> = [],
    interactive = false,
  ) => {
    const io = testIo();
    const ask = scriptedAsk(answers);
    const r = await carryOver(testWorld({ io }).deps, ask, { ...AUTH, ...record }, base, interactive);
    return { r, io, ask };
  };
  it('a name only containing a group’s prefix is no part of that group: it is reported as not copied', async () => {
    const { r, io } = await run({
      OLD_TRAVELPAYOUTS_TOKEN: 'x',
      OLD_SEARCHAPI_KEY: 'x',
      MY_SMTP_HOST: 'x',
      SCHEDULER_TIMEZONE_OLD: 'x',
      OLD_SCHEDULER_TIMEZONE: 'x',
      POINT_OF_SALE_OLD: 'x',
      OLD_POINT_OF_SALE: 'x',
      MY_AUTO_RESUME: 'x',
      AUTO_RESUME_OLD: 'x',
      MY_PORT: 'x',
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.extra).toEqual([]);
    expect(r.rows.size).toBe(0);
    for (const n of [
      'OLD_TRAVELPAYOUTS_TOKEN',
      'OLD_SEARCHAPI_KEY',
      'MY_SMTP_HOST',
      'SCHEDULER_TIMEZONE_OLD',
      'OLD_SCHEDULER_TIMEZONE',
      'POINT_OF_SALE_OLD',
      'OLD_POINT_OF_SALE',
      'MY_AUTO_RESUME',
      'AUTO_RESUME_OLD',
      'MY_PORT',
    ])
      expect(io.stdout).toContain(`The Docker .env’s ${n} is not copied.\n`);
  });
  it('asks about the email settings and the market by name, Enter carrying each; their rows are then answered', async () => {
    const { r, ask } = await run(
      {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_TLS: 'implicit',
        SMTP_USER: 'u',
        SMTP_PASS: 'p-0123456789',
        ALERT_EMAIL_TO: 'a@example.com',
        ALERT_EMAIL_FROM: 'b@example.com',
        POINT_OF_SALE: 'US',
      },
      ['', ''],
      true,
    );
    if (!r.ok) throw new Error(r.error);
    expect(ask.asked).toEqual([
      'Carry the email settings (SMTP_HOST, SMTP_PORT, SMTP_TLS, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO, ALERT_EMAIL_FROM) from the Docker .env into app.env?',
      'Carry the market (POINT_OF_SALE) from the Docker .env into app.env?',
    ]);
    expect([...r.rows].sort()).toEqual([3, 6]);
    expect(r.answers.pointOfSale).toBe('US');
    expect(r.answers.email?.host).toBe('smtp.example.com');
  });
  it('a declined group keeps the answer it had and answers no row', async () => {
    const { r } = await run(
      { POINT_OF_SALE: 'US', SCHEDULER_TIMEZONE: 'America/New_York' },
      [false, false],
      true,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.answers.pointOfSale).toBe(base.pointOfSale);
    expect(r.answers.timezone).toBe(base.timezone);
    expect(r.rows.size).toBe(0);
  });
  it('carrying only the time zone leaves the market, the vendors and email as they were', async () => {
    const { r } = await run({ SCHEDULER_TIMEZONE: 'America/New_York' });
    if (!r.ok) throw new Error(r.error);
    expect(r.answers).toEqual({ ...base, timezone: 'America/New_York' });
    expect([...r.rows]).toEqual([2]);
  });
  it('empty lines are neither carried, asked about, shown nor reported', async () => {
    const { r, io, ask } = await run({ TRAVELPAYOUTS_TOKEN: '', ALLOWED_HOSTS: '', FOO_BAR: '' }, [], true);
    if (!r.ok) throw new Error(r.error);
    expect(ask.asked).toEqual([]);
    expect(r.answers.travelpayouts).toBe(base.travelpayouts);
    expect(io.stdout).toBe('');
  });
  it('shows APP_BASE_URL with its value, not copied; names an unknown line and a browser line with the native way', async () => {
    const { r, io } = await run({
      APP_BASE_URL: 'https://nas.local',
      FOO_BAR: '1',
      CAMOUFOX_ENABLED: 'false',
      PORT: '4000',
    });
    if (!r.ok) throw new Error(r.error);
    expect(io.stdout).toBe(
      [
        'The Docker .env also sets APP_BASE_URL=https://nas.local; it is not copied (the native app listens on 127.0.0.1 only).',
        'The Docker .env’s FOO_BAR is not copied.',
        'The Docker .env’s CAMOUFOX_ENABLED is not copied (set the browser provider up natively instead).',
        '',
      ].join('\n'),
    );
  });
  it('a .env the app would refuse names its own bad lines, sorted, never the ones the native install sets', async () => {
    const { r } = await run({
      SCHEDULER_TIMEZONE: 'Mars/Olympus',
      POINT_OF_SALE: 'not a market',
      APP_BASIC_AUTH_PASS: 'x',
    });
    expect(r).toEqual({
      ok: false,
      error: 'the Docker .env would not pass the app’s settings check: POINT_OF_SALE, SCHEDULER_TIMEZONE',
    });
  });
});

describe('the Docker steps an import plans (survivors, PR #11)', () => {
  it('each runs through compose with the child environment; the backup and the marker are exactly these commands', async () => {
    const m = await import('../../src/setup/importDocker.js');
    const deps = testWorld().deps;
    const actions = [
      m.dockerBackupAction(deps),
      m.dockerStopAction(deps),
      m.dockerCopyAction(deps, '/data/backups/get-me-there-x.db'),
      m.dockerMarkerAction(deps),
      m.dockerDownAction(deps),
    ];
    for (const a of actions) expect(a.kind === 'run' && a.env).toEqual(deps.childEnv);
    const [backup, , copy, marker] = actions;
    expect(backup?.kind === 'run' && backup.argv).toEqual([
      'docker',
      'compose',
      '-p',
      'get-me-there',
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'app',
      'scripts/backup.mjs',
      '--dir',
      '/data/backups',
    ]);
    expect(copy?.kind === 'run' && copy.argv.slice(4)).toEqual([
      'cp',
      'app:/data/backups/get-me-there-x.db',
      '/Users/op/.local/share/get-me-there/backups/get-me-there-x.db',
    ]);
    // the marker's text is no secret: an error may show it
    expect(marker?.kind === 'run' && marker.stdin?.secret).toBe(false);
  });
});

describe('the Docker app as the import sees it (survivors, PR #11)', () => {
  const RUNNING = `${JSON.stringify({ Service: 'app', State: 'running' })}\n`;
  const world = (ps: { code: number; stdout?: string }, port?: { code: number; stdout?: string }) =>
    testWorld({
      run: (argv) => {
        if (argv[4] === 'ps') return ps;
        if (argv[4] === 'port') return port ?? { code: 1 };
        return undefined;
      },
    });
  it('asks compose for every container as JSON, then the app’s published port 3000, from the checkout', async () => {
    const { composeFacts } = await import('../../src/setup/importDocker.js');
    const w = world({ code: 0, stdout: RUNNING }, { code: 0, stdout: '0.0.0.0:49153\n' });
    w.fs.file('/repo/.env', 'APP_BASIC_AUTH_USER=ci\n');
    expect(await composeFacts(w.deps)).toEqual({
      record: { APP_BASIC_AUTH_USER: 'ci' },
      appRunning: true,
      port: 49153,
    });
    expect(w.runner.calls.map((c) => [c.argv.slice(4).join(' '), c.cwd])).toEqual([
      ['ps -a --format json', '/repo'],
      ['port app 3000', '/repo'],
    ]);
  });
  it('a failed ps is no running app, and no port is asked; no .env is no record', async () => {
    const { composeFacts } = await import('../../src/setup/importDocker.js');
    const w = world({ code: 1, stdout: RUNNING });
    expect(await composeFacts(w.deps)).toEqual({ record: null, appRunning: false, port: null });
    expect(w.runner.calls).toHaveLength(1);
  });
  it.each([
    ['a failed port command', { code: 1, stdout: '0.0.0.0:49153\n' }],
    ['an answer that does not end in a port', { code: 0, stdout: '0.0.0.0:49153 extra\n' }],
    ['no port at all', { code: 0, stdout: 'nothing\n' }],
    ['a port run into other text', { code: 0, stdout: '0.0.0.0:49153x\n' }],
  ])('%s gives no port', async (_n, port) => {
    const { composeFacts } = await import('../../src/setup/importDocker.js');
    expect((await composeFacts(world({ code: 0, stdout: RUNNING }, port).deps)).port).toBeNull();
  });
  it('the guard reaches the Docker app only with both its basic auth and its port; AUTO_RESUME=false is read', async () => {
    const { dockerGuardTarget } = await import('../../src/setup/importDocker.js');
    const auth = { APP_BASIC_AUTH_USER: 'ci', APP_BASIC_AUTH_PASS: 'compose-pass-0123' };
    expect(dockerGuardTarget({ record: auth, appRunning: true, port: 49153 })).toEqual({
      label: 'the Docker app',
      up: true,
      creds: { user: 'ci', pass: 'compose-pass-0123', port: 49153 },
      autoResume: true,
    });
    expect(dockerGuardTarget({ record: auth, appRunning: true, port: null }).creds).toBeNull();
    expect(dockerGuardTarget({ record: {}, appRunning: true, port: 49153 }).creds).toBeNull();
    expect(dockerGuardTarget({ record: null, appRunning: false, port: null })).toEqual({
      label: 'the Docker app',
      up: false,
      creds: null,
      autoResume: true,
    });
    expect(
      dockerGuardTarget({ record: { ...auth, AUTO_RESUME: 'false' }, appRunning: true, port: 1 }).autoResume,
    ).toBe(false);
  });
});

describe('carryOver: one group’s answers only (survivors, PR #11)', () => {
  const AUTH = { APP_BASIC_AUTH_USER: 'ci', APP_BASIC_AUTH_PASS: 'compose-pass-0123' };
  const EMAIL = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_TLS: 'implicit',
    SMTP_USER: 'u',
    SMTP_PASS: 'p-0123456789',
    ALERT_EMAIL_TO: 'a@example.com',
    ALERT_EMAIL_FROM: 'b@example.com',
  };
  it('carrying Travelpayouts alone sets no market, email or time zone from the Docker .env', async () => {
    const r = await carryOver(
      testWorld().deps,
      scriptedAsk([true, false, false, false]),
      {
        ...AUTH,
        TRAVELPAYOUTS_TOKEN: 'tp-token-0123456789',
        ...EMAIL,
        SCHEDULER_TIMEZONE: 'America/New_York',
        POINT_OF_SALE: 'US',
      },
      base,
      true,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.answers).toEqual({ ...base, travelpayouts: { token: 'tp-token-0123456789' } });
  });
  it('carrying the market alone sets no Travelpayouts token', async () => {
    const r = await carryOver(
      testWorld().deps,
      scriptedAsk([false, true]),
      { ...AUTH, TRAVELPAYOUTS_TOKEN: 'tp-token-0123456789', POINT_OF_SALE: 'US' },
      base,
      true,
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.answers).toEqual({ ...base, pointOfSale: 'US' });
  });
  it('a carried line is never also reported as not copied; the native install’s own lines are not mentioned', async () => {
    const io = testIo();
    const r = await carryOver(
      testWorld({ io }).deps,
      scriptedAsk([]),
      {
        ...AUTH,
        TRAVELPAYOUTS_TOKEN: 'tp-token-0123456789',
        FOO: '1',
        NODE_ENV: 'production',
        DATABASE_PATH: '/data/x.db',
        BIND_ADDRESS: '0.0.0.0',
      },
      base,
      false,
    );
    if (!r.ok) throw new Error(r.error);
    expect(io.stdout).toBe('The Docker .env’s FOO is not copied.\n');
  });
});
