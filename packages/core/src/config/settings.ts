import { z } from 'zod';

/**
 * The settings the Settings page owns (UX redesign stage 3, plan rulings 1 and 2). They keep their env names and live in
 * the database's `settings` table: on a boot where a name has no row, its env line (if any) is imported once; from then
 * on the table owns it, and an env line that differs is reported, never applied. Every other variable stays env-only.
 */

/** Ruling 1: the owned names, each with whether its value is a secret (never returned, logged or echoed). */
export const SETTINGS_NAMES = [
  { name: 'TRAVELPAYOUTS_TOKEN', secret: true },
  { name: 'SEARCHAPI_KEY', secret: true },
  { name: 'SEARCHAPI_PLAN', secret: false },
  { name: 'SEARCHAPI_BILLING_DAY', secret: false },
  { name: 'CAMOUFOX_BROWSER_WINDOW', secret: false },
  { name: 'FLIGHT_READ_PATIENCE', secret: false },
  { name: 'DISCOVERY_REFRESH_DAYS', secret: false },
  { name: 'NEW_SEARCH_DISCOVERY', secret: false },
  { name: 'NEW_SEARCH_VERIFICATION', secret: false },
  { name: 'MONTHLY_SPEND_CAP_PENCE', secret: false },
  { name: 'EXECUTION_MAX_CALLS', secret: false },
  { name: 'SMTP_HOST', secret: false },
  { name: 'SMTP_PORT', secret: false },
  { name: 'SMTP_TLS', secret: false },
  { name: 'SMTP_USER', secret: false },
  { name: 'SMTP_PASS', secret: true },
  { name: 'ALERT_EMAIL_TO', secret: false },
  { name: 'ALERT_EMAIL_FROM', secret: false },
] as const satisfies ReadonlyArray<{ name: string; secret: boolean }>;

export type OwnedName = (typeof SETTINGS_NAMES)[number]['name'];

/** The owned names alone, in SETTINGS_NAMES order (the db repository's `z.enum` reads them). */
export const OWNED_NAMES: readonly OwnedName[] = SETTINGS_NAMES.map((s) => s.name);

/** An owned name as data arrives (the db repository's rows, the api's request bodies). */
export const ownedNameSchema = z.enum(OWNED_NAMES);

export function isOwnedName(name: string): name is OwnedName {
  return ownedNameSchema.safeParse(name).success;
}

/** One stored setting: its value as `.env` would hold it; `''` means unset (Ian, 2026-11-19: stored as `.env` stores them). */
export interface SettingRow {
  name: OwnedName;
  value: string;
}

/**
 * What a boot did with the owned names (controller ruling R1: kept on the running app's ports): `imported`, env lines
 * written as rows this boot; `envIgnored`, env lines that differ from a row and so were not applied; `setAside`, stored
 * or imported values the schema refused, left out for this boot (the default used instead) until Settings fixes them.
 */
export interface SettingsReport {
  imported: OwnedName[];
  envIgnored: OwnedName[];
  setAside: OwnedName[];
}

type Env = Record<string, string | undefined>;

/** Spec §12: an empty line is unset. */
function present(v: string | undefined): v is string {
  return v !== undefined && v !== '';
}

/**
 * Ruling 2, one owner per name. A name with no row takes its env line, if any, and is listed in `imports`; a name with a
 * row takes the row (`''` = unset) and, when its env line is set and differs, is listed in `envIgnored`. Every other
 * variable passes through unchanged. Lists follow SETTINGS_NAMES order.
 */
export function layerSettings(
  env: Env,
  rows: readonly SettingRow[],
): { merged: Env; imports: OwnedName[]; envIgnored: OwnedName[] } {
  const merged: Env = { ...env };
  const imports: OwnedName[] = [];
  const envIgnored: OwnedName[] = [];
  for (const name of OWNED_NAMES) {
    const row = rows.find((r) => r.name === name);
    const line = env[name];
    if (row === undefined) {
      if (present(line)) imports.push(name);
      continue;
    }
    merged[name] = row.value;
    if (present(line) && line !== row.value) envIgnored.push(name);
  }
  return { merged, imports, envIgnored };
}

/**
 * The schema's refusal of a mail setting left unset while others are set (spec §8.3: all or nothing). Kept here so
 * settingRefusal can tell it from a value that is wrong; the schema reports it under each missing name.
 */
export const SMTP_ALL_OR_NOTHING = 'SMTP settings are all or nothing';

/** Spec §8.3: the mail settings that are all or nothing, in the order the schema reads them. */
export const SMTP_REQUIRED_NAMES = [
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_EMAIL_TO',
  'ALERT_EMAIL_FROM',
] as const satisfies readonly OwnedName[];

/** Every owned mail setting: the all-or-nothing ones and SMTP_TLS, which has a default. Email is off without them. */
export const EMAIL_NAMES: readonly OwnedName[] = [...SMTP_REQUIRED_NAMES, 'SMTP_TLS'];

/** The page's label for each owned name: the one copy, read by the page and by the api's 422. */
export const SETTING_LABELS: Readonly<Record<OwnedName, string>> = {
  TRAVELPAYOUTS_TOKEN: 'Travelpayouts token',
  SEARCHAPI_KEY: 'SearchApi key',
  SEARCHAPI_PLAN: 'SearchApi plan',
  SEARCHAPI_BILLING_DAY: 'SearchApi billing day',
  CAMOUFOX_BROWSER_WINDOW: 'When the browser may run',
  FLIGHT_READ_PATIENCE: 'Reads in a row without a cheaper trip',
  DISCOVERY_REFRESH_DAYS: "Days before a date's calendar price is read again",
  NEW_SEARCH_DISCOVERY: 'Calendar sources for new searches',
  NEW_SEARCH_VERIFICATION: 'Trip check sources for new searches',
  MONTHLY_SPEND_CAP_PENCE: 'Monthly spend limit',
  EXECUTION_MAX_CALLS: 'SearchApi credits per new search',
  SMTP_HOST: 'Mail server',
  SMTP_PORT: 'Mail server port',
  SMTP_TLS: 'Mail server encryption',
  SMTP_USER: 'Mail server user name',
  SMTP_PASS: 'Mail password',
  ALERT_EMAIL_TO: 'Send alerts to',
  ALERT_EMAIL_FROM: 'Send alerts from',
};

const MAILBOX = 'Give one email address, like you@example.com.';

/** Per-name words for a value the schema refused: no env name, and never the value itself. */
const REFUSAL_WORDS: Readonly<Record<OwnedName, string>> = {
  TRAVELPAYOUTS_TOKEN:
    "This Travelpayouts token can't be used: paste it again from your Travelpayouts account.",
  SEARCHAPI_KEY: "This SearchApi key can't be used: paste it again from your SearchApi dashboard.",
  SEARCHAPI_PLAN: 'Choose Free trial or $40 a month.',
  SEARCHAPI_BILLING_DAY: 'The billing day is a day of the month from 1 to 28.',
  CAMOUFOX_BROWSER_WINDOW: 'Choose only during scheduled searches, or any time.',
  FLIGHT_READ_PATIENCE: 'Choose a whole number of reads from 3 to 50.',
  DISCOVERY_REFRESH_DAYS: 'Choose a whole number of days from 1 to 30.',
  NEW_SEARCH_DISCOVERY: 'Choose calendar sources this app has set up, or none.',
  NEW_SEARCH_VERIFICATION: 'Choose trip check sources this app has set up, or none.',
  MONTHLY_SPEND_CAP_PENCE: 'Give the spend limit in pounds, like 35 or 35.50.',
  EXECUTION_MAX_CALLS: 'Give the SearchApi credits as a whole number, 0 or more.',
  SMTP_HOST: "Give the mail server's name, like smtp.example.com.",
  SMTP_PORT: 'The port is a whole number from 1 to 65535.',
  SMTP_TLS:
    'Choose how the mail server is encrypted; no encryption is allowed only for a mail server on this machine.',
  SMTP_USER: 'Give the user name the mail server signs in with.',
  SMTP_PASS: 'Give the password the mail server signs in with.',
  ALERT_EMAIL_TO: MAILBOX,
  ALERT_EMAIL_FROM: MAILBOX,
};

/**
 * The words the page shows beside a field the schema refused (plan ruling 5's 422): per name, never naming an env
 * variable or quoting the value. A mail setting missing from a half-set group says email needs it.
 */
export function settingRefusal(name: OwnedName, error: { field: string; message: string }): string {
  if (error.message === SMTP_ALL_OR_NOTHING)
    return `Email needs ${SETTING_LABELS[name].toLowerCase()} too: fill it in, or remove email.`;
  return REFUSAL_WORDS[name];
}

/**
 * Money typed in pounds (Global Constraints): digits with an optional `.d` or `.dd`, read as whole pence from the
 * string itself, never through parseFloat, so 1.15 is 115 and not 114.99…; anything else, or more pence than a safe
 * integer holds, is null.
 */
export function poundsToPence(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (m === null) return null;
  const pence = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(pence) ? pence : null;
}
