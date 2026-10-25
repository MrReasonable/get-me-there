// Writes dist/version.json ({ "version": "<git short SHA>" }) after the TypeScript build, for the Status report. An
// image or checkout without git leaves "unknown" (no file), which the app reads as such.
// Usage: node scripts/write-version.mjs [output file, default dist/version.json]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'version.json');
let sha = null;
// why: WP18 (V0): an image build has no git; compose passes the checkout's short SHA as APP_VERSION
const given = process.env.APP_VERSION ?? '';
if (/^[0-9a-f]{4,40}$/.test(given)) sha = given;
else {
  try {
    const text = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{4,40}$/.test(text)) sha = text;
  } catch {
    // no git, or not a checkout: the version stays unknown
  }
}
if (sha === null) {
  rmSync(out, { force: true });
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ version: sha })}\n`);
}
