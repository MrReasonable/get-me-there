import { join } from 'node:path/posix';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { appEnvPath } from '../services/specs.js';
import { readEnvText } from '../setup/appEnv.js';
import { bundlePath, officialDir, osArchOf, staysOffNote } from './install.js';
import { installCamoufox, oldBundleRemovals } from './installer.js';
import { type Manifest, manifestArgv, parseManifest } from './manifest.js';

/**
 * `gmt update`'s Camoufox steps (spec §13; decision 73; W6). Where no Camoufox is installed and the provider is off,
 * nothing is done, and update only says when the provider is now offered on this machine. Otherwise:
 * - before the app stops, the next commit's pin (`git show origin/main:<pin.ts>`, read alone by this code's printer) is
 *   downloaded, verified and unpacked beside the running bundle, so the app is not down for the download; a failure
 *   there is said and the step runs again after the build;
 * - after the build, the new code's own pin (its printer) is installed, with its layout switched, only when its flags
 *   are set (an installed pin is re-checked whatever its flags); a pin without flags keeps the old bundle, saying so;
 * - once the app is healthy, every other bundle is removed (`after`).
 */
export const PIN_FILE = 'packages/core/src/camoufox/pin.ts';

/** Update's note when the new code offers the browser provider on this machine (pinned by a test). */
export const availableNote = (osArch: string): string =>
  `The browser provider is now available on ${osArch}: turn it on with pnpm gmt setup --reconfigure browser`;

export type BrowserStep = { ok: true; after: Action[] } | { ok: false; message: string };

/** Whether this machine has the browser provider: a bundle under the root, or app.env turning it on. */
function browserHere(deps: Deps): boolean {
  if ((deps.files.list(officialDir(deps.platform.paths.camoufoxRoot)) ?? []).length > 0) return true;
  try {
    return readEnvText(deps.files.read(appEnvPath(deps.platform.paths)) ?? '').CAMOUFOX_ENABLED === 'true';
  } catch {
    return false;
  }
}

async function readManifest(deps: Deps, osArchKey: string, pinFile?: string): Promise<Manifest | null> {
  const osArch = osArchOf(deps.platform);
  if (osArch === null || osArch !== osArchKey) return null;
  const read = await deps.run(manifestArgv(deps.execPath, deps.checkout, osArch, pinFile), {
    cwd: join(deps.checkout, 'apps', 'cli'),
    timeoutMs: 120_000,
    env: deps.childEnv,
  });
  return read.code === 0 ? parseManifest(read.stdout) : null;
}

/**
 * Before the stop: the next commit's bundle put in place beside the running one (no layout switch). `pinText` is that
 * commit's pin.ts, or null when it could not be read. Never fails the update: a problem is said, and the install runs
 * again after the build.
 */
export async function camoufoxPrefetch(deps: Deps, pinText: string | null): Promise<void> {
  const osArch = osArchOf(deps.platform);
  if (osArch === null || deps.platform.os === 'win32' || !browserHere(deps)) return;
  const later = 'the browser install runs after the build instead';
  if (pinText === null) {
    deps.io.out(`the next commit’s Camoufox pin could not be read; ${later}\n`);
    return;
  }
  const file = join(deps.platform.paths.state, `update-pin-${deps.randomBytes(4).toString('hex')}.ts`);
  const wrote = await apply(
    {
      command: 'update: read the next pin',
      actions: [{ kind: 'writeFile', path: file, contents: pinText, mode: 0o600, secret: false }],
      notes: [],
    },
    deps.executor,
  );
  const manifest = wrote.failed === null ? await readManifest(deps, osArch, file) : null;
  await apply(
    {
      command: 'update: read the next pin',
      actions: [{ kind: 'remove', path: file, recursive: false }],
      notes: [],
    },
    deps.executor,
  );
  if (manifest === null) {
    deps.io.out(`the next commit’s Camoufox pin is not one this code reads; ${later}\n`);
    return;
  }
  const bundle = bundlePath(deps.platform.paths.camoufoxRoot, manifest.entry);
  if (deps.files.isDir(bundle) || !manifest.flags.FORM_VERIFIED) return;
  const r = await installCamoufox(deps, {
    command: 'update: download Camoufox',
    entry: manifest.entry,
    layout: false,
  });
  if (r.kind !== 'ok') deps.io.out(`${r.message}\n${later}\n`);
}

/** After the build, before the start. */
export async function camoufoxUpdateStep(deps: Deps): Promise<BrowserStep> {
  const os = deps.platform.os;
  const osArch = osArchOf(deps.platform);
  if (os === 'win32' || osArch === null) return { ok: true, after: [] };
  const manifest = await readManifest(deps, osArch);
  if (!browserHere(deps)) {
    // why: decision 75: once recordings set this machine's flags, update says the provider is now offered here
    if (manifest?.flags.FORM_VERIFIED === true) deps.io.out(`${availableNote(osArch)}\n`);
    return { ok: true, after: [] };
  }
  if (manifest === null) return { ok: false, message: 'the new code’s Camoufox pin could not be read' };
  const bundle = bundlePath(deps.platform.paths.camoufoxRoot, manifest.entry);
  // why: an installed pin is checked whatever its flags; a new one is installed only once its recordings set them
  if (!deps.files.isDir(bundle) && !manifest.flags.FORM_VERIFIED) {
    deps.io.out(`${staysOffNote(osArch, manifest.entry.build)}\n`);
    return { ok: true, after: [] };
  }
  const r = await installCamoufox(deps, { command: 'update: the browser install', entry: manifest.entry });
  if (r.kind === 'refused' || r.kind === 'failed') return { ok: false, message: r.message };
  // why: the app runs without the browser provider; the worker refuses to start until the libraries are there
  if (r.kind === 'libraries') deps.io.err(`${r.message}\n`);
  return { ok: true, after: oldBundleRemovals(deps, r.bundle) };
}

/** Exported for the update's dry run: the plan's one line about the browser. */
export const DRY_RUN_LINE =
  'update: the browser install\n  then: download the next pin before the stop when its recordings set its flags, switch to it after the build, and remove older bundles once the app is healthy\n';

/** The step's failure words: the cause, and that the app comes back without the worker meanwhile. */
export const browserFailureLine = (message: string): string =>
  `${message}\nThe app starts again without the browser worker; pnpm gmt browser install retries the install.\n`;
