import { join } from 'node:path/posix';
import { type ActiveExecution, type AppCreds, activeLine, readActive } from '../appClient.js';
import { dockerAppState, dockerEndpoint, nativeEndpoint } from '../appEndpoint.js';
import type { Deps } from '../deps.js';
import { factOf, factsOf, serviceSet } from '../services/set.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';

/** Decision 80's `--force` statement, printed before the first action; the last sentence follows AUTO_RESUME. */
export function forceStatement(label: string, autoResume: boolean): string {
  return [
    `Going ahead anyway (--force): ${label} stops within 30 s on SIGTERM; a page or call in flight is abandoned, stays on the ledger and has its cells requested again; the run is marked interrupted at its last checkpoint without counting an automatic resume, and`,
    autoResume
      ? 'after the restart the app resumes it from its last checkpoint (AUTO_RESUME is on).'
      : 'it waits for you to resume it (AUTO_RESUME is off).',
  ].join(' ');
}

/** What the guard asks about: the app it would stop, whether it is up, how to reach it, and its AUTO_RESUME. */
export interface GuardTarget {
  label: string;
  up: boolean;
  creds: AppCreds | null;
  autoResume: boolean;
  /** Why an app that may be up cannot be asked (no credentials, or an unknown Docker state); the default names no auth. */
  cannot?: string;
}

/**
 * The guard's target for this machine's app (review X4), through appEndpoint.ts's readers: the native app (up while its
 * service runs) with app.env's credentials, or, with no native install, the Docker app on the port compose publishes
 * with the checkout's .env credentials (read, never printed). A Docker app whose state, port or credentials cannot be
 * read may be running a search, so it is up with the reason it cannot be asked: the guard refuses unless --force.
 */
export async function appGuardTarget(deps: Deps): Promise<GuardTarget> {
  const paths = deps.platform.paths;
  if (deps.files.mode(appEnvPath(paths)) !== null) {
    const app = serviceSet(deps).find((e) => e.name === 'app');
    const up = app !== undefined && factOf(await factsOf(deps, [app]), app.unit).state === 'running';
    const e = nativeEndpoint(deps);
    let autoResume = true;
    try {
      autoResume = readEnvText(deps.files.read(appEnvPath(paths)) ?? '').AUTO_RESUME !== 'false';
    } catch {
      // why: an unreadable app.env is the endpoint's own reason below
    }
    return e.kind === 'none'
      ? { label: 'the app', up, creds: null, autoResume, cannot: e.reason }
      : { label: 'the app', up, creds: e.creds, autoResume };
  }
  const state = await dockerAppState(deps);
  if (state === null || state === 'absent' || state === 'stopped')
    return { label: 'the Docker app', up: false, creds: null, autoResume: true };
  const e = await dockerEndpoint(deps, state);
  if (e.kind === 'none')
    return { label: 'the Docker app', up: true, creds: null, autoResume: true, cannot: e.reason };
  let autoResume = true;
  try {
    autoResume = readEnvText(deps.files.read(join(deps.checkout, '.env')) ?? '').AUTO_RESUME !== 'false';
  } catch {
    // why: the endpoint has read .env already; a failure here leaves the default
  }
  return { label: 'the Docker app', up: true, creds: e.creds, autoResume };
}

const runningIn = (label: string, e: ActiveExecution): string =>
  activeLine(e).replace('a search is running:', `a search is running in ${label}:`);

/**
 * U1: the one active-run guard for every command that stops or restarts an app (update, stop, restart, every
 * `--reconfigure`, the imports and `--ignore-docker`). An app that is not up is not asked. A run active, or a read that
 * fails while the app is up, refuses with decision 80's text unless `--wait` (an active run: poll every 60 s) or
 * `--force` (go ahead after printing what that does). Call it immediately before the step that stops the app.
 */
export async function guardActiveRun(
  deps: Deps,
  t: GuardTarget,
  flags: { wait: boolean; force: boolean },
): Promise<{ ok: true; forced: boolean } | { ok: false; message: string }> {
  if (!t.up) return { ok: true, forced: false };
  for (;;) {
    const r =
      t.creds === null
        ? { kind: 'failed' as const, reason: t.cannot ?? 'no basic auth in its settings' }
        : await readActive(deps, t.creds);
    if (r.kind === 'none') return { ok: true, forced: false };
    const what =
      r.kind === 'active'
        ? runningIn(t.label, r.execution)
        : `cannot tell whether a search is running in ${t.label} (${r.reason})`;
    if (r.kind === 'active' && flags.wait && !flags.force) {
      deps.io.out(`${what}; waiting (checking every 60 s)\n`);
      await deps.sleep(60_000);
      continue;
    }
    if (!flags.force)
      return {
        ok: false,
        message:
          r.kind === 'active'
            ? `${what}; run this again when it ends, or with --wait or --force`
            : `${what}; run this again when it answers, or with --force`,
      };
    deps.io.out(`${what}.\n${forceStatement(t.label, t.autoResume)}\n`);
    return { ok: true, forced: true };
  }
}
