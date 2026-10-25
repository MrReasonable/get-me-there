import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontsConfFile } from './paths.js';

/**
 * Linux fonts (spec §2 "Method"; brief WP17 §0). The worker keeps `os: 'macos'` on Linux as on macOS, but each bundled
 * `fontconfig/<os>/fonts.conf` names its fonts relative to the process's working directory (`<dir prefix="cwd">`), and
 * camoufox-js 0.11.5 points FONTCONFIG_PATH at `fontconfig/mac`, which the bundle does not have. So the worker writes
 * its own `<workerData>/fonts.conf`, outside the bundle, from the bundle's `fontconfig/macos/fonts.conf` with every
 * working-directory `<dir>` naming the bundle's `fonts/macos` by absolute path, and passes it as FONTCONFIG_FILE (the
 * launch's `env` is spread after camoufox-js's own variables, so it takes effect).
 */
const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** The bundle's fonts.conf text with each `<dir prefix="cwd">…</dir>` naming `<bundle>/fonts/macos`. Pure. */
export function absoluteFontsConf(text: string, bundleDir: string): string {
  const fonts = escapeXml(join(bundleDir, 'fonts', 'macos'));
  return text.replace(/<dir\s+prefix="cwd"\s*>[^<]*<\/dir>/g, `<dir>${fonts}</dir>`);
}

/** Writes `<workerData>/fonts.conf` (0600, through a temporary file) and returns its path. */
export function writeFontsConf(dataDir: string, bundleDir: string): string {
  const src = readFileSync(join(bundleDir, 'fontconfig', 'macos', 'fonts.conf'), 'utf8');
  const file = fontsConfFile(dataDir);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, absoluteFontsConf(src, bundleDir), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return file;
}
