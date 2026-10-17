/** The keys of `T` that may be absent; deleting any other key would leave a value that no longer matches `T`. */
export type OptionalKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * Returns a copy of `obj` with `key` set. For an optional key, `undefined` removes it, so optional keys are absent
 * rather than `undefined` (exactOptionalPropertyTypes). A required key can only be given a value: deleting it would
 * leave an object that no longer matches `T`. The one helper for filters and drafts.
 */
export function withKey<T extends object, K extends OptionalKeys<T>>(
  obj: T,
  key: K,
  value: T[K] | undefined,
): T;
export function withKey<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: Exclude<T[K], undefined>,
): T;
export function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}
