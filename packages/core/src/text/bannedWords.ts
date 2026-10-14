/** The one canonical list of words no user-facing string may contain. Spec §11. */
export const BANNED_WORDS: readonly string[] = [
  'exhaustive',
  'all combinations',
  'every combination',
  'live',
  'bookable',
  'guaranteed',
  'real-time',
];

/** The single allowlist every package's banned-word test passes: exact phrases that legitimately contain a banned word. */
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary, case-insensitive search. Allowlist entries are exact phrases (case-insensitive)
 * whose span is masked before matching. Returns every hit with its index in the original text,
 * in text order, so a test can print the offending sentence.
 */
export function findBannedWords(
  text: string,
  allowlist: readonly string[] = [],
): Array<{ word: string; index: number }> {
  let masked = text;
  for (const phrase of allowlist) {
    masked = masked.replace(new RegExp(escapeRegExp(phrase), 'gi'), (m) => ' '.repeat(m.length));
  }
  const hits: Array<{ word: string; index: number }> = [];
  for (const word of BANNED_WORDS) {
    // why: letters and digits in any script count as word characters, so "élive" is one word and not a hit.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu');
    for (const m of masked.matchAll(re)) hits.push({ word, index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}
