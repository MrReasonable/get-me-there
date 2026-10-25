#!/usr/bin/env node
// The mutation workflow's shards (.github/workflows/mutation.yml): a package whose cold Stryker run does not fit one
// job's limit splits its `mutate` files across several jobs. This prints one shard's files, the list `stryker run
// --mutate` takes:
//
//   node scripts/mutation-shard.mjs <package dir> <shard> <shards>    (shard counts from 1)
//
// The files are those the package's stryker.config.json `mutate` list names (Stryker's matcher, as the mutation-glob
// check reads it), so the shards together always hold every mutated file exactly once and a file added to the list
// joins a shard by itself. Files are dealt largest first to the shard with the fewest bytes so far (the lower shard on
// a tie, equal sizes by path): size stands in for the mutant count, which only Stryker's instrumenter knows.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filesOf, mutatedBy } from './check-mutation-globs.mjs';

/** The files the package's Stryker `mutate` list names, by path, each with its size in bytes. */
export function mutatedFiles(dir) {
  const mutate = JSON.parse(readFileSync(join(dir, 'stryker.config.json'), 'utf8')).mutate ?? [];
  const files = filesOf(dir)
    .filter((f) => mutatedBy(mutate, f))
    .sort()
    .map((path) => ({ path, size: statSync(join(dir, path)).size }));
  if (files.length === 0) throw new Error(`the mutate list of ${dir}/stryker.config.json names no file`);
  return files;
}

/** The paths of shard `shard` of `shards` (1-based), sorted. */
export function shardOf(files, shard, shards) {
  if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 1 || shard > shards)
    throw new Error(`no shard ${shard} of ${shards}`);
  if (shards > files.length) throw new Error(`${shards} shards for ${files.length} files`);
  const totals = new Array(shards).fill(0);
  const out = Array.from({ length: shards }, () => []);
  const order = files.toSorted((a, b) => b.size - a.size || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const f of order) {
    const lightest = totals.indexOf(Math.min(...totals));
    totals[lightest] += f.size;
    out[lightest].push(f.path);
  }
  return out[shard - 1].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, shard, shards] = process.argv.slice(2);
  try {
    if (dir === undefined)
      throw new Error('usage: node scripts/mutation-shard.mjs <package dir> <shard> <shards>');
    console.log(shardOf(mutatedFiles(dir), Number(shard), Number(shards)).join(','));
  } catch (e) {
    console.error(`mutation shard: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
