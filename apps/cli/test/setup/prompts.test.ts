import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAnswers } from '../../src/setup/answers.js';
import { askAnswers, askPasteToken, PASTE_TOKEN_QUESTION, PROMPTS } from '../../src/setup/prompts.js';
import { scriptedAsk, testIo } from '../support/deps.js';

const ctx = (over: Partial<Parameters<typeof askAnswers>[1]> = {}) => ({
  os: 'darwin' as const,
  defaults: defaultAnswers({ port: 3000, timezone: 'Europe/London' }),
  importedDb: false,
  rows: null,
  io: testIo(),
  ...over,
});

// why: spec §13 "setup calls no vendor": the prompts run with fetch failing the test if anything calls it
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('setup must not call fetch');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the wizard’s prompts (brief §6)', () => {
  it('the table is §6’s rows in order, with their one-line help', () => {
    expect(PROMPTS.map((p) => [p.row, p.question])).toEqual([
      [1, 'Port'],
      [2, 'Time zone for schedules'],
      [3, 'Market (POINT_OF_SALE)'],
      [4, 'Travelpayouts token'],
      [5, 'SearchApi'],
      [6, 'Email alerts'],
      [7, 'Keep running when nobody is logged in (Linux)'],
      [9, 'Browser provider after an interruption'],
    ]);
    expect(PROMPTS.find((p) => p.row === 4)?.help).toBe(
      'Free, cached prices from Aviasales users’ searches; constraints are not checked. Needs a free Travelpayouts account: if you have none, register at https://www.travelpayouts.com/, then open the API token page (https://support.travelpayouts.com/hc/en-us/articles/203956083).',
    );
    expect(PROMPTS.find((p) => p.row === 1)?.help).toBe('The app listens on this machine only (127.0.0.1).');
  });

  it('Enter through every prompt gives a running app with no price source, no email, no linger (darwin: rows 1–6)', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '']);
    const a = await askAnswers(ask, ctx());
    expect(a).toEqual(defaultAnswers({ port: 3000, timezone: 'Europe/London' }));
    expect(ask.asked).toEqual([
      'Port',
      'Time zone for schedules',
      'Market (POINT_OF_SALE)',
      'Travelpayouts token (hidden; Enter to skip):',
      'SearchApi: trial, 40usd, or Enter for off',
      'Email alerts? (send alerts and notices by email)',
    ]);
  });

  it('on Linux row 7 follows; yes is linger: enable', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '', true]);
    expect((await askAnswers(ask, ctx({ os: 'linux' }))).linger).toBe('enable');
    expect(ask.asked.at(-1)).toBe('Keep running when nobody is logged in (Linux)?');
  });

  it('each prompt prints its help line first', async () => {
    const io = testIo();
    await askAnswers(scriptedAsk(['', '', '', '', '', '']), ctx({ io }));
    for (const p of PROMPTS.filter((x) => x.row <= 6)) expect(io.stdout).toContain(p.help);
  });

  it('SearchApi trial without an imported database asks the credits already used (default 0)', async () => {
    const ask = scriptedAsk(['', '', '', '', 'trial', 'sa-key-0123456789', '', '', '']);
    const a = await askAnswers(ask, ctx());
    expect(a.searchApi).toEqual({ plan: 'trial', key: 'sa-key-0123456789', billingDay: 1, trialUsed: 0 });
    expect(ask.asked).toContain('Credits already used (100 minus the dashboard’s remaining free searches)');
  });
  it('trial with an imported database, or 40usd, never asks it', async () => {
    const imported = scriptedAsk(['', '', '', '', 'trial', 'sa-key-0123456789', '', '']);
    expect((await askAnswers(imported, ctx({ importedDb: true }))).searchApi?.trialUsed).toBeNull();
    const paid = scriptedAsk(['', '', '', '', '40usd', 'sa-key-0123456789', '12', '']);
    expect((await askAnswers(paid, ctx())).searchApi).toEqual({
      plan: '40usd',
      key: 'sa-key-0123456789',
      billingDay: 12,
      trialUsed: null,
    });
    for (const a of [imported, paid]) expect(a.asked.join('\n')).not.toContain('Credits already used');
  });
  it('--reconfigure searchapi asks only row 5, the credits included', async () => {
    const ask = scriptedAsk(['trial', 'sa-key-0123456789', '', '7']);
    const a = await askAnswers(ask, ctx({ rows: new Set([5]) }));
    expect(a.searchApi?.trialUsed).toBe(7);
    expect(ask.asked).toHaveLength(4);
  });

  it('email asks host, port, TLS, user, password (hidden), to and from', async () => {
    const ask = scriptedAsk([
      '',
      '',
      '',
      '',
      '',
      true,
      'smtp.example.com',
      '',
      '',
      'me',
      'pw-0123456789',
      'me@example.com',
      'gmt@example.com',
    ]);
    const a = await askAnswers(ask, ctx());
    expect(a.email).toEqual({
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit',
      user: 'me',
      pass: 'pw-0123456789',
      to: 'me@example.com',
      from: 'gmt@example.com',
    });
  });

  it('a bad answer is asked again, then refused naming the row', async () => {
    const ask = scriptedAsk(['70000', '3917', 'Mars/Olympus', '', '', '', '', '', '']);
    expect((await askAnswers(ask, ctx())).port).toBe(3917);
    const bad = scriptedAsk(['x', 'y', 'z']);
    await expect(askAnswers(bad, ctx())).rejects.toThrow('Port: no valid answer after 3 tries');
  });

  it('row 9 (browser after an interruption) is asked only with --reconfigure browser, current value as default', async () => {
    const ask = scriptedAsk(['']);
    const a = await askAnswers(
      ask,
      ctx({ rows: new Set([9]), defaults: { ...ctx().defaults, browser: { window: 'any' } } }),
    );
    expect(a.browser).toEqual({ window: 'any' });
    expect(ask.asked).toEqual([
      'If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours?',
    ]);
    expect((await askAnswers(scriptedAsk([true]), ctx({ rows: new Set([9]) }))).browser).toEqual({
      window: 'any',
    });
    expect((await askAnswers(scriptedAsk([false]), ctx({ rows: new Set([9]) }))).browser).toEqual({
      window: 'scheduled',
    });
  });
});

describe('“Paste a token now?” (brief §6)', () => {
  const none = defaultAnswers({ port: 3000, timezone: 'UTC' });
  it('asked exactly once with no price source on a TTY; Enter leaves the answers unchanged', async () => {
    const ask = scriptedAsk(['']);
    expect(await askPasteToken(none, ask, { interactive: true })).toEqual(none);
    expect(ask.asked).toEqual([PASTE_TOKEN_QUESTION]);
    expect(PASTE_TOKEN_QUESTION).toBe('Paste a token now? (Enter to finish without one)');
  });
  it('a pasted token gives the same answers as answering row 4', async () => {
    const pasted = await askPasteToken(none, scriptedAsk(['tp-token-0123456789']), { interactive: true });
    const row4 = await askAnswers(
      scriptedAsk(['', '', '', 'tp-token-0123456789', '', '']),
      ctx({ defaults: none }),
    );
    expect(pasted).toEqual(row4);
  });
  it('never asked with a price source, or when not interactive', async () => {
    const ask = scriptedAsk([]);
    const withSource = { ...none, travelpayouts: { token: 'tp-token-0123456789' } };
    expect(await askPasteToken(withSource, ask, { interactive: true })).toEqual(withSource);
    const withSa = {
      ...none,
      searchApi: { plan: '40usd' as const, key: 'k-0123456789ab', billingDay: 1, trialUsed: null },
    };
    expect(await askPasteToken(withSa, ask, { interactive: true })).toEqual(withSa);
    expect(await askPasteToken(none, ask, { interactive: false })).toEqual(none);
    expect(ask.asked).toEqual([]);
  });
});
