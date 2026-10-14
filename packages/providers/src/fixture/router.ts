import type { SyntheticGateInput } from '@gmt/core';
import { Hono } from 'hono';
import { createFixtureServer } from './server.js';

/**
 * The synthetic tree as a Hono router for fixture mode (spec §4, §5.3 rev 11). Throws unless syntheticAllowed(gate).
 * WP4b's wiring reaches it only through http-kit's gated seam: `inProcessHosts: { 'fixture.local': async (req) => router.fetch(req) }`.
 */
export function fixtureRouter(root: string, gate: SyntheticGateInput): Hono {
  const fixture = createFixtureServer(root, gate);
  const app = new Hono();
  app.all('*', (c) => fixture.handle(c.req.raw));
  return app;
}
