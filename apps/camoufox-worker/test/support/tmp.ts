// Temporary directories for the worker's tests: each a fresh 0700 directory under the OS temp root, removed after the
// test that made it (./tempdirs.ts, a setup file, also fails a file that leaves anything behind). Synthetic content
// only; nothing here is copied from a recording.
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleDirName, CAMOUFOX_BUILDS, type OsArch } from '@gmt/core';
import { fileTempDir, tempDir } from './tempdirs.js';

/** A fresh, empty directory with mode 0700 (the worker's data directory rule). */
export function tmpDir(): string {
  const d = tempDir('gmt-cfw-');
  chmodSync(d, 0o700);
  return d;
}

/** As `tmpDir`, but removed after the last test of the file: for a directory made in `beforeAll` or while the file loads. */
export function fileTmpDir(): string {
  const d = fileTempDir('gmt-cfw-');
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
 * A fake install as `gmt setup` lays it out (WP17 Task 17.1) under `<home>/.local/share/get-me-there/camoufox`, for
 * `osArch`'s pinned entry: on macOS the bundle `browsers/official/<build>-<hex>/Camoufox.app/…` with its own
 * `version.json`, the root's `Camoufox.app` symlink and `{ version, release }` `version.json`; on Linux the flat bundle
 * (`version.json`, `camoufox-bin`, `properties.json`, `fontconfig/macos/fonts.conf`, `fonts/macos/`), which is the
 * install directory itself. Synthetic files only.
 */
export function fakeInstall(
  osArch: OsArch = 'darwin-arm64',
  o: {
    home?: string;
    bundleVersion?: Record<string, unknown>;
    /** The root's top-level version.json (macOS); null leaves it out. */
    top?: Record<string, unknown> | null;
    /** The bundle directory's name, when not the pinned entry's. */
    id?: string;
    /** macOS: false leaves the root's Camoufox.app link out. */
    link?: boolean;
  } = {},
): { home: string; root: string; installDir: string; bundleDir: string } {
  const home = o.home ?? tmpDir();
  const entry = CAMOUFOX_BUILDS[osArch];
  const root = join(home, '.local', 'share', 'get-me-there', 'camoufox');
  const bundleDir = join(root, 'browsers', 'official', o.id ?? bundleDirName(entry));
  const version = o.bundleVersion ?? {
    version: '152.0.4',
    build: 'beta.28',
    release: 'beta.28',
    sha256: entry.sha256,
  };
  if (osArch.startsWith('linux-')) {
    mkdirSync(join(bundleDir, 'fontconfig', 'macos'), { recursive: true });
    mkdirSync(join(bundleDir, 'fonts', 'macos'), { recursive: true });
    writeFileSync(join(bundleDir, 'camoufox-bin'), 'ELF', { mode: 0o755 });
    writeFileSync(join(bundleDir, 'properties.json'), '[]');
    writeFileSync(
      join(bundleDir, 'fontconfig', 'macos', 'fonts.conf'),
      '<?xml version="1.0"?>\n<fontconfig>\n  <dir prefix="cwd">fonts/macos</dir>\n  <cachedir>~/.cache</cachedir>\n</fontconfig>\n',
    );
    writeFileSync(join(bundleDir, 'fonts', 'macos', 'Synthetic.ttf'), 'font');
    writeFileSync(join(bundleDir, 'version.json'), JSON.stringify(version));
    return { home, root, installDir: bundleDir, bundleDir };
  }
  const app = join(bundleDir, 'Camoufox.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'MacOS', 'camoufox'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(app, 'Contents', 'Resources', 'properties.json'), '[]');
  writeFileSync(join(bundleDir, 'version.json'), JSON.stringify(version));
  if (o.link !== false) symlinkSync(app, join(root, 'Camoufox.app'));
  const top = o.top === undefined ? { version: '152.0.4', release: 'beta.28' } : o.top;
  if (top !== null) writeFileSync(join(root, 'version.json'), JSON.stringify(top));
  return { home, root, installDir: root, bundleDir };
}
