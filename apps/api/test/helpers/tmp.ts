// Temporary directories that are removed after every test (ts-017). The directories and their removal live in
// ../support/tempdirs.ts (a setup file, which also guards against anything left behind); this adds the API's helpers.
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { tempDir } from '../support/tempdirs.js';

export { fileTempDir, tempDir } from '../support/tempdirs.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** `<tmp>/packages/providers/fixtures/recorded`, the shape the recorder requires (spec §5.5). */
export function tempRecordedRoot(): { repo: string; root: string } {
  const repo = tempDir('gmt-rec-');
  const root = join(repo, 'packages', 'providers', 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return { repo, root };
}

/** Runs `fn` after the test (database handles, stubs). */
export function onCleanup(fn: () => void): void {
  cleanups.push(fn);
}

/** Every file under `dir` (recordings, raw bodies and allowlists alike), sorted. */
export function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}
