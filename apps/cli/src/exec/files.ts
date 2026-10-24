import { accessSync, constants, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * The synchronous file reads a planner makes before planning (existing settings files and their modes, what is already
 * in a directory). Writes happen only through an `Executor`. `memoryFiles` (exec/memory.ts) and `systemFiles` are the
 * two implementations, so a planner is a pure function of what they report.
 */
export interface Files {
  /** A regular file's text (symlinks followed), or null when there is none. */
  read(path: string): string | null;
  /** The permission bits of a file or directory (symlinks followed), or null when absent. */
  mode(path: string): number | null;
  /** The owner's user id (symlinks followed), or null when absent. */
  owner(path: string): number | null;
  /** The size in bytes of a regular file, or null. */
  size(path: string): number | null;
  isDir(path: string): boolean;
  /** Whether the path itself is a symbolic link (not followed). */
  isSymlink(path: string): boolean;
  /** A directory's entry names, sorted, or null when it is no directory. */
  list(dir: string): string[] | null;
  /** Whether this user may write to the path (create entries in a directory). */
  writable(path: string): boolean;
}

const safe = <T>(f: () => T, fallback: T): T => {
  try {
    return f();
  } catch {
    return fallback;
  }
};

export const systemFiles: Files = {
  read: (p) => safe(() => (statSync(p).isFile() ? readFileSync(p, 'utf8') : null), null),
  mode: (p) => safe(() => statSync(p).mode & 0o777, null),
  owner: (p) => safe(() => statSync(p).uid, null),
  size: (p) => safe(() => (statSync(p).isFile() ? statSync(p).size : null), null),
  isDir: (p) => safe(() => statSync(p).isDirectory(), false),
  isSymlink: (p) => safe(() => lstatSync(p).isSymbolicLink(), false),
  list: (d) => safe(() => (statSync(d).isDirectory() ? readdirSync(d).sort() : null), null),
  writable: (p) =>
    safe(() => {
      accessSync(p, constants.W_OK);
      return true;
    }, false),
};
