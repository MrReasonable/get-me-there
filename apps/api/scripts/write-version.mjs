// Writes dist/version.json ({ "version": "<git short SHA>" }) after the TypeScript build, for the Status report. An
// image or checkout without git leaves "unknown" (no file), which the app reads as such.
// Usage: node scripts/write-version.mjs [output file, default dist/version.json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'version.json');
let sha = null;
try {
  const text = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (/^[0-9a-f]{4,40}$/.test(text)) sha = text;
} catch {
  // no git, or not a checkout: the version stays unknown
}
if (sha === null) {
  rmSync(out, { force: true });
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ version: sha })}\n`);
}
