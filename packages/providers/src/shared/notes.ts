/**
 * Tile and search notes (`DiscoveryTileResult.notes`, `ItinerarySearchResult.notes`), one grammar for every adapter
 * (plan decision 24): `<key>:<n>`, sorted by key, zero counts omitted. Spec §5.2: every dropped entry is counted.
 */
export class NoteCounter {
  readonly #counts = new Map<string, number>();

  /** Adds `n` (default 1) to `key`; a count of zero or less is ignored. */
  add(key: string, n = 1): void {
    if (n > 0) this.#counts.set(key, (this.#counts.get(key) ?? 0) + n);
  }

  /** The count for `key` (0 when never added). */
  get(key: string): number {
    return this.#counts.get(key) ?? 0;
  }

  /** `key:n` strings sorted by key (code-unit order, locale-independent). */
  list(): string[] {
    return [...this.#counts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, n]) => `${k}:${n}`);
  }
}
