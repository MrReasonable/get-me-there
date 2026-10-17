import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// why: review code-architect M4 — the image build guard checked only the root entries, while apps/api also loads
// subpath exports (@gmt/providers/fixture on the boot path) that carry their own @gmt/source/default pair.
const REPO = join(import.meta.dirname, '..');

/** @param {string} dir @returns {string[]} */
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('scripts/assert-dist-resolution.mjs', () => {
  it('checks every @gmt specifier apps/api/src imports, subpaths included', () => {
    const imported = new Set();
    for (const f of sources(join(REPO, 'apps', 'api', 'src')))
      for (const m of readFileSync(f, 'utf8').matchAll(/from '(@gmt\/[a-z]+(?:\/[a-z-]+)?)'/g))
        imported.add(m[1]);
    const script = readFileSync(join(REPO, 'scripts', 'assert-dist-resolution.mjs'), 'utf8');
    expect([...imported].filter((n) => !script.includes(`'${n}'`))).toEqual([]);
  });

  it('passes on a built checkout', () => {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'ensure-build.mjs')], {
      cwd: REPO,
      stdio: 'ignore',
    });
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'assert-dist-resolution.mjs')], {
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe('workspace packages resolve to dist\n');
  }, 600_000);
});
