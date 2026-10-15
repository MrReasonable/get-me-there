/**
 * The one way an adapter reports a response it cannot use (plan decision 24; spec §5.2 "malformed → parse").
 * Shared by WP5 (SearchApi), WP6 (Travelpayouts) and the fixture provider, and shaped like http-kit's errors: a
 * URL-free message ending in a bracketed machine cause.
 */
import { type ErrorReason, ProviderError, type ProviderId, stripControlChars } from '@gmt/core';
import type { z } from 'zod';
import { zodReason } from '../util.js';

/** Where the response came from; prefixes the message the way http-kit's errors do (`travelpayouts /path: …`). */
export interface ParseWhere {
  providerId: ProviderId;
  endpointPath: string;
}

/** The kind-level reason from core's closed ErrorReason list (spec §3); the engine writes it to `cell_outcomes.reason`. */
const PARSE: ErrorReason = 'parse';
/** Longest vendor detail kept in a message (the same bound http-kit's vendorMessage uses). */
const MAX_DETAIL = 200;

/**
 * A non-retryable `parse` ProviderError. `reason` is always 'parse' (the kind-level reason; spec §3: the outcome
 * reason holds the kind or a normalisation reason, never vendor text). The machine `cause` (`malformed-envelope`,
 * `currency-missing`, …) and the vendor `detail` go in the message, which the engine writes, URL-stripped, to
 * `last_error`: `<provider> <path>: <detail or cause> [<cause>]`. `where` is always given (plan decision 29), so every
 * parse error names its provider, as http-kit's errors do.
 * why: control characters are removed and the detail is capped, because vendor text ends up in logs and the UI.
 */
export function parseError(cause: string, detail: string | null, where: ParseWhere): ProviderError {
  const text = detail === null ? cause : stripControlChars(detail, ' ').slice(0, MAX_DETAIL);
  return new ProviderError({
    kind: 'parse',
    retryable: false,
    reason: PARSE,
    message: `${where.providerId} ${where.endpointPath}: ${text} [${cause}]`,
    providerId: where.providerId,
  });
}

/**
 * Validates an untrusted vendor body with a zod schema and returns the typed result (brands come from the schema,
 * never a cast; plan decision 15), or throws `parseError(cause, <failed fields>)`. The detail names fields and
 * problems only, never vendor values.
 */
export function parseVendor<S extends z.ZodType>(
  schema: S,
  body: unknown,
  cause: string,
  where: ParseWhere,
): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw parseError(cause, zodReason(r.error), where);
  return r.data;
}
