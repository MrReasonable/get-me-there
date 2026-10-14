import type { SyntheticGateInput } from '@gmt/core';
import { http } from 'msw/http';
import { FIXTURE_ORIGIN } from '../fixture/constants.js';
import { createFixtureServer } from '../fixture/server.js';

/** msw 3's HTTP handler type (no documented entrypoint exports `RequestHandler`; verified 2026-10-14). */
export type RequestHandler = ReturnType<typeof http.all>;

/**
 * msw handlers serving the synthetic tree at http://fixture.local on global fetch (spec §5.5, §9 item 4 layer A).
 * Throws unless syntheticAllowed(gate). Exported from `@gmt/providers/testing` only.
 */
export function fixtureHandlers(root: string, gate: SyntheticGateInput): RequestHandler[] {
  const fixture = createFixtureServer(root, gate);
  return [http.all(`${FIXTURE_ORIGIN}/*`, ({ request }) => fixture.handle(request))];
}
