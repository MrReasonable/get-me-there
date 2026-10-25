import { basename, join } from 'node:path/posix';
import { MOVED_MARKER } from '@gmt/core';
import { credsFrom } from '../appClient.js';
import type { Ask } from '../ask.js';
import type { GuardTarget } from '../commands/guard.js';
import type { Deps } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import type { Answers } from './answers.js';
import { answersFromConfig, OWNED_NAMES, readEnvText, readSettings } from './appEnv.js';
import { appRunningIn, compose } from './docker.js';
import { markerNow } from './importDb.js';
import type { PromptRow } from './prompts.js';

/**
 * Moving a Docker install's database to the native install (spec §13 "One app per ledger"): the container's run is
 * waited for or refused (the shared guard, re-checked just before the stop), the container stopped, the backup taken
 * from the stopped volume, copied out, restored and checked, and only then the volume marked `MOVED-TO-NATIVE`.
 */
export interface ComposeFacts {
  /** The compose `.env` beside docker-compose.yml, read with parseEnv; null when there is none. */
  record: Record<string, string> | null;
  appRunning: boolean;
  /** The container's published port on the host, when it is running. */
  port: number | null;
}

export async function composeFacts(deps: Deps): Promise<ComposeFacts> {
  const text = deps.files.read(join(deps.checkout, '.env'));
  const ps = await deps.run(compose('ps', '-a', '--format', 'json'), {
    cwd: deps.checkout,
    timeoutMs: 20_000,
  });
  const appRunning = ps.code === 0 && appRunningIn(ps.stdout);
  let port: number | null = null;
  if (appRunning) {
    const p = await deps.run(compose('port', 'app', '3000'), { cwd: deps.checkout, timeoutMs: 20_000 });
    const m = /:(\d+)\s*$/.exec(p.stdout.trim());
    port = p.code === 0 && m?.[1] !== undefined ? Number(m[1]) : null;
  }
  return { record: text === null ? null : readEnvText(text), appRunning, port };
}

/** The Docker app as the active-run guard sees it: up while its container runs, reached on its published port. */
export function dockerGuardTarget(f: ComposeFacts): GuardTarget {
  const creds = f.record === null ? null : credsFrom(f.record);
  return {
    label: 'the Docker app',
    up: f.appRunning,
    creds: creds === null || f.port === null ? null : { ...creds, port: f.port },
    autoResume: (f.record?.AUTO_RESUME ?? 'true') !== 'false',
  };
}

export const DOCKER_BACKUP_DIR = '/data/backups';
/** The backup inside the stopped volume, as an action; its printed file is read with printedBackup. */
export const dockerBackupAction = (deps: Deps): Action =>
  runAction(
    compose(
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--entrypoint',
      'node',
      'app',
      'scripts/backup.mjs',
      '--dir',
      DOCKER_BACKUP_DIR,
    ),
    deps.checkout,
    { env: deps.childEnv },
  );
export const dockerStopAction = (deps: Deps): Action =>
  runAction(compose('stop', 'app'), deps.checkout, { env: deps.childEnv });
export const dockerCopiedPath = (deps: Deps, file: string): string =>
  join(deps.platform.paths.data, 'backups', basename(file));
export const dockerCopyAction = (deps: Deps, file: string): Action =>
  runAction(compose('cp', `app:${file}`, dockerCopiedPath(deps, file)), deps.checkout, {
    env: deps.childEnv,
  });
/** The marker, written inside the volume by `cat` from stdin: the shell formats nothing (no `date`, no `touch`). */
export const dockerMarkerAction = (deps: Deps): Action =>
  runAction(
    compose(
      'run',
      '--rm',
      '-T',
      '--no-deps',
      '--entrypoint',
      'sh',
      'app',
      '-c',
      `cat > /data/${MOVED_MARKER}`,
    ),
    deps.checkout,
    { stdin: { text: markerNow(deps), secret: false }, env: deps.childEnv },
  );
export const dockerDownAction = (deps: Deps): Action =>
  runAction(compose('down'), deps.checkout, { env: deps.childEnv });
/** The one line that undoes the marker (spec §13), printed wherever the Docker app is left unable to start. */
export const MARKER_REMOVAL = `docker compose run --rm --no-deps --entrypoint rm app /data/${MOVED_MARKER}`;

export const DOWN_REASON =
  'a second app on the old database would keep its own ledger, so caps would count twice; with the marker it would exit and restart in a loop until then';

/**
 * The compose `.env` groups an import offers to carry into app.env, each confirmed (spec §13; U2). A group carries every
 * line it names: the wizard's own names become answers, and the rest (caps, rates, cache windows) go across verbatim as
 * the operator's lines, which setup then keeps. `SEARCHAPI_TRIAL_USED` counts credits spent outside any ledger
 * (decision 14), so it is never in an imported database and always carries with the key.
 */
const CARRY: Array<{ label: string; names: RegExp; rows: PromptRow[] }> = [
  { label: 'the Travelpayouts lines', names: /^TRAVELPAYOUTS_/, rows: [4] },
  { label: 'the SearchApi lines', names: /^SEARCHAPI_/, rows: [5] },
  { label: 'the email settings', names: /^(SMTP_|ALERT_EMAIL_)/, rows: [6] },
  { label: 'the time zone', names: /^SCHEDULER_TIMEZONE$/, rows: [2] },
  { label: 'the market', names: /^POINT_OF_SALE$/, rows: [3] },
  {
    label: 'the spending caps and run settings',
    names:
      /^(MONTHLY_SPEND_CAP_PENCE|GLOBAL_BILLING_DAY|SOFT_CONFIRM_PENCE|EXECUTION_MAX_[A-Z_]+|CHILD_MAX_CALLS|AUTO_RESUME|MAX_AUTO_RESUMES|STALE_AFTER_HOURS|CALENDAR_STALE_AFTER_HOURS|STUCK_AFTER_HOURS|MAX_CELLS_PER_DEFINITION|MAX_WAIT_SECONDS|REQUEST_TIMEOUT_SECONDS|ESTIMATE_RETRY_FACTOR|FX_MAX_RATE_AGE_DAYS)$/,
    rows: [],
  },
];
/** Lines the native install sets itself, so they are neither carried nor mentioned. */
const NATIVE_OWN = /^(APP_BASIC_AUTH_USER|APP_BASIC_AUTH_PASS|PORT|BIND_ADDRESS|DATABASE_PATH|NODE_ENV)$/;
/** Lines shown with their value and not copied: the native app answers on 127.0.0.1 only. */
const SHOWN = ['ALLOWED_HOSTS', 'APP_BASE_URL'];

export type Carried =
  | { ok: true; answers: Answers; rows: Set<PromptRow>; extra: Array<readonly [string, string]> }
  | { ok: false; error: string };

/**
 * Reads the Docker .env as the container app would (core's parseConfig, with the lines compose fixes) and offers each
 * group it has values for, confirmed when interactive. Returns the answers, the prompt rows they answer, and the
 * verbatim lines to keep. Secret values are never printed.
 */
export async function carryOver(
  deps: Deps,
  ask: Ask,
  record: Readonly<Record<string, string>>,
  base: Answers,
  interactive: boolean,
): Promise<Carried> {
  const settings = readSettings(
    Object.entries({
      ...record,
      DATABASE_PATH: '/data/get-me-there.db',
      PORT: '3000',
      BIND_ADDRESS: '127.0.0.1',
    })
      .map(([k, v]) => `${k}="${v}"`)
      .join('\n'),
  );
  if (!settings.ok)
    return {
      ok: false,
      error: `the Docker .env would not pass the app’s settings check: ${settings.fields.filter((f) => !NATIVE_OWN.test(f)).join(', ')}`,
    };
  const fromDocker = answersFromConfig(settings.config, record, { linger: base.linger });
  const answers: Answers = { ...base };
  const rows = new Set<PromptRow>();
  const extra: Array<readonly [string, string]> = [];
  const owned = new Set(OWNED_NAMES);
  for (const g of CARRY) {
    const names = Object.keys(record).filter((n) => g.names.test(n) && (record[n] ?? '') !== '');
    if (names.length === 0) continue;
    if (
      interactive &&
      !(await ask.confirm(`Carry ${g.label} (${names.join(', ')}) from the Docker .env into app.env?`, true))
    )
      continue;
    for (const r of g.rows) rows.add(r);
    if (g.rows.includes(2)) answers.timezone = fromDocker.timezone;
    if (g.rows.includes(3)) answers.pointOfSale = fromDocker.pointOfSale;
    if (g.rows.includes(4)) answers.travelpayouts = fromDocker.travelpayouts;
    if (g.rows.includes(5)) answers.searchApi = fromDocker.searchApi;
    if (g.rows.includes(6)) answers.email = fromDocker.email;
    for (const n of names) if (!owned.has(n)) extra.push([n, record[n] ?? '']);
  }
  for (const n of SHOWN)
    if ((record[n] ?? '') !== '')
      deps.io.out(
        `The Docker .env also sets ${n}=${record[n]}; it is not copied (the native app listens on 127.0.0.1 only).\n`,
      );
  for (const n of Object.keys(record))
    if (
      (record[n] ?? '') !== '' &&
      !NATIVE_OWN.test(n) &&
      !SHOWN.includes(n) &&
      !CARRY.some((g) => g.names.test(n))
    )
      deps.io.out(
        `The Docker .env’s ${n} is not copied${n.startsWith('CAMOUFOX_') ? ' (set the browser provider up natively instead)' : ''}.\n`,
      );
  return { ok: true, answers, rows, extra };
}
