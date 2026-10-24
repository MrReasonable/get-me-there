import { join } from 'node:path/posix';
import { START_REFUSAL_TEXT } from '@gmt/core';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import type { ServiceFacts } from '../platform/types.js';
import { type Check, describeChecks, scheduleUnit, settingsChecks, staleChecks } from '../services/checks.js';
import { factOf, factsOf, type ServiceEntry, serviceSet } from '../services/set.js';
import { appEnvPath, dailyBackupsDir } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import { appRunningIn, compose } from '../setup/docker.js';
import { bootOutRefused, readStartRefusal, refusalLine, WORKER_LABEL } from '../worker/refusal.js';
import { refuseOnWindows } from './lifecycle.js';

const LOGS_WARN_BYTES = 100 * 1024 * 1024;
const BACKUP_MAX_AGE_MS = 36 * 3600 * 1000;
const BACKUP_NAME = /^get-me-there-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;

/** The rotation rule for the macOS log directory (docs/setup.md section 0), one newsyslog line. */
export const newsyslogLine = (logs: string, user: string): string =>
  `echo '${logs}/*.log ${user}:staff 640 5 10240 * GJN' | sudo tee /etc/newsyslog.d/get-me-there.conf`;

function serviceCheck(deps: Deps, e: ServiceEntry, facts: ReadonlyMap<string, ServiceFacts>): Check {
  const name = `service ${e.name}`;
  const installedNow = e.rendered.some((r) => factOf(facts, r.unitName).onDisk !== null);
  if (!installedNow) return { name, level: 'fail', detail: 'not installed', fix: 'pnpm gmt setup' };
  if (e.spec.calendar !== null) {
    const f = factOf(facts, scheduleUnit(e));
    const scheduled = deps.platform.os === 'darwin' ? f.loaded : f.state === 'running';
    return scheduled
      ? { name, level: 'ok', detail: 'scheduled daily at 03:30', fix: null }
      : { name, level: 'warn', detail: 'installed but not scheduled', fix: 'pnpm gmt start' };
  }
  const state = factOf(facts, e.unit).state;
  return state === 'running'
    ? { name, level: 'ok', detail: 'running', fix: null }
    : { name, level: 'fail', detail: state, fix: 'pnpm gmt start' };
}

function backupsCheck(deps: Deps): Check {
  const now = deps.now().getTime();
  const newest = (deps.files.list(dailyBackupsDir(deps.platform.paths)) ?? [])
    .map((n) => BACKUP_NAME.exec(n))
    .filter((m) => m !== null)
    .map((m) => Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`))
    .sort((a, b) => b - a)[0];
  if (newest !== undefined && now - newest <= BACKUP_MAX_AGE_MS)
    return {
      name: 'backups',
      level: 'ok',
      detail: `newest daily backup ${new Date(newest).toISOString()}`,
      fix: null,
    };
  return {
    name: 'backups',
    level: 'warn',
    detail: 'no daily backup in the last 36 h',
    fix: 'pnpm gmt backup',
  };
}

function logsCheck(deps: Deps): Check | null {
  const logs = deps.platform.paths.logs;
  if (logs === null) return null;
  const bytes = (deps.files.list(logs) ?? []).reduce((n, f) => n + (deps.files.size(join(logs, f)) ?? 0), 0);
  return bytes > LOGS_WARN_BYTES
    ? {
        name: 'logs',
        level: 'warn',
        detail: `${logs} holds ${Math.round(bytes / 1048576)} MB`,
        fix: newsyslogLine(logs, deps.username),
      }
    : { name: 'logs', level: 'ok', detail: `${Math.round(bytes / 1048576)} MB`, fix: null };
}

async function dockerCheck(deps: Deps): Promise<Check | null> {
  const run = (argv: string[]) => deps.run(argv, { cwd: deps.checkout, timeoutMs: 20_000 });
  if ((await run(['docker', '--version'])).code !== 0) return null;
  const ps = await run(compose('ps', '--format', 'json'));
  // why: ca-b1-011: one parser for compose's NDJSON or array output
  const running = ps.code === 0 && appRunningIn(ps.stdout);
  return running
    ? {
        name: 'docker',
        level: 'warn',
        detail: 'a Docker app runs beside the native one (two ledgers)',
        fix: 'docker compose down',
      }
    : { name: 'docker', level: 'ok', detail: 'no Docker app running', fix: null };
}

async function checkoutCheck(deps: Deps): Promise<Check> {
  const r = await deps.run(['git', 'symbolic-ref', '-q', '--short', 'HEAD'], {
    cwd: deps.checkout,
    timeoutMs: 15_000,
  });
  return r.code === 0
    ? { name: 'checkout', level: 'ok', detail: `on ${r.stdout.trim() || 'a branch'}`, fix: null }
    : {
        name: 'checkout',
        level: 'warn',
        detail: 'a detached commit (after a restore)',
        fix: 'git switch main',
      };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** pf-b1-001, sec-b1-002: the price source the app will search with, and a bind address beyond loopback. */
function appEnvChecks(deps: Deps): Check[] {
  let text: string | null;
  try {
    text = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    return [];
  }
  if (text === null) return [];
  const env = readEnvText(text);
  const sources = [
    ...((env.TRAVELPAYOUTS_TOKEN ?? '') === '' ? [] : ['Travelpayouts']),
    ...(env.SEARCHAPI_PLAN === '40usd' && (env.SEARCHAPI_KEY ?? '') !== '' ? ['SearchApi ($40 plan)'] : []),
  ];
  const out: Check[] = [
    sources.length > 0
      ? { name: 'price source', level: 'ok', detail: sources.join(' and '), fix: null }
      : {
          name: 'price source',
          level: 'warn',
          detail: 'none, so searches find nothing (the SearchApi free trial serves pnpm gmt smoke only)',
          fix: 'pnpm gmt setup --reconfigure travelpayouts',
        },
  ];
  const bind = env.BIND_ADDRESS;
  if (bind !== undefined && bind !== '' && !LOOPBACK.has(bind))
    out.push({
      name: 'bind address',
      level: 'warn',
      detail: `${bind}: the app answers beyond this machine over plain HTTP (fine behind a tunnel or TLS, docs/setup.md section 3)`,
      fix: 'BIND_ADDRESS=127.0.0.1 in app.env, then pnpm gmt restart',
    });
  return out;
}

const workerUnit = (deps: Deps) => ({
  path: join(deps.platform.paths.serviceDir, `${WORKER_LABEL}.plist`),
  contents: '',
  unitName: WORKER_LABEL,
});

/**
 * The local facts of `gmt status` (brief Task 16b.8 and §5; WP18 prints its app report beside them): each service's
 * state, the settings files' presence and modes, the price source, a bind address beyond loopback, stale units, the
 * macOS log size, a Docker app beside the native one, a detached checkout, the newest daily backup, and the worker's
 * refusal. Reads only: it runs no action.
 */
export async function localChecks(deps: Deps): Promise<Check[]> {
  const entries = serviceSet(deps);
  const facts = await factsOf(deps, entries);
  const checks: Check[] = [
    ...entries.map((e) => serviceCheck(deps, e, facts)),
    ...staleChecks(deps, entries, facts),
    ...settingsChecks(deps),
    ...appEnvChecks(deps),
    backupsCheck(deps),
  ];
  for (const c of [logsCheck(deps), await dockerCheck(deps), await checkoutCheck(deps)])
    if (c !== null) checks.push(c);
  const refusal = readStartRefusal(deps.platform.paths, deps.files);
  if (refusal === 'unreadable')
    checks.push({ name: 'worker', level: 'fail', detail: 'refusal file unreadable', fix: null });
  else if (refusal !== 'none')
    checks.push({
      name: 'worker',
      level: 'fail',
      detail: refusalLine(refusal),
      fix: START_REFUSAL_TEXT[refusal.reason].fixCommand,
    });
  return checks;
}

/**
 * `gmt status`: the local facts, then on macOS a refused worker's loaded agent booted out (spec §13: launchd's
 * KeepAlive cannot exclude exit 78), said only when the bootout worked (ca-b1-007). Exits 1 on a fail.
 */
export async function statusCommand(_f: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const checks = await localChecks(deps);
  const refusal = readStartRefusal(deps.platform.paths, deps.files);
  if (deps.platform.os === 'darwin' && refusal !== 'none' && refusal !== 'unreadable') {
    const wf = await deps.platform.serviceManager.facts([workerUnit(deps)], deps.run);
    const out = bootOutRefused(deps.platform, wf, refusal);
    if (out.length > 0) {
      const r = await apply(
        { command: 'boot out the refused worker', actions: out, notes: [] },
        deps.executor,
      );
      if (r.failed === null)
        deps.io.out('the refused worker agent was booted out so launchd does not restart it\n');
      else
        checks.push({
          name: 'worker agent',
          level: 'fail',
          detail: `still loaded, so launchd keeps restarting it (${r.failed.error})`,
          fix: `launchctl bootout gui/${deps.platform.uid}/${WORKER_LABEL}`,
        });
    }
  }
  deps.io.out(describeChecks(checks));
  return checks.some((c) => c.level === 'fail') ? EXIT.failed : EXIT.ok;
}
