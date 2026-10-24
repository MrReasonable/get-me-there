import { basename, join } from 'node:path';
import { MOVED_MARKER } from '@gmt/core';
import { activeLine, credsFrom, readActive } from '../appClient.js';
import type { Ask } from '../ask.js';
import type { Deps } from '../deps.js';
import { type Action, runAction } from '../plan/action.js';
import { type Answers, defaultAnswers } from './answers.js';
import { answersFromRecord, readEnvText } from './appEnv.js';
import { compose } from './docker.js';
import { markerNow } from './importDb.js';
import type { PromptRow } from './prompts.js';

/**
 * Moving a Docker install's database to the native install (spec §13 "One app per ledger"): the container's run is
 * waited for or refused, the container stopped, the backup taken from the stopped volume, copied out, restored and
 * checked, and only then the volume marked `MOVED-TO-NATIVE`.
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
  const appRunning = ps.stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .some((l) => {
      try {
        const v: unknown = JSON.parse(l);
        return (
          typeof v === 'object' &&
          v !== null &&
          'Service' in v &&
          v.Service === 'app' &&
          'State' in v &&
          v.State === 'running'
        );
      } catch {
        return false;
      }
    });
  let port: number | null = null;
  if (appRunning) {
    const p = await deps.run(compose('port', 'app', '3000'), { cwd: deps.checkout, timeoutMs: 20_000 });
    const m = /:(\d+)\s*$/.exec(p.stdout.trim());
    port = p.code === 0 && m?.[1] !== undefined ? Number(m[1]) : null;
  }
  return { record: text === null ? null : readEnvText(text), appRunning, port };
}

/**
 * The container's active run (decision 80's rule, as `update` reads it): none lets the import go on; an active run
 * refuses, naming it and its estimated finish, unless `--wait`, which polls every 60 s; a running container that
 * cannot be read refuses too.
 */
export async function waitForNoRun(deps: Deps, f: ComposeFacts, wait: boolean): Promise<string | null> {
  if (!f.appRunning) return null;
  const creds = f.record === null ? null : credsFrom(f.record);
  if (creds === null || f.port === null)
    return 'the Docker app is running, and its runs cannot be read (no auth lines in .env, or no published port): stop it when no search runs (docker compose stop app), then run setup again';
  const c = { ...creds, port: f.port };
  for (;;) {
    const r = await readActive(deps, c);
    if (r.kind === 'none') return null;
    if (r.kind === 'failed')
      return `the Docker app’s runs cannot be read (${r.reason}): stop it when no search runs (docker compose stop app), then run setup again`;
    if (!wait) return `${activeLine(r.execution)}; run setup again when it ends, or with --wait`;
    deps.io.out(`${activeLine(r.execution)}; waiting (checking every 60 s)\n`);
    await deps.sleep(60_000);
  }
}

export const DOCKER_BACKUP_DIR = '/data/backups';
export const dockerBackupArgv = (): string[] =>
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
  );
export const dockerStopAction = (deps: Deps): Action => runAction(compose('stop', 'app'), deps.checkout);
export const dockerCopyAction = (deps: Deps, file: string): Action =>
  runAction(
    compose('cp', `app:${file}`, join(deps.platform.paths.data, 'backups', basename(file))),
    deps.checkout,
  );
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
    {
      stdin: markerNow(deps),
      secretStdin: false,
    },
  );

export const DOWN_REASON =
  'a second app on the old database would keep its own ledger, so caps would count twice; with the marker it would exit and restart in a loop until then';

/** The compose `.env` groups an import offers to carry into app.env, each confirmed (spec §13). */
const CARRY: Array<{ label: string; names: RegExp; rows: PromptRow[] }> = [
  { label: 'the Travelpayouts token (TRAVELPAYOUTS_TOKEN)', names: /^TRAVELPAYOUTS_TOKEN$/, rows: [4] },
  { label: 'the SearchApi settings (SEARCHAPI_*)', names: /^SEARCHAPI_/, rows: [5] },
  { label: 'the email settings (SMTP_*, ALERT_EMAIL_*)', names: /^(SMTP_|ALERT_EMAIL_)/, rows: [6] },
  { label: 'the time zone (SCHEDULER_TIMEZONE)', names: /^SCHEDULER_TIMEZONE$/, rows: [2] },
  { label: 'the market (POINT_OF_SALE)', names: /^POINT_OF_SALE$/, rows: [3] },
];

/**
 * Offers each group of the compose `.env` that has values; returns the answers they amount to and the prompt rows
 * they answer. `ALLOWED_HOSTS` and `APP_BASE_URL` are shown and never copied. Values are never printed.
 */
export async function carryOver(
  deps: Deps,
  ask: Ask,
  record: Readonly<Record<string, string>>,
  base: Answers,
  interactive: boolean,
): Promise<{ answers: Answers; rows: Set<PromptRow> }> {
  const carried: Record<string, string> = {};
  const rows = new Set<PromptRow>();
  for (const g of CARRY) {
    const names = Object.keys(record).filter((n) => g.names.test(n) && (record[n] ?? '') !== '');
    if (names.length === 0) continue;
    // why: an imported database holds the trial's ledger, so its seed is never carried
    const take = names.filter((n) => n !== 'SEARCHAPI_TRIAL_USED');
    if (!interactive || (await ask.confirm(`Carry ${g.label} from the Docker .env into app.env?`, true))) {
      for (const n of take) carried[n] = record[n] ?? '';
      for (const r of g.rows) rows.add(r);
    }
  }
  for (const n of ['ALLOWED_HOSTS', 'APP_BASE_URL'])
    if ((record[n] ?? '') !== '')
      deps.io.out(
        `The Docker .env also sets ${n}=${record[n]}; it is not copied (the native app listens on 127.0.0.1 only).\n`,
      );
  const fromRecord = answersFromRecord(carried, { linger: base.linger });
  const none = defaultAnswers({ port: base.port, timezone: base.timezone });
  return {
    answers: {
      ...base,
      timezone: rows.has(2) ? fromRecord.timezone : base.timezone,
      pointOfSale: rows.has(3) ? fromRecord.pointOfSale : base.pointOfSale,
      travelpayouts: rows.has(4) ? fromRecord.travelpayouts : none.travelpayouts,
      searchApi:
        rows.has(5) && fromRecord.searchApi !== null
          ? { ...fromRecord.searchApi, trialUsed: null }
          : base.searchApi,
      email: rows.has(6) ? fromRecord.email : base.email,
    },
    rows,
  };
}
