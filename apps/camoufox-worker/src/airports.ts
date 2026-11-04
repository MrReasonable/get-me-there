/**
 * Airport matching (spec §2 "Airport names"; decision 69 "each option's airports are matched to the queried codes through
 * the airports dataset's names"; prov-006, PIE-10). Google names airports, never codes, so an option counts for a cell
 * only when its "Leaves" and "arrives at" names fit the cell's airports better than any other airport the operator
 * chose on that side. The engine sends the dataset's names for the cell's codes (`airportNames.origin`/`destination`)
 * and for the search's other chosen airports (`otherOrigins`/`otherDestinations`): a page loads only chosen airports,
 * so the choice is among those, never the whole dataset (a dataset's "<City> Airport" is a page's "<City> <Name>
 * Airport"; with Brussels and Brussels South Charleroi both chosen, "Brussels South Charleroi Airport" is Charleroi's).
 * A close fit is: equal after folding case and punctuation; or one a word-suffix of the other ("Heathrow Airport"
 * inside "London Heathrow Airport") when the shorter keeps a distinctive word; or a dated alias, added only from a
 * recording. Failing that, the fit is the number of the page name's distinctive words an airport's name shares. The
 * cell's airport must fit (closely, or by one shared word) and fit strictly best; a tie is no match. An empty dataset
 * list never matches.
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

/** How well a folded page name fits one airport's names: a close fit first, then the distinctive words shared. */
interface Fit {
  close: boolean;
  shared: number;
}

function fitOf(g: string, names: readonly string[], aliases: readonly AirportAlias[]): Fit {
  const words = g.split(' ').filter((w) => !GENERIC.has(w));
  let fit: Fit = { close: false, shared: 0 };
  for (const d of names) {
    const f = fold(d);
    if (f === '') continue;
    const close =
      f === g || suffixMatch(g, f) || aliases.some((a) => fold(a.google) === g && fold(a.dataset) === f);
    const own = new Set(f.split(' '));
    const shared = words.filter((w) => own.has(w)).length;
    if (beats({ close, shared }, fit)) fit = { close, shared };
  }
  return fit;
}

const beats = (a: Fit, b: Fit): boolean => (a.close === b.close ? a.shared > b.shared : a.close);

export function airportMatches(
  googleName: string,
  datasetNames: readonly string[],
  otherAirports: readonly (readonly string[])[],
  aliases: readonly AirportAlias[] = AIRPORT_ALIASES,
): boolean {
  const g = fold(googleName);
  if (g === '') return false;
  const mine = fitOf(g, datasetNames, aliases);
  if (!mine.close && mine.shared === 0) return false;
  return otherAirports.every((names) => beats(mine, fitOf(g, names, aliases)));
}
