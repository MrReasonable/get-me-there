import { isValidTimeZone } from '@gmt/core';
import type { Ask } from '../ask.js';
import type { Io } from '../deps.js';
import { type Answers, hasPriceSource, PORT_RANGE } from './answers.js';

/**
 * The wizard's prompt table (brief §6, pinned by a docs test against docs/setup.md section 0). Row 8, the browser
 * provider itself, is WP17's and is not asked until it lands; row 9 is asked only by `--reconfigure browser`.
 */
export const TP_SIGNUP_URL = 'https://www.travelpayouts.com/';
export const TP_TOKEN_URL = 'https://support.travelpayouts.com/hc/en-us/articles/203956083';
export const PROMPTS = [
  {
    row: 1,
    question: 'Port',
    default: '3000, or the next free one',
    help: 'The app listens on this machine only (127.0.0.1).',
  },
  {
    row: 2,
    question: 'Time zone for schedules',
    default: 'the machine’s',
    help: 'Scheduled searches fire in this zone.',
  },
  { row: 3, question: 'Market (POINT_OF_SALE)', default: 'GB', help: 'Prices stay in pounds in this build.' },
  {
    row: 4,
    question: 'Travelpayouts token',
    default: 'skip',
    help: `Free, cached prices from Aviasales users’ searches; constraints are not checked. Needs a free Travelpayouts account: if you have none, register at ${TP_SIGNUP_URL}, then open the API token page (${TP_TOKEN_URL}).`,
  },
  {
    row: 5,
    question: 'SearchApi',
    default: 'off',
    help: '`trial`: a one-off allowance for a smoke test and spikes, never run on a schedule. `40usd`: about £32 a month, prices scraped from Google Flights by SearchApi.',
  },
  { row: 6, question: 'Email alerts', default: 'skip', help: 'Send alerts and notices by email.' },
  {
    row: 7,
    question: 'Keep running when nobody is logged in (Linux)',
    default: 'no',
    help: 'Lets the app keep running after you log out (loginctl enable-linger).',
  },
  {
    row: 9,
    question: 'Browser provider after an interruption',
    default: 'no',
    help: 'If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours? [no]',
  },
] as const;
export type PromptRow = (typeof PROMPTS)[number]['row'];

export const PASTE_TOKEN_QUESTION = 'Paste a token now? (Enter to finish without one)';
export const CREDITS_USED_QUESTION =
  'Credits already used (100 minus the dashboard’s remaining free searches)';
export const BROWSER_WINDOW_QUESTION =
  'If a run is interrupted (for example the laptop sleeps), should the browser part finish when it resumes, even outside the scheduled hours?';

const TRIES = 3;

/** Asks until `parse` accepts the answer, three times at most. */
async function asked<T>(
  io: Io,
  label: string,
  ask: () => Promise<string>,
  parse: (s: string) => T | null,
): Promise<T> {
  for (let i = 0; i < TRIES; i++) {
    const v = parse(await ask());
    if (v !== null) return v;
    io.out(`  that is not a valid answer for ${label}\n`);
  }
  throw new Error(`${label}: no valid answer after ${TRIES} tries`);
}
const intIn =
  (min: number, max: number) =>
  (s: string): number | null =>
    /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max ? Number(s) : null;

export interface PromptContext {
  os: 'darwin' | 'linux';
  /** The current values: the defaults on a first setup, the file's values under `--reconfigure`. */
  defaults: Answers;
  /** True after an import, so the SearchApi trial's spent credits are already on the imported ledger. */
  importedDb: boolean;
  /** The rows to ask (`--reconfigure`), or null for a first setup's rows 1–7. */
  rows: ReadonlySet<PromptRow> | null;
  io: Io;
}

/** Asks the prompt table's rows in order and returns the answers; rows not asked keep their current values. */
export async function askAnswers(ask: Ask, ctx: PromptContext): Promise<Answers> {
  const a: Answers = { ...ctx.defaults };
  const want = (row: PromptRow) => (ctx.rows === null ? row <= 7 : ctx.rows.has(row));
  const help = (row: PromptRow) => ctx.io.out(`\n${PROMPTS.find((p) => p.row === row)?.help ?? ''}\n`);

  if (want(1)) {
    help(1);
    a.port = await asked(
      ctx.io,
      'Port',
      () => ask.text('Port', String(a.port)),
      intIn(PORT_RANGE.min, PORT_RANGE.max),
    );
  }
  if (want(2)) {
    help(2);
    a.timezone = await asked(
      ctx.io,
      'Time zone for schedules',
      () => ask.text('Time zone for schedules', a.timezone),
      (s) => (isValidTimeZone(s) ? s : null),
    );
  }
  if (want(3)) {
    help(3);
    a.pointOfSale = await asked(
      ctx.io,
      'Market (POINT_OF_SALE)',
      () => ask.text('Market (POINT_OF_SALE)', a.pointOfSale),
      (s) => (/^[A-Z]{2}$/.test(s.toUpperCase()) ? s.toUpperCase() : null),
    );
  }
  if (want(4)) {
    help(4);
    const token = await ask.secret('Travelpayouts token (hidden; Enter to skip):');
    a.travelpayouts = token === '' ? (ctx.rows === null ? null : a.travelpayouts) : { token };
  }
  if (want(5)) {
    help(5);
    const plan = await asked(
      ctx.io,
      'SearchApi',
      () => ask.text('SearchApi: trial, 40usd, or Enter for off', a.searchApi?.plan ?? 'off'),
      (s) => (s === 'off' || s === 'trial' || s === '40usd' ? s : null),
    );
    if (plan === 'off') a.searchApi = null;
    else {
      const key = await ask.secret('SearchApi key (hidden):');
      const billingDay = await asked(
        ctx.io,
        'SearchApi billing day',
        () => ask.text('SearchApi billing day (1–28)', String(a.searchApi?.billingDay ?? 1)),
        intIn(1, 28),
      );
      const trialUsed =
        plan === 'trial' && !ctx.importedDb
          ? await asked(
              ctx.io,
              'Credits already used',
              () => ask.text(CREDITS_USED_QUESTION, String(a.searchApi?.trialUsed ?? 0)),
              intIn(0, 100),
            )
          : null;
      a.searchApi = { plan, key, billingDay, trialUsed };
    }
  }
  if (want(6)) {
    help(6);
    if (await ask.confirm('Email alerts? (send alerts and notices by email)', a.email !== null)) {
      const host = await ask.text('SMTP host', a.email?.host ?? null);
      const port = await asked(
        ctx.io,
        'SMTP port',
        () => ask.text('SMTP port', String(a.email?.port ?? 465)),
        intIn(1, 65535),
      );
      const tls = await asked(
        ctx.io,
        'SMTP TLS',
        () => ask.text('SMTP TLS: implicit, starttls or none', a.email?.tls ?? 'implicit'),
        (s) => (s === 'implicit' || s === 'starttls' || s === 'none' ? s : null),
      );
      const user = await ask.text('SMTP user', a.email?.user ?? null);
      const pass = await ask.secret('SMTP password (hidden):');
      const to = await ask.text('Send alerts to', a.email?.to ?? null);
      const from = await ask.text('Send from', a.email?.from ?? null);
      a.email = { host, port, tls, user, pass, to, from };
    } else a.email = null;
  }
  if (want(7) && ctx.os === 'linux') {
    help(7);
    a.linger = (await ask.confirm('Keep running when nobody is logged in (Linux)?', a.linger === 'enable'))
      ? 'enable'
      : 'skip';
  }
  if (ctx.rows?.has(9) === true) {
    a.browser = {
      window: (await ask.confirm(BROWSER_WINDOW_QUESTION, a.browser?.window === 'any')) ? 'any' : 'scheduled',
    };
  }
  return a;
}

/**
 * Brief §6: with no price source on an interactive terminal, asked once before the plan is applied. A pasted token is
 * written as `TRAVELPAYOUTS_TOKEN`, exactly as row 4's answer; Enter leaves the answers as they are.
 */
export async function askPasteToken(a: Answers, ask: Ask, ctx: { interactive: boolean }): Promise<Answers> {
  if (hasPriceSource(a) || !ctx.interactive) return a;
  const token = await ask.secret(PASTE_TOKEN_QUESTION);
  return token === '' ? a : { ...a, travelpayouts: { token } };
}
