import dns from 'node:dns';
import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';

// The network guards every package's msw tests install (plan decision 18): a catch-all that answers any unmatched
// request with a network error and records it, abort-settling helpers, and refused DNS lookups. Other packages call
// installNetworkGuards from their vitest setup file and register handlers on guardedServer, so none imports msw.

const strays: string[] = [];

/**
 * The single msw server on global fetch. Its initial catch-all survives `resetHandlers`; it answers anything no
 * test handler matched with a network error, so no test can reach the real network whatever msw does with an
 * unanswered request (arch-r2-001), and records the request (method, origin, path; never the query) as a stray.
 */
export const guardedServer = setupServer(
  http.all('*', ({ request }) => {
    const url = new URL(request.url);
    strays.push(`${request.method} ${url.origin}${url.pathname}`);
    return HttpResponse.error();
  }),
);

/** Returns and clears the requests no handler answered since the last call. */
export function takeStrays(): string[] {
  return strays.splice(0);
}

/**
 * A response that never comes until the client aborts, then a network error.
 * why: msw 3 passes a request whose handler is still pending when the client aborts through to the real network;
 * settling on abort keeps every "hang" scenario inside the process (arch-r2-001).
 */
export function hangUntilAborted(request: Request): Promise<Response> {
  return new Promise<Response>((resolve) => {
    if (request.signal.aborted) resolve(HttpResponse.error());
    request.signal.addEventListener('abort', () => resolve(HttpResponse.error()), { once: true });
  });
}

/** Answers with `make()` after `ms`, or with a network error as soon as the client aborts (same reason as above). */
export function respondAfter(request: Request, ms: number, make: () => Response): Promise<Response> {
  return new Promise<Response>((resolve) => {
    const timer = setTimeout(() => resolve(make()), ms);
    request.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve(HttpResponse.error());
      },
      { once: true },
    );
  });
}

/**
 * Refuses every DNS lookup in this process with ENOTFOUND.
 * why: msw 3 intercepts at the socket level and passes a socket through to the real network when the client aborts
 * before msw has an answer (seen in a scratch run: a TLS handshake with the real vendor); with no DNS, such a socket
 * fails locally.
 */
function refuseDnsLookups(): void {
  const refuseLookup = (hostname: string, ...rest: unknown[]): void => {
    const callback = rest.find((x) => typeof x === 'function');
    const error = Object.assign(new Error(`tests make no DNS lookups (${hostname})`), { code: 'ENOTFOUND' });
    if (typeof callback === 'function') process.nextTick(() => callback(error));
  };
  Object.defineProperty(dns, 'lookup', { value: refuseLookup, writable: true, configurable: true });
}

/** The test-runner hooks installNetworkGuards registers (vitest's beforeAll, afterEach and afterAll fit). */
export interface GuardHooks {
  beforeAll(fn: () => unknown): unknown;
  afterEach(fn: () => unknown): unknown;
  afterAll(fn: () => unknown): unknown;
}

/**
 * Installs the network guards for a test process (call once from a vitest setup file):
 * `installNetworkGuards({ beforeAll, afterEach, afterAll })`. Refuses DNS now; listens with
 * `onUnhandledFrame: 'error'` before the tests; after each test fails it if any request reached the catch-all,
 * then resets handlers and listeners; closes after all. Spec §9 item 2, plan decision 18.
 */
export function installNetworkGuards(hooks: GuardHooks): { server: typeof guardedServer } {
  refuseDnsLookups();
  hooks.beforeAll(() => guardedServer.listen({ onUnhandledFrame: 'error' }));
  hooks.afterEach(() => {
    const left = takeStrays();
    guardedServer.resetHandlers();
    guardedServer.events.removeAllListeners();
    // why: a request no test handler answered is a test bug, never a pass.
    if (left.length > 0) throw new Error(`requests no handler answered: ${left.join(', ')}`);
  });
  hooks.afterAll(() => guardedServer.close());
  return { server: guardedServer };
}
