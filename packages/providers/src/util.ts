import type { z } from 'zod';

/** Plain-object guard for vendor and fixture JSON. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON-parses a request body when it is JSON, else returns it as text; `undefined` → null. */
export function parseMaybeJson(text: string | undefined): unknown {
  if (text === undefined) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v;
  } catch {
    return text;
  }
}

/** Orders [name, value] pairs by name, then value (canonical query order for cache keys and replay). */
export function byPair(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return 0;
}

/** The `code` of a Node system error, without casting. */
export function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined;
}

/** One line naming every failed field (`options.0.carrier: Invalid string`), so refusals point at the field. */
export function zodReason(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * Parses untrusted JSON with a zod schema (core's pattern; brands come from the schema, never a cast) and throws
 * `<where>: <field>: <problem>` on failure. Used by the fixture tree, recorded-fixture and allowlist loaders.
 */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new Error(`${where}: ${zodReason(r.error)}`);
  return r.data;
}
