// Spec §9 item 5: every route is tested against core/api-contract. Bodies are parsed, never cast.
import { apiContract } from '@gmt/core';
import { expect } from 'vitest';
import type { z } from 'zod';

function routeOf(method: string, path: string): apiContract.RouteDef {
  const route = apiContract.ROUTES.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no ROUTES entry ${method} ${path}`);
  return route;
}

/** Parses a 2xx body against its ROUTES entry and against `schema` (the shape the test reads), returning it typed. */
export async function expectContract<S extends z.ZodType>(
  res: Response,
  method: string,
  path: string,
  schema: S,
): Promise<z.output<S>> {
  const body: unknown = await res.clone().json();
  expect(res.ok, `${method} ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 500)}`).toBe(true);
  const route = routeOf(method, path).response.safeParse(body);
  if (!route.success)
    throw new Error(
      `${method} ${path} breaks the contract: ${JSON.stringify(route.error.issues).slice(0, 2000)}`,
    );
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      `${method} ${path} does not match the test schema: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}`,
    );
  return parsed.data;
}

/** Any body against its ROUTES entry (2xx) or the error envelope (otherwise); the sweep's form. */
export async function expectEnvelopeOrContract(
  res: Response,
  method: string,
  path: string,
): Promise<unknown> {
  const body: unknown = await res.clone().json();
  const schema = res.ok ? routeOf(method, path).response : apiContract.errorEnvelopeSchema;
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      `${method} ${path} → ${res.status} breaks the contract: ${JSON.stringify(parsed.error.issues).slice(0, 2000)}`,
    );
  return body;
}

/** The error envelope of a non-2xx response (spec §10). */
export async function errorOf(
  res: Response,
): Promise<z.output<typeof apiContract.errorEnvelopeSchema>['error']> {
  return apiContract.errorEnvelopeSchema.parse(await res.json()).error;
}
