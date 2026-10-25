/**
 * The build's version for the Status report: the git short SHA `scripts/write-api-version.mjs` writes to
 * `dist/version.json` at build time. Missing, unreadable or malformed gives "unknown" (a source run, or an image built
 * without git); the file's text is never shown except as a short SHA.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const versionFileSchema = z.strictObject({ version: z.string().regex(/^[0-9a-f]{4,40}$/) });

/** `dist/bootstrap/version.js` sits one level below `dist/version.json`; a tsx run finds no file there. */
export function readVersion(
  path: string = fileURLToPath(new URL('../version.json', import.meta.url)),
): string {
  try {
    const r = versionFileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return r.success ? r.data.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
