import { apiContract, type Iata } from '@gmt/core';

// The URL token parsers the views share (WP19 §4: moved out of resultsState.ts, used by resultsState.ts and
// datesState.ts). Strict: a malformed token is dropped, never coerced, because the URL is operator-editable and a
// coerced value would silently be a different filter than the one the link carried.

/** A comma list with its empty tokens dropped; an absent or empty parameter is the empty list. */
export const list = (v: string | null): string[] => (v ? v.split(',').filter((s) => s.length > 0) : []);

/**
 * Digits only, as a safe integer. why: a limit the URL spells beyond 2^53 would round (or become Infinity) and
 * silently be a different limit; such a token is malformed like any other and is dropped.
 */
export const safeInt = (v: string): number | undefined => {
  const n = Number(v);
  return /^\d+$/.test(v) && Number.isSafeInteger(n) ? n : undefined;
};

/** `safeInt` of a parameter that may be absent. */
export const int = (v: string | null): number | undefined => (v === null ? undefined : safeInt(v));

/** A stay range "min-max" (both whole, min ≤ max), else null: a reversed or malformed range is ignored. */
export function nightsRange(v: string | null): { min: number; max: number } | null {
  const m = /^(\d+)-(\d+)$/.exec(v ?? '');
  const min = m?.[1] === undefined ? undefined : safeInt(m[1]);
  const max = m?.[2] === undefined ? undefined : safeInt(m[2]);
  return min !== undefined && max !== undefined && min <= max ? { min, max } : null;
}

export type SortDir = 'asc' | 'desc';
export const isSortDir = (d: string): d is SortDir => d === 'asc' || d === 'desc';

/**
 * A sort token "<key>.<dir>" with a key the view knows, else null. why: exactly two segments; `price.asc.extra` is
 * malformed, never trimmed to `price.asc` (CodeRabbit batch 3).
 */
export function sortToken<K extends string>(
  v: string | null,
  isKey: (k: string) => k is K,
): { key: K; dir: SortDir } | null {
  if (v === null) return null;
  const parts = v.split('.');
  const [k, d] = parts;
  return parts.length === 2 && k !== undefined && d !== undefined && isKey(k) && isSortDir(d)
    ? { key: k, dir: d }
    : null;
}

/**
 * The airport codes of a comma list that core's IATA schema accepts exactly as spelled (it would upper-case `lgw`,
 * but the URL then names a different token than the filter applies, so such a code is dropped), each once, in the
 * order given. The schema also gives the branded type the filters take, so no cast is needed.
 */
export function uniqueIataList(v: string | null): Iata[] {
  const out: Iata[] = [];
  for (const c of list(v)) {
    const r = apiContract.cellKeySchema.shape.destination.safeParse(c);
    if (r.success && c === r.data && !out.includes(r.data)) out.push(r.data);
  }
  return out;
}
