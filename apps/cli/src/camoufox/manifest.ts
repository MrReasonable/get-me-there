import { join } from 'node:path/posix';
import {
  CAMOUFOX_BUILDS,
  type CamoufoxBuild,
  camoufoxBuildSchema,
  FLAG_NAMES,
  FLAGS,
  type FlagName,
  flagsIn,
  type OsArch,
  type VerifiedSet,
} from '@gmt/core';
import { z } from 'zod';

/**
 * One machine's pin and its flags (spec §2 "Method"; decision 73): `CAMOUFOX_BUILDS[osArch]` and `flagsFor(osArch,
 * build)`. `gmt update` runs the checkout's own code after its merge and build (`printManifest.ts`), because the process
 * running the update still holds the manifest it started with; this is the one shape that crosses that line. Before it
 * stops the app, update also reads the next commit's pin.ts alone (`--pin <file>`) to download that bundle early (W6).
 */
export interface Manifest {
  entry: CamoufoxBuild;
  flags: Readonly<Record<FlagName, boolean>>;
}
export const manifestSchema = z.strictObject({
  entry: camoufoxBuildSchema,
  flags: z.record(z.enum(FLAG_NAMES), z.boolean()),
});

/** A pin's manifest for `osArch`: this build of the code's own pin unless another (a validated pin.ts) is given. */
export function manifestFor(
  osArch: OsArch,
  pin: {
    builds: Readonly<Record<OsArch, CamoufoxBuild>>;
    flags: Readonly<Record<OsArch, VerifiedSet>>;
  } = { builds: CAMOUFOX_BUILDS, flags: FLAGS },
): Manifest {
  const entry = pin.builds[osArch];
  return { entry, flags: flagsIn(pin, osArch, entry.build) };
}

/**
 * The argv that prints the checkout's manifest for `osArch` (run from the CLI package, where tsx resolves); with
 * `pinFile`, the manifest of that copy of pin.ts instead, checked by this code's own schema.
 */
export function manifestArgv(execPath: string, checkout: string, osArch: OsArch, pinFile?: string): string[] {
  return [
    execPath,
    '--conditions=@gmt/source',
    '--import',
    'tsx',
    join(checkout, 'apps', 'cli', 'src', 'camoufox', 'printManifest.ts'),
    osArch,
    ...(pinFile === undefined ? [] : ['--pin', pinFile]),
  ];
}

/** The printed manifest, or null when it is not one (nothing from it is used then). */
export function parseManifest(stdout: string): Manifest | null {
  try {
    const r = manifestSchema.safeParse(JSON.parse(stdout));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
