import { parseEnv } from 'node:util';
import { parseConfig } from '@gmt/core';
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
} as const satisfies Record<ReconfigureGroup | 'base', readonly string[]>;
export const OWNED_NAMES: readonly string[] = Object.values(GROUP_NAMES).flat();
/** The names whose values are secrets. */
export const SECRET_NAMES: readonly string[] = [
  'APP_BASIC_AUTH_PASS',
  'TRAVELPAYOUTS_TOKEN',
  'SEARCHAPI_KEY',
  'SMTP_PASS',
];
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

const NAME_OF_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/**
 * The file with the groups' lines replaced: each line under one of the groups' names is replaced in place by its new
 * entry (or dropped when the answers no longer have it), new names are appended, and every other line is kept.
 */
export function replaceGroups(
  text: string,
  entries: Entries,
  groups: ReadonlyArray<keyof typeof GROUP_NAMES>,
): string {
  const names = new Set<string>(groups.flatMap((g) => GROUP_NAMES[g]));
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
  const parsed = parseEnv(text);
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (v !== undefined) record[k] = v;
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

const int = (s: string | undefined, def: number): number =>
  s !== undefined && /^\d+$/.test(s) ? Number(s) : def;

/** The answers an existing file's owned lines amount to (a re-run keeps them; `--reconfigure` starts from them). */
export function answersFromRecord(
  r: Readonly<Record<string, string | undefined>>,
  rec: { linger: 'skip' | 'enable' },
): Answers {
  const tls = r.SMTP_TLS;
  const plan = r.SEARCHAPI_PLAN;
  const window = r.CAMOUFOX_BROWSER_WINDOW;
  return {
    port: int(r.PORT, 3000),
    timezone: r.SCHEDULER_TIMEZONE ?? 'Europe/London',
    pointOfSale: r.POINT_OF_SALE ?? 'GB',
    travelpayouts: r.TRAVELPAYOUTS_TOKEN === undefined ? null : { token: r.TRAVELPAYOUTS_TOKEN },
    searchApi:
      r.SEARCHAPI_KEY === undefined
        ? null
        : {
            plan: plan === '40usd' ? '40usd' : 'trial',
            key: r.SEARCHAPI_KEY,
            billingDay: int(r.SEARCHAPI_BILLING_DAY, 1),
            trialUsed: r.SEARCHAPI_TRIAL_USED === undefined ? null : int(r.SEARCHAPI_TRIAL_USED, 0),
          },
    email:
      r.SMTP_HOST === undefined
        ? null
        : {
            host: r.SMTP_HOST,
            port: int(r.SMTP_PORT, 465),
            tls: tls === 'starttls' || tls === 'none' ? tls : 'implicit',
            user: r.SMTP_USER ?? '',
            pass: r.SMTP_PASS ?? '',
            to: r.ALERT_EMAIL_TO ?? '',
            from: r.ALERT_EMAIL_FROM ?? '',
          },
    linger: rec.linger,
    browser: window === 'scheduled' || window === 'any' ? { window } : null,
  };
}

/** A settings file's text read with the same parser the app uses (spec §12: every reader uses parseEnv). */
export function readEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parseEnv(text))) if (v !== undefined) out[k] = v;
  return out;
}
