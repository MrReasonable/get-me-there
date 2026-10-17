#!/usr/bin/env node
// Builds @gmt/api and its workspace dependencies once, under a cross-process lock, and skips the build when no input
// is newer than the last one. The CLI tests (scripts/backup.test.mjs, apps/api/test/deploy/backupCli.test.ts) call
// this instead of building themselves, so two test processes never run tsc over the same dist at once (review
// code-architect M5). Development and CI only; the image does not carry this script. Logic: ensure-build-lib.mjs.
import { execFileSync } from 'node:child_process';
import { utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquire, needsBuild, release, releaseOnSignal } from './ensure-build-lib.mjs';

const REPO = join(import.meta.dirname, '..');
const STAMP = join(REPO, 'node_modules', '.gmt-build-stamp');
// why: keyed by checkout, so the main checkout and a worktree never wait on each other.
const LOCK = join(tmpdir(), `gmt-build-${Buffer.from(REPO).toString('hex').slice(-24)}.lock`);

// why: the lock records this process as its owner; it is released on success, on failure and on SIGINT, SIGTERM or
// SIGHUP, and a SIGKILL leaves a lock whose dead pid the next run takes over at once (ensure-build-lib.mjs).
const owned = acquire(LOCK);
const stopWatching = releaseOnSignal(LOCK, owned);
try {
  if (needsBuild(REPO, STAMP)) {
    execFileSync('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
    writeFileSync(STAMP, '');
    utimesSync(STAMP, new Date(), new Date());
    console.log('built');
  } else {
    console.log('build up to date');
  }
} finally {
  release(LOCK, owned);
  stopWatching();
}
