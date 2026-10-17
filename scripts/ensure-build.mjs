#!/usr/bin/env node
// Builds @gmt/api and its workspace dependencies once, under a cross-process lock, and skips the build when no source
// file is newer than the last one. The CLI tests (scripts/backup.test.mjs, apps/api/test/deploy/backupCli.test.ts) call
// this instead of building themselves, so two test processes never run tsc over the same dist at once (review
// code-architect M5). Development and CI only; the image does not carry this script.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const STAMP = join(REPO, 'node_modules', '.gmt-build-stamp');
// why: keyed by checkout, so the main checkout and a worktree never wait on each other.
const LOCK = join(tmpdir(), `gmt-build-${Buffer.from(REPO).toString('hex').slice(-24)}.lock`);
const STALE_LOCK_MS = 15 * 60_000;
const WAIT_MS = 10 * 60_000;

/** Newest mtime under the build inputs: every src folder and tsconfig the api build compiles. */
function newestInput() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, statSync(p).mtimeMs);
    }
  };
  for (const pkg of ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api']) {
    const root = join(REPO, pkg);
    if (existsSync(join(root, 'src'))) walk(join(root, 'src'));
    for (const f of readdirSync(root))
      if (/^(tsconfig.*\.json|package\.json)$/.test(f))
        newest = Math.max(newest, statSync(join(root, f)).mtimeMs);
  }
  return newest;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function acquire() {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(LOCK);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - statSync(LOCK).mtimeMs > STALE_LOCK_MS) rmSync(LOCK, { recursive: true, force: true });
      else if (Date.now() > until) throw new Error(`ensure-build: gave up waiting for ${LOCK}`);
      else sleep(250);
    }
  }
}

acquire();
try {
  const built = ['packages/core', 'packages/db', 'packages/providers', 'packages/engine', 'apps/api'].every(
    (p) => existsSync(join(REPO, p, 'dist')),
  );
  if (built && existsSync(STAMP) && statSync(STAMP).mtimeMs >= newestInput()) {
    console.log('build up to date');
  } else {
    execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
    writeFileSync(STAMP, '');
    utimesSync(STAMP, new Date(), new Date());
    console.log('built');
  }
} finally {
  rmSync(LOCK, { recursive: true, force: true });
}
