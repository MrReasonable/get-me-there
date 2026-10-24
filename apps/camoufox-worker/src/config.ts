import { readSharedSettings, Secret, type SharedSettings, sharedInt, sharedMode } from '@gmt/core';
import { DEFAULT_BINARY_BUILD } from './install.js';
import type { Env } from './run.js';

/**
 * The worker's settings (spec §12 rev 32 "worker side only"; brief Task 14.5), read only from `<data>/worker.env`
 * through run.ts. Every refusal names the variable, never its value. CAMOUFOX_COOLDOWN_HOURS and
 * CAMOUFOX_PAGE_TIMEOUT_SECONDS must equal the app's (the smoke flags a mismatch).
 */
export interface WorkerConfig {
  key: Secret;
  port: number;
  minSpacingSeconds: number;
  cooldownHours: number;
  pageTimeoutSeconds: number;
  binaryBuild: string;
  /** The minimal browser environment's values (never the worker's own variables). */
  home: string;
  path: string;
  tmp: string;
  /** POINT_OF_SALE for `gl` in the recorder's own requests (the app sends its own on every page request). */
  pointOfSale: string;
  /** Spec §2 rev 34: `grid` serves grid pages once GRID_VERIFIED; `list` (the default) answers them mode-unavailable. */
  mode: 'list' | 'grid';
  /** Grid pages: scroll clicks start to start (at least 5 s, never randomised), and the scrolls a page may make. */
  gridScrollSpacingSeconds: number;
  gridScrollCap: number;
  /**
   * Decision 82: the monthly page and scroll caps and the billing day, with the app's defaults. This package reads and
   * reports them; WP17's worker enforces them across every caller over the ledger's billing month.
   */
  monthlyPageCap: number;
  monthlyScrollCap: number;
  billingDay: number;
  /** Spec §12: the effective shared settings, as `/v1/status` reports them for the app's preflight to compare. */
  sharedSettings: SharedSettings;
}

export class WorkerConfigError extends Error {
  constructor(readonly fields: string[]) {
    super(`the worker's settings in worker.env are not valid: ${fields.join(', ')}`);
    this.name = 'WorkerConfigError';
  }
}

function intIn(env: Env, name: string, min: number, max: number, dflt: number, bad: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return dflt;
  const v = Number(raw);
  if (!/^\d+$/.test(raw) || v < min || v > max) {
    bad.push(name);
    return dflt;
  }
  return v;
}

/** Parses the worker's environment; throws WorkerConfigError naming every bad variable at once. */
export function loadWorkerConfig(env: Env): WorkerConfig {
  const bad: string[] = [];
  const key = env.CAMOUFOX_WORKER_KEY ?? '';
  if (key.length < 32) bad.push('CAMOUFOX_WORKER_KEY');
  const port = intIn(env, 'CAMOUFOX_WORKER_PORT', 1024, 65535, 8090, bad);
  const minSpacingSeconds = intIn(env, 'CAMOUFOX_MIN_SPACING_SECONDS', 30, 600, 30, bad);
  // why: spec §12, review R27 — the nine shared settings through core's one rule set, with its bounds and defaults; every
  // typed field below comes from that one effective record
  const shared = readSharedSettings(env);
  bad.push(...shared.invalid);
  const s = shared.settings;
  const cooldownHours = sharedInt(s, 'CAMOUFOX_COOLDOWN_HOURS');
  const pageTimeoutSeconds = sharedInt(s, 'CAMOUFOX_PAGE_TIMEOUT_SECONDS');
  const installDir = env.CAMOUFOX_INSTALL_DIR;
  // why: decision 69 round 2: the worker launches only from camoufox-js's default install directory.
  if (installDir !== undefined && installDir !== '') bad.push('CAMOUFOX_INSTALL_DIR');
  const binaryBuild =
    env.CAMOUFOX_BINARY_BUILD === undefined || env.CAMOUFOX_BINARY_BUILD === ''
      ? DEFAULT_BINARY_BUILD
      : env.CAMOUFOX_BINARY_BUILD;
  if (!/^\d+\.\d+(\.\d+)?-[a-z]+\.\d+$/.test(binaryBuild)) bad.push('CAMOUFOX_BINARY_BUILD');
  const pointOfSale = s.POINT_OF_SALE;
  const mode = sharedMode(s);
  const gridScrollSpacingSeconds = sharedInt(s, 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS');
  const gridScrollCap = sharedInt(s, 'CAMOUFOX_GRID_SCROLL_CAP');
  const monthlyPageCap = sharedInt(s, 'CAMOUFOX_MONTHLY_PAGE_CAP');
  const monthlyScrollCap = sharedInt(s, 'CAMOUFOX_MONTHLY_SCROLL_CAP');
  const billingDay = sharedInt(s, 'CAMOUFOX_BILLING_DAY');
  const home = env.HOME ?? '';
  if (home === '') bad.push('HOME');
  if (bad.length > 0) throw new WorkerConfigError(bad);
  return {
    key: new Secret(key),
    port,
    minSpacingSeconds,
    cooldownHours,
    pageTimeoutSeconds,
    binaryBuild,
    home,
    path: env.PATH ?? '/usr/bin:/bin',
    tmp: env.TMPDIR ?? '/tmp',
    pointOfSale,
    mode,
    gridScrollSpacingSeconds,
    gridScrollCap,
    monthlyPageCap,
    monthlyScrollCap,
    billingDay,
    sharedSettings: s,
  };
}
