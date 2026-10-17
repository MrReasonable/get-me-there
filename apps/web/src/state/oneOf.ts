/** A type guard for membership of a readonly list of string literals (URL tokens, select values). */
export function oneOf<T extends string>(set: readonly T[]): (v: string) => v is T {
  return (v: string): v is T => set.some((s) => s === v);
}
