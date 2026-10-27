import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from './test-tempdirs.mjs';

// why: decision 49 keeps tests of root scripts beside them. The sentinel tests in apps/api/test/security prove what the
// scan finds; these pin what it may skip: only a fixture root that is absent (spec §5.3). Any other error while
// walking an existing root fails the scan, so an unreadable or broken tree never prints "clean" (CodeRabbit batch 3).
const SCRIPT = resolve(import.meta.dirname, 'secret-scan.mjs');
const ROOT = 'packages/providers/fixtures';
function repo() {
  const d = tempDir('gmt-secret-scan-');
  return d;
}
// why: an empty environment, so no secret a developer's shell holds reaches the scan and the cases stay deterministic;
// node is started by its absolute path, so the child needs no PATH and the test reads no environment (PR #3 review)
const scan = (/** @type {string} */ cwd) =>
  spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {},
  });

// why: ruling 11: each case spawns node; 60 s survives a loaded runner.
describe('scripts/secret-scan.mjs skips only an absent root', { timeout: 60_000 }, () => {
  it('an absent fixture root is skipped and the scan passes', () => {
    const r = scan(repo());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secret scan: clean');
  });

  it('a clean existing root passes', () => {
    const d = repo();
    mkdirSync(join(d, ROOT, 'a'), { recursive: true });
    writeFileSync(join(d, ROOT, 'a', 'x.json'), '{"ok":true}');
    expect(scan(d).status).toBe(0);
  });

  it('a dangling symlink inside the root fails the scan instead of skipping the root', () => {
    const d = repo();
    mkdirSync(join(d, ROOT), { recursive: true });
    writeFileSync(join(d, ROOT, 'leak.txt'), 'nothing here');
    symlinkSync(join(d, 'missing-target'), join(d, ROOT, 'broken'));
    const r = scan(d);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('secret scan: clean');
  });

  it('a root that is itself a dangling symlink is not absent, so it fails', () => {
    const d = repo();
    mkdirSync(join(d, 'packages/providers'), { recursive: true });
    symlinkSync(join(d, 'missing-target'), join(d, ROOT));
    const r = scan(d);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('secret scan: clean');
  });

  // why: root ignores permission bits, so the case means nothing when the suite runs as root
  it.skipIf(process.getuid?.() === 0)('an unreadable directory inside the root fails the scan', () => {
    const d = repo();
    mkdirSync(join(d, ROOT, 'locked'), { recursive: true });
    writeFileSync(join(d, ROOT, 'locked', 'x.json'), '{}');
    chmodSync(join(d, ROOT, 'locked'), 0o000);
    const r = scan(d);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('secret scan: clean');
  });
});
