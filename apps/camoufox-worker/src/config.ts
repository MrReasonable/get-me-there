import { Secret } from '@gmt/core';
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
  const cooldownHours = intIn(env, 'CAMOUFOX_COOLDOWN_HOURS', 24, 100_000, 48, bad);
  const pageTimeoutSeconds = intIn(env, 'CAMOUFOX_PAGE_TIMEOUT_SECONDS', 30, 240, 90, bad);
  const installDir = env.CAMOUFOX_INSTALL_DIR;
  // why: decision 69 round 2: the worker launches only from camoufox-js's default install directory.
  if (installDir !== undefined && installDir !== '') bad.push('CAMOUFOX_INSTALL_DIR');
  const binaryBuild =
    env.CAMOUFOX_BINARY_BUILD === undefined || env.CAMOUFOX_BINARY_BUILD === ''
      ? DEFAULT_BINARY_BUILD
      : env.CAMOUFOX_BINARY_BUILD;
  if (!/^\d+\.\d+(\.\d+)?-[a-z]+\.\d+$/.test(binaryBuild)) bad.push('CAMOUFOX_BINARY_BUILD');
  const pointOfSale = env.POINT_OF_SALE === undefined || env.POINT_OF_SALE === '' ? 'GB' : env.POINT_OF_SALE;
  if (!/^[A-Z]{2}$/.test(pointOfSale)) bad.push('POINT_OF_SALE');
  const modeRaw = env.CAMOUFOX_MODE ?? '';
  const mode = modeRaw === '' || modeRaw === 'list' ? 'list' : modeRaw === 'grid' ? 'grid' : null;
  if (mode === null) bad.push('CAMOUFOX_MODE');
  const gridScrollSpacingSeconds = intIn(env, 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', 5, 30, 5, bad);
  const gridScrollCap = intIn(env, 'CAMOUFOX_GRID_SCROLL_CAP', 0, 60, 30, bad);
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
    mode: mode ?? 'list',
    gridScrollSpacingSeconds,
    gridScrollCap,
  };
}
