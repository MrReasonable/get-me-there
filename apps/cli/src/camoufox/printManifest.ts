// The checkout's own Camoufox pin and flags for one `<os>-<arch>`, printed as one JSON line (manifest.ts): `gmt update`
// runs this after its merge and build, from the code it just built; with `--pin <file>` it prints the manifest of that
// copy of pin.ts (the next commit's, read before the app stops), checked against this code's pinSchema.
import { pathToFileURL } from 'node:url';
import { EXIT, OS_ARCHES, pinSchema } from '@gmt/core';
import { tsImport } from 'tsx/esm/api';
import { manifestFor } from './manifest.js';

const [arg, flag, file] = process.argv.slice(2);
const osArch = OS_ARCHES.find((k) => k === arg);
const usage = `usage: printManifest.ts <${OS_ARCHES.join('|')}> [--pin <pin.ts>]\n`;
if (osArch === undefined || (flag !== undefined && (flag !== '--pin' || file === undefined))) {
  process.stderr.write(usage);
  process.exitCode = EXIT.usage;
} else if (file === undefined) process.stdout.write(`${JSON.stringify(manifestFor(osArch))}\n`);
else {
  // why: tsx loads that one TypeScript file, which imports nothing (pin.ts's rule), and nothing else of the next commit
  const mod: unknown = await tsImport(pathToFileURL(file).href, import.meta.url);
  const pin = pinSchema.safeParse(
    typeof mod === 'object' && mod !== null && 'CAMOUFOX_PIN' in mod ? mod.CAMOUFOX_PIN : null,
  );
  if (!pin.success) {
    process.stderr.write(`${file} is not a pin this code can read\n`);
    process.exitCode = EXIT.badConfig;
  } else process.stdout.write(`${JSON.stringify(manifestFor(osArch, pin.data))}\n`);
}
