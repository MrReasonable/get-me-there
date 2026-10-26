import { HttpResponse, http, type JsonBodyType } from 'msw';
import { type DatesOptions, datesResponse, workedDates } from '../fixtures.dates.js';
import { API } from '../fixtures.js';

// msw handlers for `GET /api/definitions/:id/date-pairs` (WP19 Tasks 19.4–19.9). Bodies come from fixtures.dates.ts,
// so they are always what core's `encodeDatePairs` writes. Every handler records the request's URL, so a test can
// assert the scope parameters the view sent (spec §11 Filters: airports and the journey limit are sent; the stay range
// and the week switch never are).

export const DATES_URL = `${API}/definitions/:id/date-pairs`;

/** The URLs of the date-pairs requests a handler answered, oldest first. */
export type Requests = URL[];

/** Serves `body` (options for `datesResponse`, or a ready body) for every request, recording each URL. */
export function serveDates(body: DatesOptions | JsonBodyType = workedDates(), requests: Requests = []) {
  const json = isOptions(body) ? datesResponse(body) : body;
  return http.get(DATES_URL, ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json(json);
  });
}

/** Serves a body chosen from the request's query (a filtered read answers its own scope). */
export function serveDatesBy(
  pick: (q: URLSearchParams) => DatesOptions | JsonBodyType,
  requests: Requests = [],
) {
  return http.get(DATES_URL, ({ request }) => {
    const url = new URL(request.url);
    requests.push(url);
    const body = pick(url.searchParams);
    return HttpResponse.json(isOptions(body) ? datesResponse(body) : body);
  });
}

/** Answers with the route's error envelope (spec §10), e.g. 422 `too_many_cells`. */
export function datesError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return http.get(DATES_URL, () =>
    HttpResponse.json(
      { error: { code, message, ...(details === undefined ? {} : { details }) } },
      { status },
    ),
  );
}

/**
 * A handler that holds each request until the test releases it, so a test sees the view while a read is in flight
 * (never with a fixed wait): `release(body)` answers the oldest held request.
 */
export function heldDates() {
  const waiting: Array<(body: JsonBodyType) => void> = [];
  const arrived: Array<() => void> = [];
  const requests: Requests = [];
  const handler = http.get(DATES_URL, async ({ request }) => {
    requests.push(new URL(request.url));
    const body = await new Promise<JsonBodyType>((resolve) => {
      waiting.push(resolve);
      for (const a of arrived.splice(0)) a();
    });
    return HttpResponse.json(body);
  });
  return {
    handler,
    requests,
    /** Resolves once a request is held (at once when one already is). */
    arrived: () =>
      new Promise<void>((resolve) => {
        if (waiting.length > 0) resolve();
        else arrived.push(resolve);
      }),
    release(body: DatesOptions | JsonBodyType = workedDates()) {
      const next = waiting.shift();
      if (next === undefined) throw new Error('no date-pairs request is waiting');
      next(isOptions(body) ? datesResponse(body) : body);
    },
  };
}

/** The default handler of the test server: the worked example. */
export const datesHandlers = [serveDates()];

function isOptions(b: DatesOptions | JsonBodyType): b is DatesOptions {
  // why: a response body always has `pairs` as columns and `figures`; options never carry `figures`
  return typeof b === 'object' && b !== null && !Array.isArray(b) && !('figures' in b);
}
