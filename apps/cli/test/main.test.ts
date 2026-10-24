import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '..', '..', '..');

// why: decision 72: the root `gmt` script runs the CLI from source with tsx, which must resolve from the repository
// root (not `pnpm --filter`, which would change the working directory). ruling 11: a child process gets 60 s.
describe('pnpm gmt from the repository root', { timeout: 60_000 }, () => {
  it('pnpm gmt --help exits 0 and lists the commands', () => {
    const r = spawnSync('pnpm', ['--silent', 'gmt', '--help'], {
      cwd: REPO,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('usage: pnpm gmt <command>');
    for (const c of ['setup', 'status', 'smoke', 'update', 'uninstall']) expect(r.stdout).toContain(`  ${c}`);
  });

  it('an unknown command exits 64 with the usage', () => {
    const r = spawnSync('pnpm', ['--silent', 'gmt', 'frobnicate'], {
      cwd: REPO,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('unknown command: frobnicate');
  });
});
