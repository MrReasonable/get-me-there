#!/usr/bin/env node
// Fails the image build unless every workspace package the app imports resolves to its built
// dist/ entry under Node's default conditions. Plan decision 15: package exports carry a
// "@gmt/source" condition for tests; the runtime must never resolve it (src/ is not in the image).
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const failures = [];
for (const name of ['@gmt/core', '@gmt/db', '@gmt/providers', '@gmt/engine']) {
  try {
    const resolved = requireFromApi.resolve(name);
    if (!/[/\\]dist[/\\]/.test(resolved)) failures.push(`${name} resolved outside dist: ${resolved}`);
    else if (!existsSync(resolved)) failures.push(`${name} resolved to a missing file: ${resolved}`);
  } catch (err) {
    failures.push(`${name} did not resolve: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (failures.length > 0) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log('workspace packages resolve to dist');
