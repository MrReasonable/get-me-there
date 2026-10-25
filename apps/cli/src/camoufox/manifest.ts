import { join } from 'node:path/posix';
import {
  CAMOUFOX_BUILDS,
  type CamoufoxBuild,
  camoufoxBuildSchema,
  EXIT,
  FLAG_NAMES,
  FLAGS,
  type FlagName,
  flagsIn,
  OS_ARCHES,
  type OsArch,
  pinSchema,
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

/**
 * printManifest.ts's work, with the loader of a pin file injected (tsx's in production): `<os>-<arch>` prints this
 * code's manifest; `<os>-<arch> --pin <file>` that file's `CAMOUFOX_PIN`, refused (78) unless this code's pinSchema
 * reads it; anything else is a usage error (64).
 */
export async function printManifest(
  args: readonly string[],
  load: (file: string) => Promise<unknown>,
): Promise<{ code: number; out: string; err: string }> {
  const [arg, flag, file, ...rest] = args;
  const osArch = OS_ARCHES.find((k) => k === arg);
  if (
    osArch === undefined ||
    rest.length > 0 ||
    (flag !== undefined && (flag !== '--pin' || file === undefined))
  )
    return {
      code: EXIT.usage,
      out: '',
      err: `usage: printManifest.ts <${OS_ARCHES.join('|')}> [--pin <pin.ts>]\n`,
    };
  if (file === undefined) return { code: EXIT.ok, out: `${JSON.stringify(manifestFor(osArch))}\n`, err: '' };
  let mod: unknown;
  try {
    mod = await load(file);
  } catch {
    mod = null;
  }
  const pin = pinSchema.safeParse(
    typeof mod === 'object' && mod !== null && 'CAMOUFOX_PIN' in mod ? mod.CAMOUFOX_PIN : null,
  );
  return pin.success
    ? { code: EXIT.ok, out: `${JSON.stringify(manifestFor(osArch, pin.data))}\n`, err: '' }
    : { code: EXIT.badConfig, out: '', err: `${file} is not a pin this code can read\n` };
}
