import { join } from 'node:path/posix';
import {
  CAMOUFOX_BUILDS,
  type CamoufoxBuild,
  camoufoxBuildSchema,
  FLAG_NAMES,
  type FlagName,
  flagsFor,
  type OsArch,
} from '@gmt/core';
import { z } from 'zod';

/**
 * One machine's pin and its flags (spec §2 "Method"; decision 73): `CAMOUFOX_BUILDS[osArch]` and `flagsFor(osArch,
 * build)`. `gmt update` runs the checkout's own code after its merge and build (`apps/cli/src/printManifest.ts`), because the
 * process running the update still holds the manifest it started with; this is the one shape that crosses that line.
 */
export interface Manifest {
  entry: CamoufoxBuild;
  flags: Readonly<Record<FlagName, boolean>>;
}
export const manifestSchema = z.strictObject({
  entry: camoufoxBuildSchema,
  flags: z.record(z.enum(FLAG_NAMES), z.boolean()),
});

/** This build of the code's pin for `osArch`. */
export function manifestFor(osArch: OsArch): Manifest {
  const entry = CAMOUFOX_BUILDS[osArch];
  return { entry, flags: flagsFor(osArch, entry.build) };
}

/** The argv that prints the checkout's manifest for `osArch` (run from the CLI package, where tsx resolves). */
export function manifestArgv(execPath: string, checkout: string, osArch: OsArch): string[] {
  return [
    execPath,
    '--conditions=@gmt/source',
    '--import',
    'tsx',
    join(checkout, 'apps', 'cli', 'src', 'printManifest.ts'),
    osArch,
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
