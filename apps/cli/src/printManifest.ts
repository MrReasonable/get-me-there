// The checkout's own Camoufox pin and flags for one `<os>-<arch>`, printed as one JSON line (manifest.ts): `gmt update`
// runs this after its merge and build, from the code it just built.
import { OS_ARCHES } from '@gmt/core';
import { manifestFor } from './camoufox/manifest.js';

const osArch = OS_ARCHES.find((k) => k === process.argv[2]);
if (osArch === undefined) {
  process.stderr.write(`usage: printManifest.ts <${OS_ARCHES.join('|')}>\n`);
  process.exitCode = 64;
} else process.stdout.write(`${JSON.stringify(manifestFor(osArch))}\n`);
