#!/usr/bin/env node
// Builds @gmt/api and its workspace dependencies once, under a cross-process lock, and skips the build when no input
// is newer than the last one. The CLI tests (scripts/backup.test.mjs, apps/api/test/deploy/backupCli.test.ts) call
// this instead of building themselves, so two test processes never run tsc over the same dist at once (review
// code-architect M5). Development and CI only; the image does not carry this script. Logic: ensure-build-lib.mjs.
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lockPathFor, needsBuild, underLock } from './ensure-build-lib.mjs';

const REPO = join(import.meta.dirname, '..');
const STAMP = join(REPO, 'node_modules', '.gmt-build-stamp');
const LOCK = lockPathFor(REPO);

// why: the lock records this process as its owner. The build is a spawned child, so the event loop stays free: the
// lock is released on success, on failure and on SIGINT, SIGTERM or SIGHUP (which also stop the build), and a SIGKILL
// leaves a lock whose dead pid the next run takes over at once (ensure-build-lib.mjs).
await underLock(LOCK, async (run) => {
  if (needsBuild(REPO, STAMP)) {
    await run('pnpm', ['--filter', '@gmt/api...', 'build'], { cwd: REPO, stdio: 'ignore' });
    writeFileSync(STAMP, '');
    utimesSync(STAMP, new Date(), new Date());
    console.log('built');
  } else {
    console.log('build up to date');
  }
});
