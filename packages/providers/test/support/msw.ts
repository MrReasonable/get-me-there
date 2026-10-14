import { HttpResponse, http } from 'msw/http';
import { setupServer } from 'msw/node';

/** Requests no test handler answered; test/support/setup.ts fails the test that leaves any. */
export const strays: string[] = [];

/**
 * The package's single msw server on global fetch (spec §9 item 2). Tests add handlers with `server.use`.
 * why: the initial catch-all answers anything unmatched with a network error, so no test can ever reach the real
 * network, whatever msw does with an unanswered request (arch-r2-001); the request is recorded as a stray.
 */
export const server = setupServer(
  http.all('*', ({ request }) => {
    strays.push(`${request.method} ${new URL(request.url).origin}${new URL(request.url).pathname}`);
    return HttpResponse.error();
  }),
);

/**
 * A response that never comes until the client aborts, then a network error.
 * why: msw 3 passes a request whose handler is still pending when the client aborts through to the real network;
 * settling on abort keeps every "hang" scenario inside the process (seen in a scratch run, arch-r2-001).
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
