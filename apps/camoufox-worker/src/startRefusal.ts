import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  CAMOUFOX_BUILDS,
  type Clock,
  type IsoDateTime,
  type OsArch,
  START_REFUSAL_TEXT,
  type StartFacts,
  type StartRefusal,
  type StartRefusalReason,
  startChecks,
  startRefusalSchema,
  systemClock,
} from '@gmt/core';
import { loadWorkerConfig } from './config.js';
import { ensureInstallLayout, type InstallFacts, InstallRefused } from './install.js';
import { lockHeld } from './lock.js';
import { installDirFor, startRefusalFile } from './paths.js';
import { osArchOf } from './platform.js';
import { type Entry, type EntryContext, EX_CONFIG } from './run.js';
import { type ConsentRecord, readConsentRecord, startConsentOf } from './socs.js';

/**
 * The worker's start checks and its refusal file (spec §13; decisions 75 and 76; brief WP17 Task 17.2). The facts are
 * gathered here and judged by core's pure `startChecks`, which the CLI and the app's status read too. Before every
 * exit 78 for one of START_REFUSAL_REASONS the worker writes `<workerData>/start-refusal.json` (0600, `{ reason, at }`
 * only: no message, no path, no secret), and a successful start removes it; `run.ts check --json` prints the same
 * result without starting anything.
 */
export function writeStartRefusal(
  dataDir: string,
  reason: StartRefusalReason,
  at: IsoDateTime,
): StartRefusal {
  const r = startRefusalSchema.parse({ reason, at });
  const file = startRefusalFile(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(r), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return r;
}

export function clearStartRefusal(dataDir: string): void {
  rmSync(startRefusalFile(dataDir), { force: true });
}

export interface GatheredStart {
  facts: StartFacts;
  osArch: OsArch | null;
  install: InstallFacts | null;
  /** What the layout check said when it refused, for the operator's line. */
  installProblem: string | null;
  consent: ConsentRecord | null | 'invalid';
}

/**
 * The start's facts before anything launches: the machine's entry, the layout at the install directory run.ts set,
 * the lock (`locked` as given), the consent record. `signedIn` is false here: an account cookie is read after the
 * launch, and a standing signed-in refusal keeps the worker answering cooling-down only.
 */
export function gatherStart(o: {
  platform: string;
  arch: string;
  dataDir: string;
  locked: boolean;
  clock: Clock;
  /** Verifies the install for this machine's entry (throws InstallRefused); main passes its launch preparation. */
  inspect: (osArch: OsArch, os: 'darwin' | 'linux') => InstallFacts;
}): GatheredStart {
  const osArch = osArchOf(o.platform, o.arch);
  let install: InstallFacts | null = null;
  let installProblem: string | null = null;
  let installedBuild: string | null = null;
  if (osArch !== null && (o.platform === 'darwin' || o.platform === 'linux')) {
    try {
      install = o.inspect(osArch, o.platform);
      installedBuild = install.build;
    } catch (e) {
      if (!(e instanceof InstallRefused)) throw e;
      installProblem = e.message;
      if (e.reason === 'build-mismatch') installedBuild = e.installedBuild;
    }
  }
  const consent = readConsentRecord(o.dataDir, o.clock);
  return {
    osArch,
    install,
    installProblem,
    consent,
    facts: {
      osArch,
      installedBuild,
      // why: a build mismatch is a layout that holds another build: core then names build-mismatch, not layout
      layoutOk: install !== null || installedBuild !== null,
      consent: startConsentOf(consent),
      signedIn: false,
      locked: o.locked,
      now: o.clock.now(),
    },
  };
}

/** The operator's line for a refusal: core's summary and fix, and the layout's own words when that is the cause. */
export function refusalWords(reason: StartRefusalReason, g: GatheredStart): string {
  const t = START_REFUSAL_TEXT[reason];
  const detail =
    (reason === 'layout' || reason === 'build-mismatch') && g.installProblem !== null
      ? ` (${g.installProblem})`
      : '';
  return `${t.summary}${detail}${t.fixCommand === null ? '' : `; fix: ${t.fixCommand}`}`;
}

/** `run.ts check --json`: the start's result as one JSON line, `{ reason, at }` or `{ "ok": true }`; nothing starts. */
export async function check(
  ctx: EntryContext,
  d: { platform: string; arch: string; clock: Clock; locked: (dataDir: string) => boolean },
): Promise<number> {
  if (ctx.args.join(' ') !== '--json') {
    ctx.err('usage: run.ts check --json');
    return EX_CONFIG;
  }
  try {
    loadWorkerConfig(ctx.env);
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
  const home = ctx.env.HOME ?? '';
  const g = gatherStart({
    platform: d.platform,
    arch: d.arch,
    dataDir: ctx.dataDir,
    locked: d.locked(ctx.dataDir),
    clock: d.clock,
    inspect: (osArch, os) => {
      const installDir = installDirFor(osArch, home);
      if (ctx.env.CAMOUFOX_INSTALL_DIR !== installDir)
        throw new InstallRefused(
          'layout',
          `CAMOUFOX_INSTALL_DIR is not ${installDir}; start the worker through run.ts`,
        );
      return ensureInstallLayout({ os, installDir, entry: CAMOUFOX_BUILDS[osArch] });
    },
  });
  const reason = startChecks(g.facts);
  if (reason === null) {
    ctx.out(JSON.stringify({ ok: true }));
    return 0;
  }
  ctx.out(JSON.stringify(startRefusalSchema.parse({ reason, at: g.facts.now })));
  ctx.err(`the camoufox worker would refuse to start: ${refusalWords(reason, g)}`);
  return EX_CONFIG;
}

export const entry: Entry = (ctx) =>
  check(ctx, {
    platform: process.platform,
    arch: process.arch,
    clock: systemClock,
    locked: (dir) => lockHeld(dir),
  });
