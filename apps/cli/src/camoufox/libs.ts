import { dirname, join } from 'node:path/posix';
import type { Files } from '../exec/files.js';
import type { Runner } from '../exec/runner.js';

/**
 * The host checks the browser provider needs (spec §2 "Method", §13 prerequisites; brief WP17 §0). `unzip` unpacks the
 * archive on both systems. On Linux, Firefox's executable is a stub that loads `libxul.so` at run time, so the GTK,
 * X11, ALSA and D-Bus libraries are `libxul.so`'s: `ldd` runs over `camoufox-bin` and every `.so` in the bundle, as
 * playwright-core's own host check does, and any `not found` names the missing sonames with the install line.
 */

/** playwright-core 1.59.1's Firefox list for Ubuntu 24.04 (research 17.0b, 2026-10-19). */
export const UBUNTU_LIBRARIES = [
  'libasound2t64',
  'libatk1.0-0t64',
  'libavcodec60',
  'libcairo-gobject2',
  'libcairo2',
  'libdbus-1-3',
  'libfontconfig1',
  'libfreetype6',
  'libgdk-pixbuf-2.0-0',
  'libglib2.0-0t64',
  'libgtk-3-0t64',
  'libpango-1.0-0',
  'libpangocairo-1.0-0',
  'libx11-6',
  'libx11-xcb1',
  'libxcb-shm0',
  'libxcb1',
  'libxcomposite1',
  'libxcursor1',
  'libxdamage1',
  'libxext6',
  'libxfixes3',
  'libxi6',
  'libxrandr2',
  'libxrender1',
] as const;
/** What Debian 12 adds to that list. */
export const DEBIAN_EXTRA = ['libdbus-glib-1-2', 'libharfbuzz0b', 'libxtst6'] as const;
export const APT_LINE = `sudo apt-get install ${UBUNTU_LIBRARIES.join(' ')}`;
export const UNZIP_LINE = {
  linux: 'sudo apt-get install unzip (or your distribution’s unzip package)',
  darwin: 'macOS ships unzip in /usr/bin; restore it with xcode-select --install',
} as const;

/** The sonames `ldd`'s outputs report as `not found`, each once, sorted. */
export function missingSonames(outputs: readonly string[]): string[] {
  const missing = new Set<string>();
  for (const out of outputs)
    for (const line of out.split('\n')) {
      const m = /^\s*(\S+)\s+=>\s+not found\s*$/.exec(line);
      if (m?.[1] !== undefined) missing.add(m[1]);
    }
  return [...missing].sort();
}

/** `camoufox-bin` and every `.so` under the bundle, `libxul.so` included (subdirectories too), sorted. */
export function linkedFiles(files: Files, bundle: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of files.list(dir) ?? []) {
      const p = join(dir, name);
      if (files.isSymlink(p)) continue;
      if (files.isDir(p)) walk(p);
      else if (name === 'camoufox-bin' || /\.so(\.\d+)*$/.test(name)) out.push(p);
    }
  };
  walk(bundle);
  return out.sort();
}

/**
 * Linux: null when every library `ldd` reads is found, else the refusal naming the missing ones and the install line.
 * `env` is the environment children run with (PATH above all); LD_LIBRARY_PATH is added to it, never taken from it.
 */
export async function libraryProblem(
  run: Runner,
  files: Files,
  bundle: string,
  env: Readonly<Record<string, string>>,
): Promise<string | null> {
  const targets = linkedFiles(files, bundle);
  if (!targets.includes(join(bundle, 'camoufox-bin')))
    return `${bundle} has no camoufox-bin to check; move it aside, then run pnpm gmt browser install`;
  // why: W4 (pie-b1-001): libxul.so links libmozgtk.so and its siblings, which only the bundle holds
  const libDirs = [
    ...new Set(targets.filter((t) => t !== join(bundle, 'camoufox-bin')).map((t) => dirname(t))),
  ];
  const lddEnv = { ...env, LD_LIBRARY_PATH: [bundle, ...libDirs.filter((d) => d !== bundle)].join(':') };
  const outputs: string[] = [];
  for (const t of targets) {
    const r = await run(['ldd', t], { cwd: bundle, timeoutMs: 30_000, env: lddEnv });
    if (r.code === 127)
      return 'ldd is not installed, so Firefox’s libraries cannot be checked: sudo apt-get install libc-bin';
    outputs.push(r.stdout);
  }
  const missing = missingSonames(outputs);
  if (missing.length === 0) return null;
  return `Firefox’s libraries are missing on this machine (${missing.join(', ')}). On Ubuntu 24.04 install them with: ${APT_LINE} (Debian 12 also needs ${DEBIAN_EXTRA.join(' ')}), then run pnpm gmt browser install`;
}

/** Null when `unzip` runs, else its install line for this system. */
export async function unzipProblem(run: Runner, os: 'darwin' | 'linux'): Promise<string | null> {
  const r = await run(['unzip', '-v'], { cwd: '/', timeoutMs: 15_000 });
  return r.code === 127
    ? `unzip is not installed, and the browser provider needs it: ${UNZIP_LINE[os]}`
    : null;
}
