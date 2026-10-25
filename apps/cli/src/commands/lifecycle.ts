import { type Flags, isOnlyService, type OnlyService } from '../args.js';
import { type Deps, EXIT } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describePlan, describeResult } from '../plan/describe.js';
import type { ServiceFacts } from '../platform/types.js';
import { WIN32_REFUSAL } from '../platform/win32.js';
import { scheduleUnit } from '../services/checks.js';
import { factOf, factsOf, type ServiceEntry, serviceSet } from '../services/set.js';
import { appEnvPath } from '../services/specs.js';
import { readSettings } from '../setup/appEnv.js';
import { guardActiveRun } from './guard.js';
import { nativeTarget } from './setup.js';

/** The services setup installed, with their facts; a job's schedule unit's facts included. */
export async function installed(
  deps: Deps,
): Promise<{ entries: ServiceEntry[]; facts: Map<string, ServiceFacts> }> {
  const all = serviceSet(deps);
  const facts = await factsOf(deps, all);
  const entries = all.filter((e) => e.rendered.some((r) => factOf(facts, r.unitName).onDisk !== null));
  return { entries, facts };
}

const ONLY_ENTRY: Readonly<Record<OnlyService, ServiceEntry['name']>> = {
  app: 'app',
  backup: 'backup',
  worker: 'camoufox-worker',
};

/**
 * `--only <service>` (WP17 Task 17.8: the browser worker alone, so a recording session never stops a native app): the
 * one installed entry it names, all of them without the flag, or the refusal when that service is not installed.
 */
export function onlyEntries(
  flags: Flags,
  entries: readonly ServiceEntry[],
): { ok: true; entries: ServiceEntry[] } | { ok: false; message: string } {
  const only = flags.only;
  if (typeof only !== 'string' || !isOnlyService(only)) return { ok: true, entries: [...entries] };
  const picked = entries.filter((e) => e.name === ONLY_ENTRY[only]);
  return picked.length > 0
    ? { ok: true, entries: picked }
    : { ok: false, message: `the ${only} service is not installed: nothing to do` };
}

/** A job is started or stopped by its schedule (launchd's calendar agent loaded or not; the systemd timer), never run. */
export function lifecycleActions(
  deps: Deps,
  verb: 'start' | 'stop' | 'restart',
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
): Action[] {
  const sm = deps.platform.serviceManager;
  return entries.flatMap((e) => {
    if (e.spec.calendar === null) return sm[verb](e.unit, factOf(facts, e.unit));
    const unit = scheduleUnit(e);
    const f = factOf(facts, unit);
    if (verb === 'stop') return sm.stop(unit, f);
    if (deps.platform.os === 'darwin') return f.loaded ? [] : sm.start(unit, f);
    return verb === 'restart' ? [] : sm.start(unit, f);
  });
}

/** Applies a lifecycle plan (or prints it with --dry-run). */
export async function runLifecycle(
  command: string,
  actions: Action[],
  flags: Flags,
  deps: Deps,
): Promise<number> {
  const plan = { command, actions, notes: [] };
  if (flags['dry-run'] === true) {
    deps.io.out(describePlan(plan));
    return EXIT.ok;
  }
  const r = await apply(plan, deps.executor);
  if (r.failed !== null) {
    deps.io.err(describeResult(command, r));
    return EXIT.failed;
  }
  deps.io.out(describeResult(command, r));
  return EXIT.ok;
}

export function refuseOnWindows(deps: Deps): number | null {
  if (deps.platform.os !== 'win32') return null;
  deps.io.err(`${WIN32_REFUSAL}\n`);
  return EXIT.badConfig;
}

/**
 * U1 (cb-b1-008): stop and restart ask the app about a run first (decision 80's rule); null when they may go ahead.
 * W5 (ca-b1-002): the app is found among every installed entry, not only the targeted ones, so `--only worker` (whose
 * stop interrupts a browser page) is guarded too; only a target holding neither the app nor the worker (`--only
 * backup`) skips the question.
 */
export async function lifecycleGuard(
  deps: Deps,
  flags: Flags,
  targeted: readonly ServiceEntry[],
  all: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
): Promise<number | null> {
  if (flags['dry-run'] === true) return null;
  if (!targeted.some((e) => e.name === 'app' || e.name === 'camoufox-worker')) return null;
  const app = all.find((e) => e.name === 'app');
  let text: string | null;
  try {
    text = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    text = null;
  }
  const g = await guardActiveRun(
    deps,
    nativeTarget(text === null ? null : readSettings(text), factOf(facts, app?.unit ?? '')),
    {
      wait: flags.wait === true,
      force: flags.force === true,
    },
  );
  if (g.ok) return null;
  deps.io.err(`${g.message}\n`);
  return EXIT.lockRefused;
}
