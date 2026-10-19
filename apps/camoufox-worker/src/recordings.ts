/**
 * The recordings' backup and restore (2026-10-18). Recordings are local-only and gitignored (decision 61), so they live
 * in whichever checkout or worktree made them, and removing a worktree would delete them. `recordings:backup` copies
 * `fixtures/recorded/` (never a `.gitkeep`, never through a link) into
 * `~/.local/share/get-me-there/private/fixtures/camoufox-<YYYY-MM-DD>/`; `recordings:restore [YYYY-MM-DD]` copies a backup
 * (the latest by default) back into a tree that holds no recording yet. Directories are 0700 and files 0600 on both
 * sides. It loads no page and reads no worker setting, so it runs without `worker.env`.
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EX_CONFIG, EX_SOFTWARE } from './run.js';

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const KEEP = '.gitkeep';

/** The private backup directory for `day`. */
export function backupDir(home: string, day: string): string {
  return join(home, '.local', 'share', 'get-me-there', 'private', 'fixtures', `camoufox-${day}`);
}

/** Every regular file under `root` but `.gitkeep`, as paths relative to it; links are never followed. */
function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const st = lstatSync(join(dir, name));
      if (st.isDirectory()) walk(join(dir, name), join(rel, name));
      else if (st.isFile() && name !== KEEP) out.push(join(rel, name));
    }
  };
  if (existsSync(root)) walk(root, '');
  return out;
}

/** Copies `files` from `from` to `to`, making each directory 0700 (`to` included) and each file 0600. */
function copyTree(from: string, to: string, files: readonly string[], ownRoot: boolean): number {
  for (const f of files) {
    const parts = f.split('/').slice(0, -1);
    // why: each directory on the way is made and tightened, so a directory made before (or by umask) is 0700 too;
    // a restore leaves the checkout's own tracked root as it is
    if (ownRoot) {
      mkdirSync(to, { recursive: true, mode: DIR_MODE });
      chmodSync(to, DIR_MODE);
    }
    let dir = to;
    for (const p of parts) {
      dir = join(dir, p);
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      chmodSync(dir, DIR_MODE);
    }
    copyFileSync(join(from, f), join(to, f));
    chmodSync(join(to, f), FILE_MODE);
  }
  return files.length;
}

/** Backs `root` up into `dest`, adding to what is there; returns the number of files copied. */
export function backupRecordings(root: string, dest: string): number {
  return copyTree(root, dest, filesUnder(root), true);
}

/** Restores the backup `src` into `root`, which must hold no recording yet; returns the number of files copied. */
export function restoreRecordings(src: string, root: string): number {
  if (!existsSync(src)) throw new Error(`no backup at ${src}`);
  if (filesUnder(root).length > 0)
    throw new Error(`${root} is not empty: restore only into a tree that holds no recording yet`);
  return copyTree(src, root, filesUnder(src), false);
}

/** The local calendar date of `d`, YYYY-MM-DD (the backup's name is the operator's day, not UTC's). */
export function localDay(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface RecordingsDeps {
  home: string;
  root: string;
  /** Today's date, YYYY-MM-DD (the backup's name). */
  today: string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** `backup`, or `restore [YYYY-MM-DD]`; resolves to the exit code. */
export function recordingsMain(argv: readonly string[], deps: RecordingsDeps): number {
  const [command, day] = argv;
  try {
    if (command === 'backup' && day === undefined) {
      const dest = backupDir(deps.home, deps.today);
      const files = filesUnder(deps.root);
      if (files.length === 0) {
        deps.out('no recordings to back up');
        return 0;
      }
      deps.out(`backed up ${backupRecordings(deps.root, dest)} files to ${dest}`);
      return 0;
    }
    if (command === 'restore' && (day === undefined || /^\d{4}-\d{2}-\d{2}$/.test(day))) {
      const parent = join(backupDir(deps.home, deps.today), '..');
      const latest = existsSync(parent)
        ? readdirSync(parent)
            .filter((n) => /^camoufox-\d{4}-\d{2}-\d{2}$/.test(n))
            .sort()
            .at(-1)
        : undefined;
      const name = day === undefined ? latest : `camoufox-${day}`;
      if (name === undefined) throw new Error(`no backup under ${parent}`);
      const src = join(parent, name);
      deps.out(`restored ${restoreRecordings(src, deps.root)} files from ${src}`);
      return 0;
    }
    deps.err('usage: recordings backup | recordings restore [YYYY-MM-DD]');
    return EX_CONFIG;
  } catch (e) {
    deps.err(e instanceof Error ? e.message : String(e));
    return EX_SOFTWARE;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = recordingsMain(process.argv.slice(2), {
    home: homedir(),
    root: fileURLToPath(new URL('../fixtures/recorded/', import.meta.url)),
    today: localDay(new Date()),
    out: (l) => process.stdout.write(`${l}\n`),
    err: (l) => process.stderr.write(`${l}\n`),
  });
