/**
 * A list in words: "A", "A and B", "A, B and C" (or "or" in place of "and"). An empty list is the empty string, so a
 * caller that words a list it has not checked never prints a stray conjunction.
 */
export function listWords(items: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  const [first, ...rest] = items;
  if (first === undefined) return '';
  return rest.reduce(
    (text, item, i) => `${text}${i === rest.length - 1 ? ` ${conjunction} ` : ', '}${item}`,
    first,
  );
}
