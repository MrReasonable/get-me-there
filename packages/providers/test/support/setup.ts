import dns from 'node:dns';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { liveBudgets } from '../fakes.js';
import { server, strays } from './msw.js';

// why: msw 3 intercepts at the socket level and passes a socket through to the real network when the client aborts
// before msw has an answer (seen in a scratch run: a TLS handshake with the real vendor). Refusing every DNS lookup
// in this process means such a socket fails locally; no test ever reaches the network.
const refuseLookup = (hostname: string, ...rest: unknown[]): void => {
  const callback = rest.find((x) => typeof x === 'function');
  const error = Object.assign(new Error(`tests make no DNS lookups (${hostname})`), { code: 'ENOTFOUND' });
  if (typeof callback === 'function') process.nextTick(() => callback(error));
};
Object.defineProperty(dns, 'lookup', { value: refuseLookup, writable: true, configurable: true });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  // why: every reservation is finalised exactly once on every path (spec §5.3); a leak here is a budget bug.
  for (const budget of liveBudgets.splice(0)) expect(budget.open(), 'open reservations').toEqual([]);
  // why: a request no test handler answered was caught by the catch-all in msw.ts; it is a test bug, never a pass.
  expect(strays.splice(0), 'requests no handler answered').toEqual([]);
  server.resetHandlers();
  server.events.removeAllListeners();
});
afterAll(() => server.close());
