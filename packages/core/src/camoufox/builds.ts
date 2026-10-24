/**
 * The Camoufox builds the worker may run, and the verification flags each `<os>-<arch>` earned for its build (spec §2
 * rev 36; decisions 73, 76, 81). Pure data and pure rules: WP16b's CLI and WP17's install pin from CAMOUFOX_BUILDS, the
 * worker reads its flags through `flagsFor` (and its start checks, start.ts, read both), and WP18's status report reads
 * the same rules, so no two of them can disagree.
 */
import { z } from 'zod';
import { isoDateSchema } from '../types/ids.js';

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

const ASSET = `${RELEASE_PREFIX}v152.0.4-beta.28/camoufox-152.0.4-beta.28-`;

/**
 * WP17 §0 (research 17.0a and 17.0b, 2026-10-19): release `v152.0.4-beta.28`, the digests GitHub publishes per asset.
 * why: the unpacked sizes are the research's own round figures (about 670 MB for the macOS app, about 1.25 GB for the
 * flat Linux tree), used only for the planner's free-space check, which adds the download's own size.
 */
export const CAMOUFOX_BUILDS = {
  'darwin-arm64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}mac.arm64.zip`,
    sha256: '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
    bytes: 312_626_286,
    unpackedBytes: 670_000_000,
    hashedOn: '2026-10-19',
  },
  'darwin-x64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}mac.x86_64.zip`,
    sha256: '6e0efd66f6db46bece072827cb2c5a4851bca822ff4fed95b8a0c2fb6f61a3d4',
    bytes: 319_866_512,
    unpackedBytes: 670_000_000,
    hashedOn: '2026-10-19',
  },
  'linux-arm64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}lin.arm64.zip`,
    sha256: '3a105a2fc929e80a79b4b7fce2c93ed62c4fb2c877f3c1ed2a5d66a1c4fe968f',
    bytes: 653_814_950,
    unpackedBytes: 1_250_000_000,
    hashedOn: '2026-10-19',
  },
  'linux-x64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}lin.x86_64.zip`,
    sha256: '924f3109ccd6d47cd6a0384d67a345fadf975d48b6319f8dbbd5954c588982bd',
    bytes: 663_387_175,
    unpackedBytes: 1_250_000_000,
    hashedOn: '2026-10-19',
  },
} as const satisfies Record<OsArch, CamoufoxBuild>;

/** The install's directory name: the build and the digest's first 8 hex characters (the operator's Mac: `…-8b7680a6`). */
export const bundleDirName = (b: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  `${b.build}-${b.sha256.slice(0, 8)}`;

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
};

/**
 * The verified flags per `<os>-<arch>` (spec §2 rev 36). darwin-arm64 carries the 2026-10-18 recordings' values on the
 * operator's Mac (the worker's PROOFS name each one); the other three earn theirs in WP17's recording sessions.
 */
export const FLAGS: Readonly<Record<OsArch, VerifiedSet>> = {
  'darwin-arm64': {
    build: '152.0.4-beta.28',
    flags: {
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      // why: the view-more recording's minimum was no lower than the results page's
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
    },
  },
  'darwin-x64': { build: '152.0.4-beta.28', flags: NONE },
  'linux-arm64': { build: '152.0.4-beta.28', flags: NONE },
  'linux-x64': { build: '152.0.4-beta.28', flags: NONE },
};

/** The flags of `osArch` when it runs the build they were earned on; all false on any other build. */
export function flagsFor(osArch: OsArch, runningBuild: string): Readonly<Record<FlagName, boolean>> {
  const set = FLAGS[osArch];
  return set.build === runningBuild ? set.flags : NONE;
}
