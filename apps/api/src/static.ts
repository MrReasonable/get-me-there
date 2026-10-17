/** Spec §4, §13: the built SPA behind auth, with an index.html fallback outside /api. */
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';
import { API_PREFIX, type AppEnv } from './routes/types.js';

const isApi = (path: string): boolean => path === API_PREFIX || path.startsWith(`${API_PREFIX}/`);

/**
 * Serves the built SPA (spec §4: behind auth, which runs before this) with an index.html
 * fallback for client-side paths. GET only; `/api/*` never falls back, so API 404s stay JSON.
 * serveStatic rejects `..`, `//` and backslashes before touching the disk.
 */
export function mountStatic(app: Hono<AppEnv>, webRoot: string): void {
  const files = serveStatic<AppEnv>({ root: webRoot });
  const index = serveStatic<AppEnv>({ path: join(webRoot, 'index.html') });
  app.get('*', async (c, next) => (isApi(c.req.path) ? next() : files(c, next)));
  app.get('*', async (c, next) => (isApi(c.req.path) ? next() : index(c, next)));
}
