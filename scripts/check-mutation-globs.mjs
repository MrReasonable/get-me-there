#!/usr/bin/env node
// Decision 77, ts3-005 (WP16a Task 16a.8; review R28): every file a brief puts under mutation must be in its package's
// Stryker `mutate` globs, or the mutation run leaves it out while the brief reads as satisfied. A brief states its scope
// in its YAML front matter, never in prose:
//
//   mutate: {"@gmt/core": ["src/camoufox/builds.ts", "src/labels/*.ts"]}
//   pending: {"@gmt/cli": ["src/plan/**"]}
//
// (YAML flow mappings, which are JSON.) Every docs/briefs/wp*.md has front matter with a `mutate:` line (`mutate: {}`
// is an explicit "none"), so no brief drops out of the check by omission; CRLF line endings read as LF. Each `mutate`
// path is a package-relative minimatch glob, Stryker's own matcher: it must match at least one file of the package, and
// every file it matches must be matched by a non-negated entry of the package's stryker.config.json `mutate` list and
// by no negated one (an entry's `:line-range` suffix is dropped). `pending` names what a package not yet built, or a
// file not yet written, will put under mutation: reported while the brief is not merged, and a violation once its
// `status:` is `merged` (review S13), so the package that lands it must move the entry to `mutate` before it merges.
// Anything else that matches nothing fails, so a typo can never pass for a file still to come.
// Usage: node scripts/check-mutation-globs.mjs [repository root]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { GENERATED_AT_PACKAGE_ROOT } from './generated-dirs.mjs';

/** A brief's front matter, the block between its first two `---` lines (CRLF read as LF), or null. */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text.replace(/\r\n/g, '\n'));
  return m === null ? null : m[1];
}

/**
 * A brief's mutation scope from its front matter: `{ mutate, pending, status, declared }`, each scope package → paths
 * (empty when the field is absent), `status` the first word of its `status:` line (or null), and `declared` whether it
 * has front matter with a `mutate:` line. Throws on a field that is not a JSON object of string arrays, so a malformed
 * scope fails the check.
 */
export function scopeOf(text) {
  const fm = frontMatter(text);
  const lines = (fm ?? '').split('\n');
  const field = (name) => {
    const line = lines.find((l) => l.startsWith(`${name}:`));
    if (line === undefined) return {};
    const v = JSON.parse(line.slice(name.length + 1).trim());
    const ok =
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.values(v).every((a) => Array.isArray(a) && a.every((p) => typeof p === 'string' && p !== ''));
    if (!ok) throw new Error(`${name}: must be an object of package → non-empty path strings`);
    return v;
  };
  const status = /^status:\s*(\S+)/.exec(lines.find((l) => l.startsWith('status:')) ?? '')?.[1] ?? null;
  return {
    mutate: field('mutate'),
    pending: field('pending'),
    status,
    declared: fm !== null && lines.some((l) => l.startsWith('mutate:')),
  };
}

/** Every file under `dir`, package-relative with `/`, skipping node_modules anywhere and generated dirs at the root. */
export function filesOf(dir) {
  const out = [];
  const walk = (d, atRoot) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || (atRoot && GENERATED_AT_PACKAGE_ROOT.has(name))) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p, false);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir, true);
  return out;
}

/** Workspace package name → its directory, for packages/* and apps/*. */
function packages(root) {
  const out = new Map();
  for (const group of ['packages', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const manifest = join(dir, name, 'package.json');
      if (existsSync(manifest)) out.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(dir, name));
    }
  }
  return out;
}

/** Whether Stryker's `mutate` list puts `file` under mutation (minimatch, negations last, line ranges dropped). */
export function mutatedBy(mutate, file) {
  const globs = mutate.map((g) => g.replace(/:\d+(?::\d+)?-\d+(?::\d+)?$/, ''));
  const included = globs.filter((g) => !g.startsWith('!')).some((g) => minimatch(file, g));
  const excluded = globs.filter((g) => g.startsWith('!')).some((g) => minimatch(file, g.slice(1)));
  return included && !excluded;
}

/** Every brief's front-matter scope checked against its packages' Stryker `mutate` lists. */
export function checkMutationGlobs(root) {
  const violations = [];
  const pending = [];
  const pkgs = packages(root);
  const briefs = join(root, 'docs', 'briefs');
  for (const brief of readdirSync(briefs)
    .filter((f) => /^wp.*\.md$/.test(f))
    .sort()) {
    const where = `docs/briefs/${brief}`;
    let scope;
    try {
      scope = scopeOf(readFileSync(join(briefs, brief), 'utf8'));
    } catch (e) {
      violations.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!scope.declared)
      violations.push(
        `${where}: no front-matter mutate line (write \`mutate: {}\` when the brief mutates nothing)`,
      );
    for (const [pkg, paths] of Object.entries(scope.pending))
      for (const p of paths)
        if (scope.status === 'merged')
          violations.push(
            `${where}: ${pkg} ${p} is still pending in a merged brief (move it to mutate and to the package's Stryker mutate)`,
          );
        else pending.push(`${where}: ${pkg} ${p}`);
    for (const [pkg, paths] of Object.entries(scope.mutate)) {
      const dir = pkgs.get(pkg);
      if (dir === undefined) {
        violations.push(
          `${where}: ${pkg} is no package of this workspace (list it under pending until it is)`,
        );
        continue;
      }
      const config = join(dir, 'stryker.config.json');
      const configName = relative(root, config).split('\\').join('/');
      const mutate = existsSync(config) ? (JSON.parse(readFileSync(config, 'utf8')).mutate ?? []) : [];
      const files = filesOf(dir);
      for (const p of paths) {
        const named = files.filter((f) => minimatch(f, p));
        if (named.length === 0) {
          violations.push(
            `${where}: ${pkg} ${p} matches no file (list it under pending until it is written)`,
          );
          continue;
        }
        const left = named.filter((f) => !mutatedBy(mutate, f));
        for (const f of left)
          violations.push(`${where}: ${pkg} ${f} (from ${p}) is not in ${configName}'s mutate`);
      }
    }
  }
  return { violations, pending };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? process.cwd());
  const { violations, pending } = checkMutationGlobs(root);
  for (const p of pending) console.log(`pending: ${p}`);
  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    process.exit(1);
  }
  console.log('mutation globs: every file a brief puts under mutation is in its Stryker mutate list');
}
