/**
 * Returns a copy of `obj` with `key` set, or removed when `value` is undefined, so optional keys are
 * absent rather than `undefined` (exactOptionalPropertyTypes). The one helper for filters and drafts.
 */
export function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** A type guard for membership of a readonly list of string literals (URL tokens, select values). */
export function oneOf<T extends string>(set: readonly T[]): (v: string) => v is T {
  return (v: string): v is T => set.some((s) => s === v);
}
