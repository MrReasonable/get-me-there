import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutatedFiles, shardOf } from './mutation-shard.mjs';

// The mutation workflow splits a package's Stryker `mutate` files across jobs (shards) so each job fits its limit. The
// shards must cover every mutated file exactly once, whatever the file list, so a file can never drop out of CI.
const SCRIPT = resolve(import.meta.dirname, 'mutation-shard.mjs');
const made = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A package with this Stryker `mutate` list and these files (path → byte count). */
function pkg(mutate, files) {
  const dir = mkdtempSync(join(tmpdir(), 'gmt-shard-'));
  made.push(dir);
  writeFileSync(join(dir, 'stryker.config.json'), JSON.stringify({ mutate }));
  for (const [p, size] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), 'x'.repeat(size));
  }
  return dir;
}

describe('mutatedFiles: the files a Stryker mutate list names', () => {
  it('expands globs and negations, skips generated dirs and node_modules, and sorts by path', () => {
    // why: the globs match the generated and node_modules copies too, so only the walk's skipping keeps them out
    const dir = pkg(['**/a/*.ts', 'src/b.ts', '!**/a/skip.ts'], {
      'src/a/one.ts': 3,
      'src/a/two.ts': 5,
      'src/a/skip.ts': 7,
      'src/b.ts': 1,
      'src/c.ts': 9,
      'dist/src/a/one.ts': 2,
      'node_modules/x/src/a/one.ts': 2,
    });
    expect(mutatedFiles(dir)).toEqual([
      { path: 'src/a/one.ts', size: 3 },
      { path: 'src/a/two.ts', size: 5 },
      { path: 'src/b.ts', size: 1 },
    ]);
  });
  it('fails on a list that names no file, so a shard never runs over nothing', () => {
    const dir = pkg(['src/none/*.ts'], { 'src/a.ts': 1 });
    expect(() => mutatedFiles(dir)).toThrow(/names no file/);
  });
});

describe('shardOf: one shard of the files, balanced by size', () => {
  const files = [
    { path: 'src/a.ts', size: 50 },
    { path: 'src/b.ts', size: 40 },
    { path: 'src/c.ts', size: 30 },
    { path: 'src/d.ts', size: 20 },
    { path: 'src/e.ts', size: 10 },
  ];
  it('the shards together hold every file exactly once', () => {
    for (const n of [1, 2, 3, 5]) {
      const all = Array.from({ length: n }, (_, i) => shardOf(files, i + 1, n)).flat();
      expect(all.toSorted(), `${n} shards`).toEqual(files.map((f) => f.path));
    }
  });
  it('one shard is every file', () => {
    expect(shardOf(files, 1, 1)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts']);
  });
  it('puts each file, largest first, in the lightest shard so far (the lower shard on a tie)', () => {
    // 50 → 1; 40 → 2; 30 → 2 (40 < 50); 20 → 1 (50 < 70); 10 → 1 (70 = 70, lower wins)
    expect(shardOf(files, 1, 2)).toEqual(['src/a.ts', 'src/d.ts', 'src/e.ts']);
    expect(shardOf(files, 2, 2)).toEqual(['src/b.ts', 'src/c.ts']);
  });
  it('equal sizes go by path, so the split never depends on the order the files were listed in', () => {
    const same = [
      { path: 'src/b.ts', size: 1 },
      { path: 'src/a.ts', size: 1 },
    ];
    expect(shardOf(same, 1, 2)).toEqual(['src/a.ts']);
    expect(shardOf(same, 2, 2)).toEqual(['src/b.ts']);
  });
  it.each([
    [0, 2],
    [3, 2],
    [1, 0],
    [1.5, 2],
  ])('refuses shard %s of %s', (shard, shards) => {
    expect(() => shardOf(files, shard, shards)).toThrow(/shard/);
  });
  it('refuses more shards than files, which would leave a shard with nothing to run', () => {
    expect(() => shardOf(files, 1, 6)).toThrow(/6 shards for 5 files/);
  });
});

// why: ruling 11: each case starts one short node process
describe('the command line', { timeout: 20_000 }, () => {
  it('prints the shard as the comma-separated list stryker run --mutate takes', () => {
    const dir = pkg(['src/*.ts'], { 'src/a.ts': 5, 'src/b.ts': 4, 'src/c.ts': 3 });
    const r = spawnSync(process.execPath, [SCRIPT, dir, '2', '2'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('src/b.ts,src/c.ts\n');
  });
  it('with --config writes the shard’s Stryker config: the package’s, its mutate the shard, no break of its own', () => {
    const dir = pkg(['src/*.ts'], { 'src/a.ts': 5, 'src/b.ts': 4, 'src/c.ts': 3 });
    const cfg = { mutate: ['src/*.ts'], incremental: true, thresholds: { high: 90, low: 80, break: 80 } };
    writeFileSync(join(dir, 'stryker.config.json'), JSON.stringify(cfg));
    const out = join(dir, 'reports', 'stryker.shard.json');
    const r = spawnSync(process.execPath, [SCRIPT, dir, '1', '2', '--config', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('src/a.ts\n');
    // why: the break is judged once over every shard by scripts/mutation-gate.mjs, as an unsharded run is
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      mutate: ['src/a.ts'],
      incremental: true,
      thresholds: { high: 90, low: 80, break: null },
    });
  });
  it('exits 1 with the reason on a bad shard', () => {
    const dir = pkg(['src/*.ts'], { 'src/a.ts': 5 });
    const r = spawnSync(process.execPath, [SCRIPT, dir, '2', '1'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/shard 2 of 1/);
    expect(r.stdout).toBe('');
  });
});
