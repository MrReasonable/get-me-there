/** Where the app bootstrap finds its assets (spec §7 migrations and airports, §13 the built SPA). */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIRPORTS_DATA_DIR, MIGRATIONS_DIR } from '@gmt/db';

export interface AssetPaths {
  migrationsDir: string;
  airportsDataDir: string;
  /** The built SPA, or null when `apps/web/dist/index.html` is absent (an api-only run). */
  webRoot: string | null;
}

/**
 * The db package's committed migrations and airports data (its own exported paths, valid from src/ and dist/), and the
 * web build. why: src/bootstrap (tsx) and dist/bootstrap (build) are both three levels below `apps/`, so one relative
 * URL serves dev, tests and the image (WP12 keeps the layout). The fixture tree is buildPorts' default
 * (`defaultFixtureRoot()`), wired only under the synthetic gate.
 */
export function assetPaths(): AssetPaths {
  const web = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
  return {
    migrationsDir: MIGRATIONS_DIR,
    airportsDataDir: AIRPORTS_DATA_DIR,
    webRoot: existsSync(join(web, 'index.html')) ? web : null,
  };
}
