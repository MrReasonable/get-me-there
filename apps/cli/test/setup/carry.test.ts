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
