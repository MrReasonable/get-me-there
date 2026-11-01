// Spec rev 55 §3, §11: the main path (the first screen, a search's page, the new-search form, the Edit page with its
// More options, the status bar) never says a set-up or code term. The sweep reads every visible string and every
// attribute a screen reader or tooltip gives (as `renderedCopy` does), leaving out only a price cell's provenance note,
// which keeps §2's source names ("Google Flights prices via Camoufox").

/** The terms of spec rev 55 §11's main-path rule, each with the pattern that finds it in words. */
export const JARGON: ReadonlyArray<readonly [string, RegExp]> = [
  ['definition', /\bdefinitions?\b/i],
  ['cells', /\bcells?\b/i],
  ['discovery', /\bdiscovery\b/i],
  ['hard stop', /\bhard stop\b/i],
  ['verdict class', /\bverdict class\b/i],
  ['tile', /\btiles?\b/i],
  ['retry factor', /\bretry factor\b/i],
  // why: the label word in capitals; the stale mark's own words ("older than this search's refresh") replace it
  ['STALE', /\bSTALE\b/],
  ['calendar basis', /\bcalendar basis\b/i],
  ['itinerary', /\bitinerar(y|ies)\b/i],
  ['Camoufox', /\bcamoufox\b/i],
  // why: spec rev 55 §11 also bars variable names: a budget scope's wire label ("provider-month:searchapi") is one
  ['variable name', /\b[a-z]+(-[a-z]+)+:[a-z]+\b/],
];

/**
 * A price cell's provenance note, kept out of the sweep (spec rev 55 §11: "outside provenance notes"): the row form's
 * provenance line and a face's spoken note (`data-provenance-note`); a cell's title is its provenance too and is
 * dropped from the cell alone. The amount and the marks beside it stay in the sweep.
 */
const PROVENANCE = '[data-testid="provenance"], [data-provenance-note]';

/** The words of `root` a reader meets: its text and the attributes a screen reader or tooltip shows. */
export function mainPathWords(root: Element = document.body): string {
  const copy = root.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  for (const el of copy.querySelectorAll(PROVENANCE)) el.remove();
  for (const el of copy.querySelectorAll('[data-testid="price-cell"][title]')) el.removeAttribute('title');
  // why: each text node apart, so the words of two elements never run together into one ("ProvidersDiscovery" would
  // hide "Discovery" from a word-boundary match)
  const texts: string[] = [];
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) texts.push(n.textContent ?? '');
  const attrs = [
    ...copy.querySelectorAll('[title], [aria-label], [aria-description], [placeholder], [alt]'),
  ].flatMap((el) =>
    ['title', 'aria-label', 'aria-description', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [...texts, ...attrs].join('\n');
}

/** Each jargon term found in `words`, with the sentence around it, so a failure says where. */
export function jargonIn(words: string): string[] {
  const hits: string[] = [];
  for (const [term, re] of JARGON) {
    const m = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const x of words.matchAll(m))
      hits.push(`${term}: …${words.slice(Math.max(0, x.index - 40), x.index + 40).replace(/\s+/g, ' ')}…`);
  }
  return hits;
}
