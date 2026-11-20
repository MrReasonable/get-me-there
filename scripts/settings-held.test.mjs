import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { tempDir } from './test-tempdirs.mjs';

// why: review I2 (controller ruling R20): `gmt setup` must know whether the app holds its settings with the app stopped,
// and may not import @gmt/db, so it runs this thin wrapper over storedSettingCount as a child (decision 72).
const REPO = fileURLToPath(new URL('../', import.meta.url));
const Database = createRequire(join(REPO, 'packages', 'db', 'package.json'))('better-sqlite3');
beforeAll(() => {
  execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
    cwd: REPO,
    stdio: 'ignore',
    timeout: 1_200_000,
  });
}, 1_200_000);
const run = (args) =>
  spawnSync(process.execPath, [join(REPO, 'scripts', 'settings-held.mjs'), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
  });
function db(rows) {
  const path = join(tempDir('gmt-held-'), 'app.db');
  const h = new Database(path);
  if (rows !== null) {
    h.exec('CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const put = h.prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)');
    for (const [name, value] of rows) put.run(name, value, '2026-11-20T00:00:00.000Z');
  }
  h.close();
  return path;
}

describe('scripts/settings-held.mjs', { timeout: 60_000 }, () => {
  it('prints the rows the settings table holds, never a name or value; none without the table', () => {
    const held = run([db([['TRAVELPAYOUTS_TOKEN', 'tp-token-secret-0123']])]);
    expect(held.status).toBe(0);
    expect(JSON.parse(held.stdout)).toEqual({ rows: 1 });
    expect(held.stdout).not.toContain('secret');
    expect(JSON.parse(run([db([])]).stdout)).toEqual({ rows: 0 });
    expect(JSON.parse(run([db(null)]).stdout)).toEqual({ rows: 0 });
  });
  it('a missing argument is usage (64)', () => {
    expect(run([]).status).toBe(64);
  });
  it('a file it cannot read is a plain failure (1), its stdout empty: never a count', () => {
    const bad = join(tempDir('gmt-held-'), 'bad.db');
    writeFileSync(bad, 'not a database '.repeat(200));
    const r = run([bad]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('settings-held failed');
  });
});
