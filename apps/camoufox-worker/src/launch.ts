import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// why: fix round 1 (arch M11): the pin's one copy is core's, which the app's smoke reads too
import { CAMOUFOX_BUILDS, CAMOUFOX_JS_VERSION, type OsArch } from '@gmt/core';
import type { ContextLike, HeadedContextLike } from './driver.js';
import { writeFontsConf } from './fonts.js';
import { ensureInstallLayout, type InstallFacts, InstallRefused } from './install.js';
import { installDirFor } from './paths.js';
import { assertSupportedPlatform, osArchOf } from './platform.js';

/**
 * The launch options (spec §2 "Limits"; decision 69; brief §7, verified in camoufox-js 0.11.5's source): headless,
 * English, the bundle's own Firefox major with the leak warning silenced (no manual config, no custom fingerprint), no
 * add-on (uBlock Origin excluded, so nothing is fetched from addons.mozilla.org), no geolocation lookup, no proxy, no
 * humanised input, service workers blocked, signal handling left to the worker, a minimal browser environment (never the
 * worker's own key) and the six preferences that switch off the browser's own background services.
 */
/** Refuses any camoufox-js but the pin, naming both. */
function assertPinned(version: string): void {
  if (version !== CAMOUFOX_JS_VERSION)
    throw new Error(`camoufox-js is ${version}; this worker is verified against ${CAMOUFOX_JS_VERSION} only`);
}

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
  /** Linux: the generated fonts.conf (spec §2 "Method"); absent on macOS, whose launch env is unchanged. */
  fontconfigFile?: string;
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
    // why: ruling 7 of 2026-10-18 (WP15 round 1): a fixed 1280 × 900 window (camoufox-js's own `window` option, from
    // which the context measures its viewport; an explicit viewport over a generated window can hang a second newPage,
    // daijro/camoufox#666), so the date grid's layout never follows a generated screen size. Layout only.
    window: [1280, 900],
    env: {
      HOME: o.home,
      PATH: o.path,
      TMPDIR: o.tmp,
      LANG: 'en_GB.UTF-8',
      ...(o.fontconfigFile === undefined ? {} : { FONTCONFIG_FILE: o.fontconfigFile }),
    },
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
export async function launchContext(
  options: LaunchOptions,
  userDataDir: string,
  readCamoufoxJs: () => string = installedCamoufoxJsVersion,
): Promise<ContextLike> {
  assertPinned(readCamoufoxJs());
  const { Camoufox } = await import('camoufox-js');
  return Camoufox({
    ...options,
    exclude_addons: [...options.exclude_addons],
    window: [...options.window],
    firefox_user_prefs: { ...options.firefox_user_prefs },
    env: { ...options.env },
    user_data_dir: userDataDir,
  });
}

/**
 * The consent command's and the consent research's visible window (spec §2 "Consent"; decision 74): the same options
 * but headed, with the display variables `headedEnv` chose added to the browser's environment. Nothing else changes;
 * the server path never calls this.
 */
export async function launchHeadedContext(
  options: LaunchOptions,
  userDataDir: string,
  display: Readonly<Record<string, string>>,
  readCamoufoxJs: () => string = installedCamoufoxJsVersion,
): Promise<HeadedContextLike> {
  assertPinned(readCamoufoxJs());
  const { Camoufox } = await import('camoufox-js');
  return Camoufox({
    ...options,
    headless: false,
    exclude_addons: [...options.exclude_addons],
    window: [...options.window],
    firefox_user_prefs: { ...options.firefox_user_prefs },
    env: { ...options.env, ...display },
    user_data_dir: userDataDir,
  });
}

/**
 * Everything a launch needs, checked in order before camoufox-js is imported (brief WP17 Task 17.2): macOS or Linux; the
 * install directory run.ts set (CAMOUFOX_INSTALL_DIR, which camoufox-js reads once at import) is this machine's; the
 * layout there holds the pinned build (verified only, so camoufox-js never reaches its download branch); the camoufox-js
 * pin; on Linux the generated fonts.conf; then the launch options from the bundle's own Firefox major.
 */
export function prepareLaunch(o: {
  platform: string;
  arch: string;
  /** The CAMOUFOX_INSTALL_DIR run.ts set (the entry's environment), asserted here. */
  installDirSet: string | undefined;
  dataDir: string;
  home: string;
  path: string;
  tmp: string;
  /** Test seam (fix round 1, prov-int M2): reads the installed camoufox-js version. */
  readCamoufoxJs?: () => string;
}): { options: LaunchOptions; install: InstallFacts; camoufoxJs: string; osArch: OsArch } {
  assertSupportedPlatform(o.platform);
  const osArch = osArchOf(o.platform, o.arch);
  if (osArch === null) throw new Error(`no Camoufox build is pinned for ${o.platform}-${o.arch}`);
  const installDir = installDirFor(osArch, o.home);
  if (o.installDirSet !== installDir)
    throw new InstallRefused(
      'layout',
      `CAMOUFOX_INSTALL_DIR is not ${installDir}; start the worker through run.ts, which sets it`,
    );
  const install = ensureInstallLayout({ os: o.platform, installDir, entry: CAMOUFOX_BUILDS[osArch] });
  const camoufoxJs = (o.readCamoufoxJs ?? installedCamoufoxJsVersion)();
  assertPinned(camoufoxJs);
  const fontconfigFile = o.platform === 'linux' ? writeFontsConf(o.dataDir, install.bundleDir) : undefined;
  return {
    options: buildLaunchOptions({
      ffMajor: install.ffMajor,
      home: o.home,
      path: o.path,
      tmp: o.tmp,
      ...(fontconfigFile === undefined ? {} : { fontconfigFile }),
    }),
    install,
    camoufoxJs,
    osArch,
  };
}
