import { join } from 'node:path/posix';
import { BACKUP_MAX_AGE_MS, backupTimeOf, START_REFUSAL_TEXT } from '@gmt/core';
import { type DockerAppState, dockerAppState, dockerEndpoint } from '../appEndpoint.js';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import type { ServiceFacts } from '../platform/types.js';
import { type Check, scheduleUnit, settingsChecks, staleChecks } from '../services/checks.js';
import { factOf, factsOf, type ServiceEntry, serviceSet } from '../services/set.js';
import { appEnvPath, dailyBackupsDir, isLoopback } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import { COMPOSE_PROJECT } from '../setup/docker.js';
import { finishStatus, nativeTarget, reportFlags, type StatusTarget } from '../statusReport.js';
import { bootOutRefused, readStartRefusal, refusalLine, WORKER_LABEL } from '../worker/refusal.js';
import { refuseOnWindows } from './lifecycle.js';

const LOGS_WARN_BYTES = 100 * 1024 * 1024;

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
    .map(backupTimeOf)
    .filter((t) => t !== null)
    .map((t) => Date.parse(t))
    .sort((a, b) => b - a)[0];
  if (newest !== undefined && now - newest < BACKUP_MAX_AGE_MS)
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

/**
 * The app mode status reports on (W1: the app in Docker with the worker on this machine is supported). `unknown`: no
 * native install, and Docker's compose state could not be read, so whether the app is in Docker is not known.
 */
type AppMode = 'native' | 'docker' | 'both' | 'unknown' | 'none';

/** A native install is there: app.env, or the app's or the backup job's unit on disk. */
function nativeInstalled(
  deps: Deps,
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
): boolean {
  if (deps.files.mode(appEnvPath(deps.platform.paths)) !== null) return true;
  return entries.some(
    (e) => e.name !== 'camoufox-worker' && e.rendered.some((r) => factOf(facts, r.unitName).onDisk !== null),
  );
}

function modeOf(native: boolean, docker: DockerAppState): AppMode {
  if (native) return docker === 'running' ? 'both' : 'native';
  if (docker === 'running' || docker === 'stopped') return 'docker';
  return docker === 'unknown' ? 'unknown' : 'none';
}

function dockerCheck(mode: AppMode, docker: DockerAppState): Check | null {
  if (docker === null) return null;
  if (docker === 'unknown')
    return {
      name: 'docker',
      // why: with a native install the native app is still read; without one, the app's state is not known
      level: mode === 'unknown' ? 'fail' : 'warn',
      detail: 'docker compose ps failed or printed what is not compose’s JSON, so a Docker app is not known',
      fix: 'start Docker, then run pnpm gmt status again',
    };
  if (mode === 'both')
    return {
      name: 'docker',
      level: 'warn',
      detail: 'a Docker app runs beside the native one (two ledgers)',
      fix: 'docker compose down',
    };
  if (mode === 'docker')
    return docker === 'running'
      ? {
          name: 'docker',
          level: 'ok',
          detail: `the app runs in Docker (compose project ${COMPOSE_PROJECT})`,
          fix: null,
        }
      : {
          name: 'docker',
          level: 'fail',
          detail: 'the app runs in Docker, but its container is stopped',
          fix: 'docker compose start app',
        };
  return { name: 'docker', level: 'ok', detail: 'no Docker app running', fix: null };
}

/** What to do when the Docker app does not answer: a docker compose command, never a native one. */
function dockerNextStep(docker: DockerAppState) {
  return (_local: readonly Check[], port: number | null): string =>
    port !== null
      ? `the Docker app is running but does not answer on port ${port}: docker compose logs app shows why; docker compose restart app tries again`
      : docker === 'running'
        ? 'docker compose port app 3000 shows what compose publishes; docker compose logs app shows the app'
        : docker === 'unknown'
          ? 'start Docker, then run pnpm gmt status again'
          : 'the Docker app is stopped: docker compose start app';
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
  if (bind !== undefined && bind !== '' && !isLoopback(bind))
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
 * The local facts of `gmt status` (brief Task 16b.8 and §5; WP18 prints its app report beside them) and the app it reads
 * the report from. Native (or nothing installed): each service's state, the settings files' presence and modes, the
 * price source, a bind address beyond loopback, stale units, the macOS log size, a Docker app running beside the native
 * one (two ledgers), a detached checkout, the newest daily backup, and the worker's refusal; the report from app.env's
 * port and basic auth. The app in Docker with no native install (W1): the same facts for the worker only (its service,
 * worker.env, its refusal), with no app.env, app service or daily backup job to check, the Docker app's own state, and
 * the report from the Docker app. Reads only: it runs no action.
 */
export async function statusFacts(deps: Deps): Promise<{ checks: Check[]; target: StatusTarget }> {
  const entries = serviceSet(deps);
  const facts = await factsOf(deps, entries);
  const docker = await dockerAppState(deps);
  const mode = modeOf(nativeInstalled(deps, entries, facts), docker);
  // why: with no native install and Docker's state unknown, the native checks would only say to set one up
  const inDocker = mode === 'docker' || mode === 'unknown';
  const shown = inDocker ? entries.filter((e) => e.name === 'camoufox-worker') : entries;
  // why: W1: with the app in Docker the worker's service is installed by gmt browser install, never by setup
  const workerFix = (c: Check): Check =>
    inDocker && c.fix === 'pnpm gmt setup' ? { ...c, fix: 'pnpm gmt browser install' } : c;
  const checks: Check[] = [
    ...shown.map((e) => serviceCheck(deps, e, facts)).map(workerFix),
    ...staleChecks(deps, shown, facts).map(workerFix),
    ...settingsChecks(deps, !inDocker),
    ...appEnvChecks(deps),
    ...(inDocker ? [] : [backupsCheck(deps)]),
  ];
  for (const c of [logsCheck(deps), dockerCheck(mode, docker), await checkoutCheck(deps)])
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
  const target: StatusTarget = inDocker
    ? { endpoint: await dockerEndpoint(deps, docker), nextStep: dockerNextStep(docker) }
    : nativeTarget(deps);
  return { checks, target };
}

/** The local facts alone (statusFacts' checks). */
export async function localChecks(deps: Deps): Promise<Check[]> {
  return (await statusFacts(deps)).checks;
}

/**
 * `gmt status`: the local facts, then on macOS a refused worker's loaded agent booted out (spec §13: launchd's
 * KeepAlive cannot exclude exit 78), said only when the bootout worked (ca-b1-007). Exits 1 on a fail.
 */
export async function statusCommand(flags: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const rf = reportFlags(flags);
  if (!rf.ok) {
    deps.io.err(rf.message);
    return EXIT.usage;
  }
  const { checks, target } = await statusFacts(deps);
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
        (rf.json ? deps.io.err : deps.io.out)(
          'the refused worker agent was booted out so launchd does not restart it\n',
        );
      else
        checks.push({
          name: 'worker agent',
          level: 'fail',
          detail: `still loaded, so launchd keeps restarting it (${r.failed.error})`,
          fix: `launchctl bootout gui/${deps.platform.uid}/${WORKER_LABEL}`,
        });
    }
  }
  return finishStatus(deps, rf, checks, target);
}
