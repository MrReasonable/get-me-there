import { installNetworkGuards } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { closeHarnesses } from './harness.js';

// why: plan decisions 18 and 20 — the guards every package installs (DNS refused, a catch-all that fails the test on
// any request no handler answered), reused from @gmt/providers/testing so this package never imports msw itself.
installNetworkGuards({ beforeAll, afterEach, afterAll });

afterEach(async () => {
  // why: a harness is closed even when its test failed, after its passes are shut down, so a secondary error
  // never masks the real failure (test-strategy-reviewer-013).
  await closeHarnesses();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
