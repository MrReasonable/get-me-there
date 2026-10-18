/**
 * Airport matching (spec §2 list mode; decision 69 "each option's airports are matched to the queried codes through the
 * airports dataset's names"; prov-006, PIE-10). Google names airports, never codes, so an option counts for a cell only
 * when its "Leaves" and "arrives at" names match the dataset's names for the queried codes, which the engine sends as
 * `airportNames`. A match is: equal after folding case and punctuation; or one a word-suffix of the other ("Heathrow
 * Airport" inside "London Heathrow Airport") when the shorter keeps a distinctive word; or a dated alias, added only
 * from a recording. An empty dataset list never matches.
 */
export interface AirportAlias {
  google: string;
  dataset: string;
  recorded: string;
}
export const AIRPORT_ALIASES: readonly AirportAlias[] = [];

/** Words that say nothing about which airport it is; a suffix match needs one word that is not among them. */
const GENERIC = new Set([
  'airport',
  'international',
  'intl',
  'regional',
  'municipal',
  'airfield',
  'the',
  'of',
]);

export function fold(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’()\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function suffixMatch(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short === '' || !(long === short || long.endsWith(` ${short}`))) return false;
  return short.split(' ').some((w) => !GENERIC.has(w));
}

export function airportMatches(
  googleName: string,
  datasetNames: readonly string[],
  aliases: readonly AirportAlias[] = AIRPORT_ALIASES,
): boolean {
  const g = fold(googleName);
  if (g === '') return false;
  return datasetNames.some((d) => {
    const f = fold(d);
    return f === g || suffixMatch(g, f) || aliases.some((a) => fold(a.google) === g && fold(a.dataset) === f);
  });
}
