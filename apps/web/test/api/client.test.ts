import { apiContract } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ApiError, call, findRoute } from '../../src/api/client.js';
import { api } from '../../src/api/endpoints.js';
import { API, calendarRow, resultsResponse } from '../fixtures.js';
import { fixtureFor } from '../msw/handlers.js';
import { server } from '../msw/server.js';

/** The rejection of a call, which must be an ApiError (narrowed, never cast). */
async function failure(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`);
  return err;
}

describe('api client (derived from core/api-contract ROUTES)', () => {
  it('builds an absolute same-origin /api URL with path params and query, and parses with the contract', async () => {
    let seen = '';
    server.use(
      http.get(`${API}/definitions/:id/results`, ({ request }) => {
        seen = request.url;
        return HttpResponse.json(resultsResponse({ rows: [calendarRow()], total: 1 }));
      }),
    );
    const r = await api.results('def 1', 'calendar');
    expect(seen).toBe('http://localhost:3000/api/definitions/def%201/results?basis=calendar');
    expect(r.rows).toHaveLength(1);
  });

  it('rejects a response that breaks the contract (a row without provenance); there is no mode gate to stub', async () => {
    const { provenance: _drop, ...bare } = calendarRow();
    const body = { ...resultsResponse(), rows: [bare] };
    server.use(http.get(`${API}/definitions/:id/results`, () => HttpResponse.json(body)));
    const err = await failure(api.results('d1', null));
    expect(err.code).toBe('contract');
    expect(err.message).toMatch(
      /GET \/api\/definitions\/:id\/results response does not match core\/api-contract: rows\.0\.provenance/,
    );
  });

  it('sends X-Requested-With and Content-Type on every mutation, even without a body', async () => {
    const headers: Array<Record<string, string | null>> = [];
    server.use(
      http.post(`${API}/executions/:id/cancel`, ({ request }) => {
        headers.push({
          xrw: request.headers.get('x-requested-with'),
          ct: request.headers.get('content-type'),
        });
        return HttpResponse.json(fixtureFor('POST', '/api/executions/:id/cancel'));
      }),
    );
    const r = await api.cancel('e1');
    expect(headers).toEqual([{ xrw: 'get-me-there', ct: 'application/json' }]);
    expect(r.status).toBe('cancelled');
  });

  it('turns the error envelope into an ApiError carrying details.fields', async () => {
    server.use(
      http.post(`${API}/definitions/estimate`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation',
              message: 'invalid definition',
              details: {
                fields: [{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }],
              },
            },
          },
          { status: 422 },
        ),
      ),
    );
    const err = await failure(
      call(apiContract.estimateResponseSchema, 'POST', '/api/definitions/estimate', { body: {} }),
    );
    expect([err.status, err.code]).toEqual([422, 'validation']);
    expect(err.fieldErrors()).toEqual([
      { field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' },
    ]);
  });

  it.each([
    [
      'a 500 envelope',
      () =>
        HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 }),
      500,
      'internal',
    ],
    [
      'a 502 HTML page',
      () =>
        new HttpResponse('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      502,
      'http',
    ],
    [
      'a 422 whose fields are malformed',
      () =>
        HttpResponse.json(
          { error: { code: 'validation', message: 'x', details: { fields: [{ field: 1 }] } } },
          { status: 422 },
        ),
      422,
      'http',
    ],
    ['a 200 body that is not JSON', () => new HttpResponse('{"rows":', { status: 200 }), 200, 'malformed'],
    ['a 204 with no body', () => new HttpResponse(null, { status: 204 }), 204, 'contract'],
    ['a network failure', () => HttpResponse.error(), 0, 'network'],
    [
      'a connection that drops while the body is read',
      () =>
        new HttpResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"providers":'));
              controller.error(new Error('connection reset'));
            },
          }),
          { status: 200 },
        ),
      0,
      'network',
    ],
  ])('maps %s to an ApiError, never a bare SyntaxError', async (_label, reply, status, code) => {
    server.use(http.get(`${API}/providers`, reply));
    const err = await failure(api.providers());
    expect([err.status, err.code, err.fieldErrors()]).toEqual([status, code, []]);
  });

  it("refuses a route that is not in ROUTES, and a schema that is not the route's", async () => {
    expect(() => findRoute('GET', '/api/not-a-route')).toThrow(
      'route GET /api/not-a-route is not in core/api-contract ROUTES',
    );
    await expect(call(apiContract.coverageResponseSchema, 'GET', '/api/providers')).rejects.toThrow(
      'the schema passed is not the ROUTES response schema',
    );
  });

  it('every route is under /api, the one prefix the dev server proxies', () => {
    for (const r of apiContract.ROUTES) expect(r.path.startsWith('/api/')).toBe(true);
  });
});
