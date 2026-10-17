import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { unhandled } from '../guards.js';
import { handlers } from './handlers.js';

/**
 * The test API. A catch-all handler, registered last, records any request no handler matched and
 * answers with a network error, so nothing reaches the network (decision 18) and the test fails in
 * afterEach (test/setup.ts) even when the app swallowed the error into a query state.
 */
export const server = setupServer(
  ...handlers,
  http.all('*', ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`);
    return HttpResponse.error();
  }),
);
