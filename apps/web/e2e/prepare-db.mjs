#!/usr/bin/env node
// Prepares a fresh database for the fixture-mode smoke. Spec §5.5: fixture mode needs a path ending in .fixture.db,
// and the api realpath-resolves it at boot, so the directory must exist first. Run by the api webServer command.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const path = process.env.DATABASE_PATH;
if (!path?.endsWith('.fixture.db')) {
  console.error('prepare-db: DATABASE_PATH must be set and end in .fixture.db');
  process.exit(1);
}
mkdirSync(dirname(path), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
