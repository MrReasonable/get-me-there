/**
 * The Camoufox builds the worker may run, and the verification flags each `<os>-<arch>` earned for its build (spec §2
 * rev 36; decisions 73, 76, 81). Pure data and pure rules: WP16b's CLI and WP17's install pin from CAMOUFOX_BUILDS, the
 * worker reads its flags through `flagsFor` (and its start checks, start.ts, read both), and WP18's status report reads
 * the same rules, so no two of them can disagree.
 */
import { z } from 'zod';
import { isoDateSchema } from '../types/ids.js';
import { CAMOUFOX_PIN } from './pin.js';

/** The machines a build is pinned for (spec §2 rev 36: macOS or Linux; Windows is a later work package). */
export const OS_ARCHES = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'] as const;
export type OsArch = (typeof OS_ARCHES)[number];

/** Every asset comes from the project's own GitHub releases, over https. */
const RELEASE_PREFIX = 'https://github.com/daijro/camoufox/releases/download/';

/** One pinned asset: its build, URL, SHA-256, size and unpacked size, and when the digest was taken. */
export const camoufoxBuildSchema = z.strictObject({
  build: z.string().regex(/^\d+\.\d+\.\d+-[a-z]+\.\d+$/),
  url: z.string().startsWith(RELEASE_PREFIX),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  unpackedBytes: z.number().int().positive(),
  hashedOn: isoDateSchema,
});
export type CamoufoxBuild = z.input<typeof camoufoxBuildSchema>;

/**
 * WP17 §0 (research 17.0a and 17.0b, 2026-10-19): release `v152.0.4-beta.28`, the digests GitHub publishes per asset
 * (pin.ts holds them).
 */
export const CAMOUFOX_BUILDS: Readonly<Record<OsArch, CamoufoxBuild>> = CAMOUFOX_PIN.builds;

/** The install's directory name: the build and the digest's first 8 hex characters (the operator's Mac: `…-8b7680a6`). */
export const bundleDirName = (b: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  `${b.build}-${b.sha256.slice(0, 8)}`;
/** Where a pinned bundle lives under the install root (`camoufoxRootDir`): `browsers/official/<bundleDirName>`. */
export const bundleRelPath = (b: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  `browsers/official/${bundleDirName(b)}`;

const OS_ARCH: Readonly<Record<string, Readonly<Record<string, OsArch>>>> = {
  darwin: { arm64: 'darwin-arm64', x64: 'darwin-x64' },
  linux: { arm64: 'linux-arm64', x64: 'linux-x64' },
};
/** The `CAMOUFOX_BUILDS` key of an os (process.platform) and arch (process.arch), or null where none is pinned. */
export function osArchOf(os: string, arch: string): OsArch | null {
  return OS_ARCH[os]?.[arch] ?? null;
}

/** A build's camoufox-js `version.json` parts: the version before the first hyphen, the release after it. */
export function versionOf(b: Pick<CamoufoxBuild, 'build'>): { version: string; release: string } {
  const i = b.build.indexOf('-');
  return { version: b.build.slice(0, i), release: b.build.slice(i + 1) };
}

/** The hosts a release download may be redirected to; any other host, or plain http, is refused (decision 73). */
export const REDIRECT_HOSTS = [
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
] as const;

/** Every verification flag the worker's selectors module has, listed exhaustively (spec §2; WP14, WP15). */
export const FLAG_NAMES = [
  'RESULTS_VERIFIED',
  'FORM_VERIFIED',
  'CHEAPEST_FLOW_VERIFIED',
  'VIEW_MORE_ADDS_CHEAPER',
  'NO_FLIGHTS_VERIFIED',
  'SOCS_STABLE',
  'GRID_VERIFIED',
  // why: WP17 Task 17.4: the consent command's landing view, false until research 17.0c's recordings show it
  'LANDING_VERIFIED',
] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

/** The flags one `<os>-<arch>` earned, and the build they were earned on (a flag is never carried to another build). */
export interface VerifiedSet {
  build: string;
  flags: Readonly<Record<FlagName, boolean>>;
}

const NONE: Readonly<Record<FlagName, boolean>> = {
  RESULTS_VERIFIED: false,
  FORM_VERIFIED: false,
  CHEAPEST_FLOW_VERIFIED: false,
  VIEW_MORE_ADDS_CHEAPER: false,
  NO_FLIGHTS_VERIFIED: false,
  SOCS_STABLE: false,
  GRID_VERIFIED: false,
  LANDING_VERIFIED: false,
};

/**
 * The verified flags per `<os>-<arch>` (spec §2 rev 36; pin.ts holds them). darwin-arm64 carries the 2026-10-18
 * recordings' values on the operator's Mac (the worker's PROOFS name each one); the other three earn theirs in WP17's
 * recording sessions.
 */
export const FLAGS: Readonly<Record<OsArch, VerifiedSet>> = CAMOUFOX_PIN.flags;

const verifiedSetSchema = z.strictObject({
  build: z.string(),
  flags: z.record(z.enum(FLAG_NAMES), z.boolean()),
});
/**
 * A pin as data (pin.ts's shape): what `gmt update` checks the next commit's copy of pin.ts against before it uses it
 * (W6: the new bundle is downloaded while the app still runs).
 */
export const pinSchema = z.strictObject({
  builds: z.strictObject({
    'darwin-arm64': camoufoxBuildSchema,
    'darwin-x64': camoufoxBuildSchema,
    'linux-arm64': camoufoxBuildSchema,
    'linux-x64': camoufoxBuildSchema,
  }),
  flags: z.strictObject({
    'darwin-arm64': verifiedSetSchema,
    'darwin-x64': verifiedSetSchema,
    'linux-arm64': verifiedSetSchema,
    'linux-x64': verifiedSetSchema,
  }),
});
export type Pin = z.output<typeof pinSchema>;

/** The flags `pin` gives `osArch` when it runs `runningBuild`; all false on any other build. */
export function flagsIn(
  pin: { flags: Readonly<Record<OsArch, VerifiedSet>> },
  osArch: OsArch,
  runningBuild: string,
): Readonly<Record<FlagName, boolean>> {
  const set = pin.flags[osArch];
  return set.build === runningBuild ? set.flags : NONE;
}

/** The flags of `osArch` when it runs the build they were earned on; all false on any other build. */
export function flagsFor(osArch: OsArch, runningBuild: string): Readonly<Record<FlagName, boolean>> {
  return flagsIn({ flags: FLAGS }, osArch, runningBuild);
}
