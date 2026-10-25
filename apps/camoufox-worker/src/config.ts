import { readSharedSettings, Secret, type SharedSettings, sharedInt, sharedMode } from '@gmt/core';
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

/** Decision 73: the build comes from CAMOUFOX_BUILDS; a worker.env still naming the old setting is refused. */
export const BINARY_BUILD_REMOVED = 'remove CAMOUFOX_BINARY_BUILD: the build now comes from CAMOUFOX_BUILDS';

export class WorkerConfigError extends Error {
  constructor(
    readonly fields: string[],
    message = `the worker's settings in worker.env are not valid: ${fields.join(', ')}`,
  ) {
    super(message);
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
  // why: spec §12, review R27 — the ten shared settings through core's one rule set, with its bounds and defaults; every
  // typed field below comes from that one effective record
  const shared = readSharedSettings(env);
  bad.push(...shared.invalid);
  const s = shared.settings;
  const minSpacingSeconds = sharedInt(s, 'CAMOUFOX_MIN_SPACING_SECONDS');
  const cooldownHours = sharedInt(s, 'CAMOUFOX_COOLDOWN_HOURS');
  const pageTimeoutSeconds = sharedInt(s, 'CAMOUFOX_PAGE_TIMEOUT_SECONDS');
  // why: decision 73: the pin is CAMOUFOX_BUILDS[osArch].build; there is no separate build setting any more
  if (env.CAMOUFOX_BINARY_BUILD !== undefined) throw new WorkerConfigError([], BINARY_BUILD_REMOVED);
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
