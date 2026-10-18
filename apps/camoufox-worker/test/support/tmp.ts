// Temporary directories for the worker's tests: each a fresh 0700 directory under the OS temp root, removed after the
// run. Synthetic content only; nothing here is copied from a recording.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A fresh, empty directory with mode 0700 (the worker's data directory rule). */
export function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gmt-cfw-'));
  chmodSync(d, 0o700);
  return d;
}

/** Writes `content` to `dir/name` with `mode` and returns the path. */
export function writeFile(dir: string, name: string, content: string, mode = 0o600): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  chmodSync(p, mode);
  return p;
}

/**
 * A fake camoufox-js install home: `<home>/Library/Caches/camoufox/browsers/official/<id>/` holding a bundle with
 * `Camoufox.app/Contents/{MacOS/camoufox,Resources/properties.json}` and the bundle's own `version.json`.
 */
export function fakeInstall(
  bundleVersion: Record<string, unknown>,
  o: { id?: string; home?: string } = {},
): { home: string; installDir: string; bundleDir: string; app: string } {
  const home = o.home ?? tmpDir();
  const installDir = join(home, 'Library', 'Caches', 'camoufox');
  const bundleDir = join(installDir, 'browsers', 'official', o.id ?? '152.0.4-beta.28-8b7680a6');
  const app = join(bundleDir, 'Camoufox.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'MacOS', 'camoufox'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(app, 'Contents', 'Resources', 'properties.json'), '[]');
  writeFileSync(join(bundleDir, 'version.json'), JSON.stringify(bundleVersion));
  return { home, installDir, bundleDir, app };
}
