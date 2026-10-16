import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// why: decision 49 keeps tests of root scripts beside them, run by the root Vitest project `scripts`.
// The cast check is the project's one enforcement of "no `as` except `as const`" (decision 45); this pins what it
// catches and what it lets through, and that it never passes on an empty file list
const REPO = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = join(REPO, 'scripts', 'check-casts.mjs');
/** @type {string[]} */
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * @param {Record<string, string>} files
 * @param {string} [cwd]
 */
function check(files, cwd = REPO) {
  const dir = mkdtempSync(join(tmpdir(), 'casts-'));
  dirs.push(dir);
  const paths = Object.entries(files).map(([name, text]) => {
    const p = join(dir, name);
    writeFileSync(p, text);
    return p;
  });
  return spawnSync(process.execPath, [SCRIPT, ...paths], { cwd, encoding: 'utf8', timeout: 60_000 });
}

describe('scripts/check-casts.mjs', () => {
  it('fails on `as string`, `<number>x` and `as readonly string[]`, naming each line', () => {
    const r = check({
      'a.ts':
        'const y: unknown = 1;\nexport const a = y as string;\nexport const b = <number>y;\nexport const c = y as readonly string[];\n',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('a.ts:2: y as string');
    expect(r.stderr).toContain('a.ts:3: <number>y');
    expect(r.stderr).toContain('a.ts:4: y as readonly string[]');
  });
  it('passes `as const`, `satisfies`, renamed imports and exports, and prose or strings with " as "', () => {
    const r = check({
      'b.ts': [
        "import { readFileSync as read } from 'node:fs';",
        'export { read as readAgain };',
        "export const k = ['a'] as const;",
        'export const s = { n: 1 } satisfies { n: number };',
        '// treated as unverified, as Foo would be',
        "export const t = 'x as Foo';",
        'export const u = `y as Foo`;',
      ].join('\n'),
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
  it('checks .tsx with the JSX parser', () => {
    const r = check({ 'c.tsx': 'const v: unknown = 1;\nexport const el = <div>{v as string}</div>;\n' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('c.tsx:2: v as string');
  });
  it('refuses an empty file list instead of passing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'casts-empty-'));
    dirs.push(dir);
    // why: outside a git work tree with no files given, git lists nothing (or fails); either way the check must fail
    const r = spawnSync('git', ['init', '-q'], { cwd: dir });
    expect(r.status).toBe(0);
    const empty = spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('no files to scan');
  });
  it('the repository itself has no cast (the `pnpm casts` gate)', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^check-casts: [1-9][0-9]+ files, 0 casts/);
  });
});
