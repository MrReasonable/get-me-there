// The checkout's own Camoufox pin and flags for one `<os>-<arch>`, printed as one JSON line (manifest.ts): `gmt update`
// runs this after its merge and build, from the code it just built; with `--pin <file>` it prints the manifest of that
// copy of pin.ts (the next commit's, read before the app stops), checked against this code's pinSchema.
// Stryker disable all: the thin entry; its rules are manifest.ts's printManifest (mutated), and
// test/camoufox/install-children.test.ts runs this file as a real child, which the per-mutant command leaves out
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { printManifest } from './manifest.js';

const r = await printManifest(process.argv.slice(2), (file) =>
  // why: tsx loads that one TypeScript file, which imports nothing (pin.ts's rule), and nothing else of the next commit
  tsImport(pathToFileURL(file).href, import.meta.url),
);
if (r.out !== '') process.stdout.write(r.out);
if (r.err !== '') process.stderr.write(r.err);
process.exitCode = r.code;
