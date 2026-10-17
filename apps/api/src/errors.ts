/** The spec §10 error envelope and the app's error handlers. */
import { type Logger, type Secret, stripUrlsInText } from '@gmt/core';
import { RowRejected } from '@gmt/db';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { safeMessage } from './safeMessage.js';
import { API_TEXT } from './text.js';

export type FieldError = { field: string; message: string };
/** `error.details` on the wire: a JSON object, `fields` on a 422 or a validation 400 (spec §10). */
export type Details = { [key: string]: unknown };

/** Thrown by handlers; rendered as the spec §10 error envelope with its status. */
export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details: Details | undefined;
  constructor(status: ContentfulStatusCode, code: string, message: string, details?: Details) {
    super(stripUrlsInText(message));
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Spec §10: a 422 (and a 400 from validation) carries `details.fields`. */
export function fieldsDetail(fields: readonly FieldError[]): { fields: FieldError[] } {
  return { fields: [...fields] };
}

/** zod issues → field errors, the path joined with dots. */
export function issuesToFields(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): FieldError[] {
  return issues.map((i) => ({ field: i.path.map(String).join('.'), message: i.message }));
}

/** A copy with every string URL-stripped. Spec §5.3: API `error.details` never holds a query string or userinfo. */
function scrub(value: unknown): unknown {
  if (typeof value === 'string') return stripUrlsInText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value !== null && typeof value === 'object') return scrubDetails(value);
  return value;
}

/** Deep copy of an object with every string URL-stripped (spec §5.3). */
export function scrubDetails(value: object): Details {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
}

/** Spec §10: `{ error: { code, message, details? } }`. */
export function envelope(
  code: string,
  message: string,
  details?: Details,
): { error: { code: string; message: string; details?: Details } } {
  return {
    error: {
      code,
      message: stripUrlsInText(message),
      ...(details === undefined ? {} : { details: scrubDetails(details) }),
    },
  };
}

/**
 * `app.onError`: ApiError → its envelope; WP3's `RowRejected('active')` (a start or verify that lost the race for the
 * one-active-execution index) → 409 `active`; anything else → 500 without internals, logged URL-free and secret-free
 * (spec §5.3, §14).
 */
export function onError(log: Logger, secrets: readonly Secret[]) {
  return (err: Error, c: Context) => {
    if (err instanceof ApiError) return c.json(envelope(err.code, err.message, err.details), err.status);
    if (err instanceof RowRejected && err.rule === 'active')
      return c.json(envelope('active', err.message), 409);
    log.error({ err: { name: err.name, message: safeMessage(err, secrets) } }, 'unhandled error');
    return c.json(envelope('internal', API_TEXT.internal), 500);
  };
}

/** `app.notFound`: the router matched nothing. Handlers use their own codes (`definition_not_found`, …). */
export function notFound(c: Context) {
  return c.json(envelope('not_found', API_TEXT.notFound), 404);
}
