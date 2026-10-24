import { describe, expect, it } from 'vitest';
import { type Answers, defaultAnswers, searchSource } from '../../src/setup/answers.js';
import { closingScreen, TRIAL_ONLY_TEXT } from '../../src/setup/closing.js';
import { askAnswers, askPasteToken, BROWSER_WINDOW_PROMPT, PROMPTS } from '../../src/setup/prompts.js';
import { scriptedAsk, testIo } from '../support/deps.js';

// why: U3 (po-b1-001, pf-b1-001, pf-b1-010) and U6 (pf-b1-002..008, po-b1-005, -006): the source a search can use, the
// next step in plain words, and questions without variable names
const base = defaultAnswers({ port: 3000, timezone: 'UTC' });
const trial: Answers = {
  ...base,
  searchApi: { plan: 'trial', key: 'k-0123456789ab', billingDay: 1, trialUsed: 0 },
};
const paid: Answers = {
  ...base,
  searchApi: { plan: '40usd', key: 'k-0123456789ab', billingDay: 1, trialUsed: null },
};
const closing = (a: Answers, over: Partial<Parameters<typeof closingScreen>[0]> = {}) =>
  closingScreen({ port: 3000, answers: a, appEnv: '/h/app.env', backupOk: true, os: 'darwin', ...over });

describe('the source a search can use (U3)', () => {
  it('Travelpayouts or the SearchApi monthly plan; the SearchApi trial alone is none', () => {
    expect(searchSource(base)).toBe(false);
    expect(searchSource(trial)).toBe(false);
    expect(searchSource(paid)).toBe(true);
    expect(searchSource({ ...base, travelpayouts: { token: 't-0123456789' } })).toBe(true);
  });
  it('with only the trial the paste question is still asked and the closing screen says the trial is for smoke only', async () => {
    const ask = scriptedAsk(['']);
    await askPasteToken(trial, ask, { interactive: true });
    expect(ask.asked).toEqual(['Paste a token now? (Enter to finish without one)']);
    const text = closing(trial);
    expect(text).toContain('No price source is set up yet');
    expect(text).toContain(TRIAL_ONLY_TEXT);
  });
});

describe('the closing screen (U3, U6)', () => {
  it('always names the next step, and says nothing runs until a search is given a schedule', () => {
    for (const a of [base, paid]) {
      const text = closing(a);
      expect(text).toContain(
        'Next: open http://127.0.0.1:3000, choose Definitions and add a search with your airports and dates',
      );
      expect(text).toContain('Nothing runs on a schedule until you give a search one');
    }
  });
  it('labels the tunnel line as being for another device only, and names the macOS login rule', () => {
    const text = closing(paid);
    expect(text).toContain('Only if you want to reach it from another device:');
    expect(text).toContain(
      'The app runs while you are logged in to this Mac and starts again when you log in',
    );
  });
  it('on Linux with linger off it says the app stops at logout and how to change that', () => {
    const text = closing(paid, { os: 'linux' });
    expect(text).toContain(
      'The app stops when you log out of every session; to keep it running: pnpm gmt setup --reconfigure linger',
    );
    expect(closing({ ...paid, linger: 'enable' }, { os: 'linux' })).not.toContain('stops when you log out');
  });
});

describe('the questions in plain words (U6)', () => {
  it('rows 1 to 7 in order, no variable name in a question; the browser window is separate', () => {
    expect(PROMPTS.map((p) => p.row)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const p of PROMPTS) expect(p.question).not.toMatch(/[A-Z]{2,}_[A-Z]/);
    expect(PROMPTS.find((p) => p.row === 3)?.question).toBe('Fare market');
    expect(PROMPTS.find((p) => p.row === 5)?.help).not.toMatch(/scrap/i);
    expect(PROMPTS.find((p) => p.row === 4)?.help).toContain('hours to days old');
    expect(BROWSER_WINDOW_PROMPT.question).toBe('Browser provider after an interruption');
  });
  it('SearchApi names its plans in words, with the billing day and the trial’s count explained', async () => {
    const ask = scriptedAsk(['', '', '', '', 'trial', 'k-0123456789ab', '', '', '']);
    await askAnswers(ask, { os: 'darwin', defaults: base, rows: null, io: testIo() });
    expect(ask.asked).toContain(
      'SearchApi: Enter for off, trial for the free trial (100 searches, smoke tests only), or 40usd for the $40 a month plan',
    );
    expect(ask.asked).toContain('SearchApi billing day: the day of the month your plan renews (1–28)');
    expect(ask.asked).toContain(
      'Searches already used on the trial (100 minus the searches your SearchApi dashboard says are left)',
    );
  });
  it('linger asks in plain words', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '', '']);
    await askAnswers(ask, { os: 'linux', defaults: base, rows: null, io: testIo() });
    expect(ask.asked.at(-1)).toBe('Keep the app running after you log out?');
  });
});
