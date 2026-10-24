import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Workspace packages resolve from source under Vitest. Vite externalises workspace packages and
 * hands them to Node's resolver, which reads the `default` (dist) export, so the `@gmt/source`
 * condition alone is not enough; tsc honours it through `customConditions`, the test runner uses
 * these aliases instead. Subpath exports (`@gmt/providers/testing`, `@gmt/providers/fixture`,
 * `@gmt/providers/recording`) map to their own index files.
 */
export function gmtAliases(repoRoot: string): Array<{ find: RegExp; replacement: string }> {
  const r = (p: string) => resolve(repoRoot, p);
  return [
    {
      find: /^@gmt\/providers\/(testing|fixture|recording)$/,
      replacement: r('packages/providers/src/$1/index.ts'),
    },
    { find: /^@gmt\/(core|db|providers|engine)$/, replacement: r('packages/$1/src/index.ts') },
    { find: /^@gmt\/api$/, replacement: r('apps/api/src/index.ts') },
  ];
}

/** One alias entry, as Vite's `resolve.alias` takes it. */
export interface GmtAlias {
  find: RegExp;
  replacement: string;
}

function isAlias(x: unknown): x is GmtAlias {
  return (
    typeof x === 'object' &&
    x !== null &&
    'find' in x &&
    x.find instanceof RegExp &&
    'replacement' in x &&
    typeof x.replacement === 'string'
  );
}

/**
 * The table for the configs that load this file by computed URL (the cli's and the worker's, so a Stryker sandbox
 * copy finds it; review R29), checked at run time here once (review S16, ca-b1-023): `repoRoot` is the workspace
 * root, every entry is an alias, and each fixed replacement exists. The configs check only that this function is
 * exported.
 */
export function gmtAliasesChecked(repoRoot: string): GmtAlias[] {
  if (!existsSync(join(repoRoot, 'pnpm-workspace.yaml')))
    throw new Error(`${repoRoot} is not the workspace root (no pnpm-workspace.yaml)`);
  const table: unknown[] = gmtAliases(repoRoot);
  const out: GmtAlias[] = [];
  for (const a of table) {
    if (!isAlias(a)) throw new Error('gmtAliases returned no alias table');
    out.push(a);
  }
  for (const a of out)
    if (!a.replacement.includes('$') && !existsSync(a.replacement))
      throw new Error(`alias ${a.find} points at ${a.replacement}, which does not exist`);
  return out;
}
