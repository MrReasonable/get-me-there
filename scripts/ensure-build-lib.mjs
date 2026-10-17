// The logic of scripts/ensure-build.mjs, with its file-system and clock operations injectable for tests.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const PACKAGES = ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api'];
const STALE_LOCK_MS = 15 * 60_000;
const WAIT_MS = 10 * 60_000;

const real = {
  mkdir: (p) => mkdirSync(p),
  stat: (p) => statSync(p),
  rm: (p) => rmSync(p, { recursive: true, force: true }),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  now: () => Date.now(),
};

/** Takes the cross-process lock (a directory), waiting for a holder and clearing a stale one. */
export function acquire(lock, ops = real) {
  const until = ops.now() + WAIT_MS;
  for (;;) {
    try {
      ops.mkdir(lock);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let age;
    try {
      age = ops.now() - ops.stat(lock).mtimeMs;
    } catch (err) {
      // why: re-review N1 — the holder can release between our failed mkdir and this stat; the lock is free, retry.
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    if (age > STALE_LOCK_MS) ops.rm(lock);
    else if (ops.now() > until) throw new Error(`ensure-build: gave up waiting for ${lock}`);
    else ops.sleep(250);
  }
}

/** Newest mtime among the build inputs: each package's src, tsconfigs and package.json, and the root's config. */
export function newestInput(repo) {
  let newest = 0;
  const touch = (p) => {
    newest = Math.max(newest, statSync(p).mtimeMs);
  };
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else touch(join(dir, e.name));
    }
  };
  for (const pkg of PACKAGES) {
    const root = join(repo, pkg);
    if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
    for (const f of readdirSync(root)) if (/^(tsconfig.*\.json|package\.json)$/.test(f)) touch(join(root, f));
  }
  // why: re-review N2 — root config (shared tsconfig base, dependency versions) changes the build as well.
  for (const f of readdirSync(repo))
    if (/^(tsconfig.*\.json|package\.json|pnpm-lock\.yaml)$/.test(f)) touch(join(repo, f));
  return newest;
}

/** True unless every package is built and the stamp is at least as new as every input. */
export function needsBuild(repo, stamp) {
  if (!PACKAGES.every((p) => existsSync(join(repo, p, 'dist')))) return true;
  return !existsSync(stamp) || statSync(stamp).mtimeMs < newestInput(repo);
}
