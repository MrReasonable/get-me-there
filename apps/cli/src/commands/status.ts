import { join } from 'node:path';
import { START_REFUSAL_TEXT } from '@gmt/core';
import type { Flags } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import { apply } from '../plan/apply.js';
import type { ServiceFacts } from '../platform/types.js';
import { type Check, describeChecks, scheduleUnit, settingsChecks, staleChecks } from '../services/checks.js';
import { factOf, type ServiceEntry, serviceSet } from '../services/set.js';
import { dailyBackupsDir } from '../services/specs.js';
import { compose } from '../setup/docker.js';
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
  const running =
    ps.code === 0 &&
    ps.stdout.split('\n').some((l) => /"Service":"app"/.test(l) && /"State":"running"/.test(l));
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

/**
 * `gmt status`, the local facts (brief Task 16b.8; WP18 adds the app's report beside them): each service's state, the
 * settings files' presence and modes, stale units, the macOS log size, a Docker app beside the native one, a detached
 * checkout, the newest daily backup, and the worker's refusal (with its agent booted out on macOS). Exits 1 on a fail.
 */
export async function statusCommand(_f: Flags, _p: string | null, deps: Deps): Promise<number> {
  const win = refuseOnWindows(deps);
  if (win !== null) return win;
  const entries = serviceSet(deps);
  const sm = deps.platform.serviceManager;
  const facts = new Map<string, ServiceFacts>();
  for (const e of entries) for (const [k, v] of await sm.facts(e.rendered, deps.run)) facts.set(k, v);
  const checks: Check[] = [
    ...entries.map((e) => serviceCheck(deps, e, facts)),
    ...staleChecks(deps, entries, facts),
    ...settingsChecks(deps),
    backupsCheck(deps),
  ];
  for (const c of [logsCheck(deps), await dockerCheck(deps), await checkoutCheck(deps)])
    if (c !== null) checks.push(c);

  const refusal = await readStartRefusal(deps.platform.paths);
  if (refusal === 'unreadable')
    checks.push({ name: 'worker', level: 'fail', detail: 'refusal file unreadable', fix: null });
  else if (refusal !== 'none') {
    checks.push({
      name: 'worker',
      level: 'fail',
      detail: refusalLine(refusal),
      fix: START_REFUSAL_TEXT[refusal.reason].fixCommand,
    });
    if (deps.platform.os === 'darwin') {
      const worker = {
        path: join(deps.platform.paths.serviceDir, `${WORKER_LABEL}.plist`),
        contents: '',
        unitName: WORKER_LABEL,
      };
      const wf = await sm.facts([worker], deps.run);
      const out = bootOutRefused(deps.platform, wf, refusal);
      if (out.length > 0) {
        await apply({ command: 'boot out the refused worker', actions: out, notes: [] }, deps.executor);
        deps.io.out('the refused worker agent was booted out so launchd does not restart it\n');
      }
    }
  }
  deps.io.out(describeChecks(checks));
  return checks.some((c) => c.level === 'fail') ? EXIT.failed : EXIT.ok;
}
