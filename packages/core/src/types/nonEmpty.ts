/**
 * A list with at least one element, as a type: `[T, ...T[]]`. Spec revision 55 §5 declares a stop cause's sources as
 * `z.array(…).min(1)`; core types them as this tuple so a reader's `sources[0]` needs no assertion.
 */
export type NonEmpty<T> = [T, ...T[]];

/**
 * The list as a `NonEmpty`, or null when it is empty: how a writer builds a value typed `NonEmpty` (Task 20.2's stop
 * cause writers turn the run's disabled sources into a `sources-unavailable` cause only when this is non-null).
 * `T` excludes `undefined`, so an empty list is the only way the first element can be missing.
 */
export function nonEmpty<T extends NonNullable<unknown> | null>(list: readonly T[]): NonEmpty<T> | null {
  const [first, ...rest] = list;
  return first === undefined ? null : [first, ...rest];
}

/** `f` over a non-empty list, keeping it non-empty. */
export function mapNonEmpty<T, U>(list: readonly [T, ...T[]], f: (x: T) => U): NonEmpty<U> {
  const [first, ...rest] = list;
  return [f(first), ...rest.map(f)];
}
