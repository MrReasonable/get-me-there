/**
 * Path containment for the tools' write targets (sec minor 1): both sides compared as true-case real paths, so a
 * symlinked or differently cased path on a case-insensitive file system (macOS APFS) cannot slip past the check. Used by
 * the record tool's `--out` rule and the smoke's fixture target (WP13).
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/** The true-case real path of `p`, or of its nearest existing ancestor with the rest appended (a directory not made yet). */
export function realOrAncestor(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync.native(abs);
  const up = dirname(abs);
  return up === abs ? abs : join(realOrAncestor(up), abs.slice(up.length + 1));
}

/** Whether `p` is `root` or lies under it, both resolved by `realOrAncestor`. */
export function isInside(p: string, root: string): boolean {
  const a = realOrAncestor(p);
  const b = realOrAncestor(root);
  return a === b || a.startsWith(`${b}${sep}`);
}
