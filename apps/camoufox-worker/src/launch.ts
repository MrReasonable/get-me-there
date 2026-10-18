import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ContextLike } from './driver.js';

/**
 * The launch options (spec §2 "Limits"; decision 69; brief §7, verified in camoufox-js 0.11.5's source): headless,
 * English, the bundle's own Firefox major with the leak warning silenced (no manual config, no custom fingerprint), no
 * add-on (uBlock Origin excluded, so nothing is fetched from addons.mozilla.org), no geolocation lookup, no proxy, no
 * humanised input, service workers blocked, signal handling left to the worker, a minimal browser environment (never the
 * worker's own key) and the six preferences that switch off the browser's own background services.
 */
export const CAMOUFOX_JS_VERSION = '0.11.5';

export const BACKGROUND_PREFS = {
  'toolkit.telemetry.enabled': false,
  'datareporting.healthreport.uploadEnabled': false,
  'datareporting.policy.dataSubmissionEnabled': false,
  'browser.crashReports.unsubmittedCheck.autoSubmit2': false,
  'app.normandy.enabled': false,
  'network.captive-portal-service.enabled': false,
} as const;

export interface LaunchInput {
  ffMajor: number;
  home: string;
  path: string;
  tmp: string;
}

export function buildLaunchOptions(o: LaunchInput) {
  return {
    headless: true,
    locale: 'en-GB',
    os: 'macos',
    ff_version: o.ffMajor,
    i_know_what_im_doing: true,
    exclude_addons: ['UBO'],
    geoip: false,
    serviceWorkers: 'block',
    handleSIGTERM: false,
    handleSIGINT: false,
    handleSIGHUP: false,
    env: { HOME: o.home, PATH: o.path, TMPDIR: o.tmp, LANG: 'en_GB.UTF-8' },
    firefox_user_prefs: { ...BACKGROUND_PREFS },
  } as const;
}
export type LaunchOptions = ReturnType<typeof buildLaunchOptions>;

/** The launch options as a recording's meta stores them: everything but `env` (PIE-R2-11). */
export function launchOptionsForMeta(o: LaunchOptions): Omit<LaunchOptions, 'env'> {
  const { env: _env, ...rest } = o;
  return rest;
}

/** The installed camoufox-js version, read from its own package.json; the worker refuses any but the pin. */
export function installedCamoufoxJsVersion(): string {
  const require = createRequire(import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(require.resolve('camoufox-js/package.json'), 'utf8'));
  return typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string'
    ? raw.version
    : 'unknown';
}

/**
 * Launches Camoufox into the persistent profile `userDataDir` and returns its context. camoufox-js is imported here,
 * lazily, so no other module (and no unit test) loads it; its module reads INSTALL_DIR at import.
 */
export async function launchContext(options: LaunchOptions, userDataDir: string): Promise<ContextLike> {
  const version = installedCamoufoxJsVersion();
  if (version !== CAMOUFOX_JS_VERSION)
    throw new Error(`camoufox-js is ${version}; this worker is verified against ${CAMOUFOX_JS_VERSION} only`);
  const { Camoufox } = await import('camoufox-js');
  return Camoufox({
    ...options,
    exclude_addons: [...options.exclude_addons],
    firefox_user_prefs: { ...options.firefox_user_prefs },
    env: { ...options.env },
    user_data_dir: userDataDir,
  });
}
