// Temporary directories that are removed after every test (ts-017).
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const made: string[] = [];
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
  for (const dir of made.splice(0)) {
    chmodSync(dir, 0o700); // why: a test may have made it read-only
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh directory under the OS temp dir, removed after the test. */
export function tempDir(prefix = 'gmt-api-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

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
