import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { consoleErrors, drainGuards } from './guards.js';
import { server } from './msw/server.js';
import { setViewportWidth } from './viewport.js';

// why: review S12 — findBy*/waitFor wait up to 5 s (testing-library's 1 s default flaked under mutation-run load); a
// passing wait still returns as soon as it matches, so this only bounds a failure
configure({ asyncUtilTimeout: 5_000 });
// why: msw 3 names the unmatched-request policy onUnhandledFrame; the catch-all in server.ts records the rest.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  // why: jsdom has no matchMedia; every test starts wide and opts into 375px explicitly.
  setViewportWidth(1280);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args);
  });
});
afterEach(() => {
  // why: Vitest runs without globals, so RTL's automatic cleanup never registers.
  cleanup();
  // why: per-test handlers prepended with server.use() must not leak into the next test.
  server.resetHandlers();
  vi.restoreAllMocks();
  const problems = drainGuards();
  if (problems.length > 0) throw new Error(problems.join(' | '));
});
afterAll(() => server.close());
// why: jsdom has no scrollIntoView; the ?row= test spies on this stub.
if (typeof Element.prototype.scrollIntoView !== 'function')
  Element.prototype.scrollIntoView = () => undefined;
