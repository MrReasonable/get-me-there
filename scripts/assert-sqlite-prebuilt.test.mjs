import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// why: decision 49 — the root scripts' tests sit beside them. The image runs this script three times (spec §4, §13:
// the better-sqlite3 prebuilt is fail-closed, version pinned by the lockfile, integrity recorded in the WP12 brief).
const REPO = fileURLToPath(new URL('../', import.meta.url));

describe('scripts/assert-sqlite-prebuilt.mjs', () => {
  it('pnpm-lock.yaml pins better-sqlite3 13.0.3 to the integrity recorded in the WP12 brief', () => {
    const lock = readFileSync(join(REPO, 'pnpm-lock.yaml'), 'utf8').split('\n');
    const at = lock.findIndex((l) => l.trim() === 'better-sqlite3@13.0.3:');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lock.slice(at, at + 3).join('\n')).toContain(
      'sha512-RbOBxmLBG8uvFUc15X9+9SFemKcQ0WBuISBVkpuiaUB2qblC8UWlHEjdWVoZ8AdhSwmoEgsiXKfopX0CQxaACQ==',
    );
  });

  it('passes on this machine and names the prebuilt it loaded', () => {
    const r = spawnSync(process.execPath, ['scripts/assert-sqlite-prebuilt.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /^better-sqlite3 13\.0\.3 prebuilt ok: .*prebuilds[/\\][a-z0-9]+-[a-z0-9]+\.node\n$/,
    );
  });
});
