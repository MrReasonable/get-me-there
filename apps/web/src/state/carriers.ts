/** Spec §6.5 carriers, typed as comma-separated two-character codes (Results filter and the airline constraints). */
/** Splits a carriers box into codes and the entries it ignores, which callers show, never silently drop. */
export function parseCarriers(s: string): { codes: string[]; ignored: string[] } {
  const entries = s
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.length > 0);
  return {
    codes: entries.filter((c) => /^[A-Z0-9]{2}$/.test(c)),
    ignored: entries.filter((c) => !/^[A-Z0-9]{2}$/.test(c)),
  };
}

/** The codes a carriers box means, comma-joined: what useSynced compares. */
export function carriersText(input: string): string {
  return parseCarriers(input).codes.join(',');
}
