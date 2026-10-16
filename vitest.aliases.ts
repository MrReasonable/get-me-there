import { resolve } from 'node:path';

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
