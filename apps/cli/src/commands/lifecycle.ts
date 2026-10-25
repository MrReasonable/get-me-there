import type { Flags } from '../args.js';
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

/** U1 (cb-b1-008): stop and restart ask the app about a run first (decision 80's rule); null when they may go ahead. */
export async function lifecycleGuard(
  deps: Deps,
  flags: Flags,
  entries: readonly ServiceEntry[],
  facts: ReadonlyMap<string, ServiceFacts>,
): Promise<number | null> {
  if (flags['dry-run'] === true) return null;
  const app = entries.find((e) => e.name === 'app');
  const text = deps.files.read(appEnvPath(deps.platform.paths));
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
