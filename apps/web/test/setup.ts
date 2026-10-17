import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { consoleErrors, drainGuards } from './guards.js';
import { setViewportWidth } from './viewport.js';

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
  vi.restoreAllMocks();
  const problems = drainGuards();
  if (problems.length > 0) throw new Error(problems.join(' | '));
});
