import { join } from 'node:path/posix';
import { type CamoufoxBuild, versionOf } from '@gmt/core';
import type { Files } from '../exec/files.js';
import { type Action, runAction } from '../plan/action.js';

/**
 * The install-directory layout camoufox-js reads, which the CLI owns (spec §2 "Method"; decision 73). On macOS the
 * install directory is the root: its `Camoufox.app` is a symlink to the pinned bundle's app, and its top-level
 * `version.json` is `{ version, release }`. On Linux the bundle directory itself is the install directory
 * (`version.json`, `camoufox-bin`, `properties.json` and `fontconfig/` directly in it), so nothing more is written.
 * The symlink is switched in one step (a new link beside it, renamed over the old one), so the worker never sees a
 * half-made layout. A real file or directory where the link belongs is refused, never replaced.
 */
export const topVersionText = (entry: Pick<CamoufoxBuild, 'build'>): string =>
  JSON.stringify(versionOf(entry));

export type LayoutPlan = { kind: 'ok'; actions: Action[] } | { kind: 'refused'; message: string };

export function planLayout(i: {
  os: 'darwin' | 'linux';
  root: string;
  bundle: string;
  entry: Pick<CamoufoxBuild, 'build'>;
  files: Files;
  /** Hex for the new link's temporary name. */
  random: string;
}): LayoutPlan {
  if (i.os === 'linux') return { kind: 'ok', actions: [] };
  const link = join(i.root, 'Camoufox.app');
  const target = join(i.bundle, 'Camoufox.app');
  const actions: Action[] = [];
  if (i.files.isSymlink(link)) {
    // why: both sides resolved, so a root reached through a symlinked parent (/var on macOS) is still the same bundle
    if (i.files.realpath(link) !== (i.files.realpath(target) ?? target)) {
      const tmp = join(i.root, `.Camoufox.app.tmp-${i.random}`);
      actions.push(runAction(['ln', '-s', target, tmp], i.root, { describe: `link ${link} to ${target}` }), {
        kind: 'rename',
        from: tmp,
        to: link,
      });
    }
  } else if (i.files.isDir(link) || i.files.size(link) !== null)
    return {
      kind: 'refused',
      message: `${link} is not a symlink to a Camoufox bundle; it is never replaced: move it aside, then run setup again`,
    };
  else actions.push(runAction(['ln', '-s', target, link], i.root, { describe: `link ${link} to ${target}` }));
  const top = join(i.root, 'version.json');
  const want = topVersionText(i.entry);
  let have: string | null;
  try {
    have = i.files.read(top);
  } catch {
    have = null;
  }
  if (have !== want)
    actions.push({ kind: 'writeFile', path: top, contents: want, mode: 0o644, secret: false });
  return { kind: 'ok', actions };
}
