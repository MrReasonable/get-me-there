import { parseEnv } from 'node:util';
import { type Config, parseConfig } from '@gmt/core';
import type { ReconfigureGroup } from '../args.js';
import type { Paths } from '../platform/types.js';
import { databasePath } from '../services/specs.js';
import type { Answers } from './answers.js';
import { UNSAFE_VALUE } from './secrets.js';

/**
 * The native app's settings file (spec §12 "Where settings live"): rendered from the answers, parsed back with
 * `node:util` `parseEnv` (the parser behind `--env-file`), required to equal what was meant, and checked by `core`'s
 * config schema before it is written. Each `--reconfigure` group owns its names; a name the wizard does not own is the
 * operator's, kept as written.
 */
export const GROUP_NAMES = {
  base: ['NODE_ENV', 'DATABASE_PATH', 'BIND_ADDRESS', 'POINT_OF_SALE', 'APP_BASIC_AUTH_USER'],
  port: ['PORT'],
  timezone: ['SCHEDULER_TIMEZONE'],
  password: ['APP_BASIC_AUTH_PASS'],
  travelpayouts: ['TRAVELPAYOUTS_TOKEN'],
  searchapi: ['SEARCHAPI_KEY', 'SEARCHAPI_PLAN', 'SEARCHAPI_BILLING_DAY', 'SEARCHAPI_TRIAL_USED'],
  email: [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_TLS',
    'SMTP_USER',
    'SMTP_PASS',
    'ALERT_EMAIL_TO',
    'ALERT_EMAIL_FROM',
  ],
  browser: ['CAMOUFOX_BROWSER_WINDOW'],
  // why: linger is the setup record's, not a line of app.env
  linger: [],
} as const satisfies Record<ReconfigureGroup | 'base', readonly string[]>;
export const OWNED_NAMES: readonly string[] = Object.values(GROUP_NAMES).flat();
export const OPERATOR_USER = 'operator';

export type Entries = ReadonlyArray<readonly [string, string]>;

/** The wizard's lines for these answers, in file order. */
export function entriesFor(
  a: Answers,
  x: { paths: Paths; password: string },
): Array<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [
    ['NODE_ENV', 'production'],
    ['DATABASE_PATH', databasePath(x.paths)],
    ['BIND_ADDRESS', '127.0.0.1'],
    ['PORT', String(a.port)],
    ['SCHEDULER_TIMEZONE', a.timezone],
    ['POINT_OF_SALE', a.pointOfSale],
    ['APP_BASIC_AUTH_USER', OPERATOR_USER],
    ['APP_BASIC_AUTH_PASS', x.password],
  ];
  if (a.travelpayouts !== null) out.push(['TRAVELPAYOUTS_TOKEN', a.travelpayouts.token]);
  if (a.searchApi !== null) {
    out.push(
      ['SEARCHAPI_KEY', a.searchApi.key],
      ['SEARCHAPI_PLAN', a.searchApi.plan],
      ['SEARCHAPI_BILLING_DAY', String(a.searchApi.billingDay)],
    );
    if (a.searchApi.plan === 'trial' && a.searchApi.trialUsed !== null)
      out.push(['SEARCHAPI_TRIAL_USED', String(a.searchApi.trialUsed)]);
  }
  if (a.email !== null)
    out.push(
      ['SMTP_HOST', a.email.host],
      ['SMTP_PORT', String(a.email.port)],
      ['SMTP_TLS', a.email.tls],
      ['SMTP_USER', a.email.user],
      ['SMTP_PASS', a.email.pass],
      ['ALERT_EMAIL_TO', a.email.to],
      ['ALERT_EMAIL_FROM', a.email.from],
    );
  if (a.browser !== null) out.push(['CAMOUFOX_BROWSER_WINDOW', a.browser.window]);
  return out;
}

const HEADER = [
  '# get-me-there settings for the native app, written by `pnpm gmt setup` (docs/setup.md section 0).',
  '# Keep this file 0600. Lines under names setup does not own are kept as they are written.',
];
const line = ([name, value]: readonly [string, string]): string => `${name}="${value}"`;

/** A fresh file: the header, then one double-quoted line per entry. */
export function renderAppEnv(entries: Entries): string {
  return `${[...HEADER, ...entries.map(line)].join('\n')}\n`;
}

/** The name a settings line sets (`NAME=`, `export NAME=`), or undefined for a comment, a blank or a continuation. */
export const NAME_OF_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * The one line editor for app.env and worker.env (ca-b1-007): each line under one of `names` is replaced in place by
 * its entry (the first one only; later duplicates are dropped), or dropped when `entries` has no value for it; names
 * not yet in the file are appended; every other line is kept.
 */
export function setLines(text: string, names: ReadonlySet<string>, entries: Entries): string {
  const wanted = new Map(entries.filter(([n]) => names.has(n)));
  const placed = new Set<string>();
  const kept: string[] = [];
  for (const l of text.replace(/\n$/, '').split('\n')) {
    const name = NAME_OF_LINE.exec(l)?.[1];
    if (name === undefined || !names.has(name)) {
      kept.push(l);
      continue;
    }
    const v = wanted.get(name);
    if (v !== undefined && !placed.has(name)) {
      kept.push(line([name, v]));
      placed.add(name);
    }
  }
  for (const [n, v] of wanted) if (!placed.has(n)) kept.push(line([n, v]));
  return `${kept.join('\n')}\n`;
}

/**
 * The file with the groups' lines replaced: each line under one of the groups' names is replaced in place by its new
 * entry (or dropped when the answers no longer have it), new names are appended, and every other line is kept.
 */
export function replaceGroups(
  text: string,
  entries: Entries,
  groups: ReadonlyArray<keyof typeof GROUP_NAMES>,
): string {
  return setLines(text, new Set<string>(groups.flatMap((g) => GROUP_NAMES[g])), entries);
}

/** Whether `text` reads back with exactly these entries' values (names only in the refusal, never a value). */
export function readsBack(text: string, entries: Entries): { ok: true } | { ok: false; error: string } {
  const unsafe = entries.filter(([, v]) => UNSAFE_VALUE.test(v)).map(([k]) => k);
  if (unsafe.length > 0)
    return { ok: false, error: `a value holds a character the file cannot carry: ${unsafe.join(', ')}` };
  const record = readEnvText(text);
  const wrong = entries.filter(([k, v]) => record[k] !== v).map(([k]) => k);
  return wrong.length === 0
    ? { ok: true }
    : { ok: false, error: `would not read back as written: ${wrong.join(', ')}` };
}

/**
 * Checks a text before it is written: no value holds a character the file cannot carry, the text parses back to
 * exactly the intended owned values (and no other owned name), and the parsed record passes `core`'s config schema.
 * Every refusal names fields, never a value.
 */
export function checkAppEnv(
  text: string,
  intended: Readonly<Record<string, string>>,
): { ok: true; record: Record<string, string> } | { ok: false; error: string } {
  const unsafe = Object.entries(intended)
    .filter(([, v]) => UNSAFE_VALUE.test(v))
    .map(([k]) => k);
  if (unsafe.length > 0)
    return {
      ok: false,
      error: `a value holds a character app.env cannot carry (", \\, CR or LF): ${unsafe.join(', ')}`,
    };
  const record = readEnvText(text);
  const mismatched = OWNED_NAMES.filter((k) => record[k] !== intended[k]);
  if (mismatched.length > 0)
    return { ok: false, error: `app.env would not read back as written: ${mismatched.join(', ')}` };
  const config = parseConfig(record, { realpath: (p) => p });
  if (!config.ok)
    return {
      ok: false,
      error: `app.env would not pass the app’s settings check: ${[...new Set(config.errors.map((e) => e.field))].join(', ')}`,
    };
  return { ok: true, record };
}

/** The wizard-owned names whose values differ between the file and the plan. */
export function ownedDiff(
  file: Readonly<Record<string, string | undefined>>,
  plan: Readonly<Record<string, string>>,
): string[] {
  return OWNED_NAMES.filter((k) => file[k] !== plan[k]);
}

/** A settings file read back the way the app reads it: parseEnv, then core's parseConfig (U9, ca-b1-012). */
export type Settings =
  | { ok: true; config: Config; record: Record<string, string> }
  | { ok: false; fields: string[]; record: Record<string, string> };
export function readSettings(text: string): Settings {
  const record = readEnvText(text);
  const r = parseConfig(record, { realpath: (p) => p });
  return r.ok
    ? { ok: true, config: r.config, record }
    : { ok: false, fields: [...new Set(r.errors.map((e) => e.field))].sort(), record };
}

/**
 * The answers a valid settings file amounts to (a re-run keeps them; `--reconfigure` starts from them), every value and
 * default taken from the app's own parse of it. `SEARCHAPI_TRIAL_USED` is an answer only when the file states it.
 */
export function answersFromConfig(
  c: Config,
  r: Readonly<Record<string, string>>,
  rec: { linger: 'skip' | 'enable' },
): Answers {
  const tp = c.providers.travelpayouts;
  const sa = c.providers.searchapi;
  return {
    port: c.port,
    timezone: c.schedulerTimezone,
    pointOfSale: c.pointOfSale,
    travelpayouts: tp === null ? null : { token: tp.token.reveal() },
    searchApi:
      sa === null
        ? null
        : {
            plan: sa.plan,
            key: sa.key.reveal(),
            billingDay: sa.limits.billingDay,
            trialUsed: sa.plan === 'trial' && r.SEARCHAPI_TRIAL_USED !== undefined ? sa.trialUsed : null,
          },
    email:
      c.smtp === null
        ? null
        : {
            host: c.smtp.host,
            port: c.smtp.port,
            tls: c.smtp.tls,
            user: c.smtp.user,
            pass: c.smtp.pass.reveal(),
            to: c.smtp.to,
            from: c.smtp.from,
          },
    linger: rec.linger,
    browser: r.CAMOUFOX_BROWSER_WINDOW === undefined ? null : { window: c.camoufoxBrowserWindow },
  };
}

/** A settings file's text read with the same parser the app uses (spec §12: every reader uses parseEnv). */
export function readEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parseEnv(text))) if (v !== undefined) out[k] = v;
  return out;
}
