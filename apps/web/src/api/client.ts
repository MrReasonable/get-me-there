import { apiContract } from '@gmt/core';
import { ZodArray, type z } from 'zod';

export type Method = apiContract.RouteDef['method'];

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
  body?: unknown;
}

export type FieldError = { field: string; message: string };

/**
 * Any failed call: a non-2xx response (spec §10 error envelope `{ error: { code, message, details? } }`),
 * a network failure (`code: 'network'`), a body that is not JSON (`'malformed'`), or a 2xx body that
 * breaks core/api-contract (`'contract'`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  private readonly fields: readonly FieldError[];

  constructor(status: number, code: string, message: string, fields: readonly FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** A 422's `details.fields` (spec §10), e.g. the metro-code message of review focus 1; already contract-parsed. */
  fieldErrors(): FieldError[] {
    return [...this.fields];
  }
}

/** The ROUTES entry for a method and path template (paths include `/api`); an unknown route is a programming error. */
export function findRoute(method: Method, path: string): apiContract.RouteDef {
  const route = apiContract.ROUTES.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`route ${method} ${path} is not in core/api-contract ROUTES`);
  return route;
}

/** "/api/definitions/:id/results" + { id } → "/api/definitions/abc/results", every value URL-encoded. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`missing path parameter ${name} for ${path}`);
    return encodeURIComponent(v);
  });
}

/** The same schema object, or two arrays of the same element (ROUTES builds `definitionResponseSchema.array()` itself). */
function sameSchema(a: z.ZodType, b: z.ZodType): boolean {
  return a === b || (a instanceof ZodArray && b instanceof ZodArray && a.element === b.element);
}

/** JSON.parse that reports failure instead of throwing a bare SyntaxError. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The one fetch in the app. The endpoint passes the response schema it expects; the client checks it
 * is the ROUTES entry's schema and parses every response with it, in production as in tests
 * (decision 36: payloads are at most 1000 rows), so a WP8 drift fails loudly instead of rendering.
 * Spec §4: mutations carry Content-Type: application/json and X-Requested-With: get-me-there.
 */
export async function call<S extends z.ZodType>(
  schema: S,
  method: Method,
  path: string,
  opts: CallOptions = {},
): Promise<z.output<S>> {
  const route = findRoute(method, path);
  if (!sameSchema(route.response, schema))
    throw new Error(`${method} ${path}: the schema passed is not the ROUTES response schema`);
  // why: absolute URL; Node's fetch under jsdom (and msw's interceptor) cannot use a relative one.
  const url = new URL(fillPath(path, opts.params ?? {}), window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method, headers, credentials: 'same-origin', redirect: 'error' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-Requested-With'] = 'get-me-there';
    init.body = JSON.stringify(opts.body ?? {});
  }
  let res: Response;
  try {
    // why: TanStack's AbortSignal is not forwarded; under jsdom it is jsdom's class, which Node's fetch rejects.
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(
      0,
      'network',
      `${method} ${path} could not reach the server: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // why: fetch resolves when the headers arrive; the body can still fail (a dropped connection), and that is a network
  // failure like any other, never a bare TypeError escaping the client's ApiError contract.
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    throw new ApiError(
      0,
      'network',
      `${method} ${path} lost the connection while reading the response: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const body = parseJson(text);
  if (!res.ok) {
    const envelope = apiContract.errorEnvelopeSchema.safeParse(body.ok ? body.value : null);
    if (envelope.success) {
      const e = envelope.data.error;
      throw new ApiError(res.status, e.code, e.message, e.details?.fields ?? []);
    }
    throw new ApiError(res.status, 'http', `${method} ${path} failed with HTTP ${res.status}`);
  }
  if (!body.ok)
    throw new ApiError(res.status, 'malformed', `${method} ${path} returned a body that is not JSON`);
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ApiError(
      res.status,
      'contract',
      `${method} ${path} response does not match core/api-contract: ${issues}`,
    );
  }
  return parsed.data;
}
