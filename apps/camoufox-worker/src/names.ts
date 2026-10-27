/**
 * The grammar of one result's accessible name (spec §2 "parsed by one dated grammar"; brief Task 14.3; PIE-10,
 * PIE-R2-10, TS2-04), dated like the selectors. A strict whole-name match drops anything Google rewords instead of
 * misreading it. Between the price clause and the stops clause it allows only the interstitial sentences passed in
 * (the module's dated table by default, empty until a recording shows one), and reports which applied.
 *
 * The feasibility load's one-stop name of 2026-10-18, the grammar's evidence:
 * "From 478 British pounds round trip total. 1 stop flight with Tap Air Portugal. Leaves Heathrow Airport at 12:25 on
 * Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total
 * duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select
 * flight"
 */
// why: re-dated 2026-10-18 from the recordings (operator ruling): the "Operated by …." sentence after the carriers,
// and runs of spaces between the closing sentences; re-dated 2026-10-27 (results/2026-10-27/1): a stopover that changes
// airports in its city
export const GRAMMAR_VERSION = '2026-10-27-transfer';

export interface Interstitial {
  sentence: string;
  /** The recording that showed it (date). */
  recorded: string;
}
export const INTERSTITIALS: readonly Interstitial[] = [];

export interface ParsedOption {
  amountMinor: number;
  stops: number;
  carriers: string;
  departsOn: { month: number; day: number };
  from: string;
  to: string;
  interstitials: string[];
  /** The operating carrier when the name states one ("Operated by …."), else null; `carriers` stays the marketing one. */
  operatedBy: string | null;
  durationMinutes: number;
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const MONTH_NAMES: readonly string[] = MONTHS;
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE = '[A-Z][a-z]+, [A-Z][a-z]+ [0-9]{1,2}';
const DURATION = '[0-9]+ hrs?(?: [0-9]+ min)?|[0-9]+ min';
/**
 * The tail after the duration (fix round 1, prov-int M3): only the stopover sentences, repeated. The feasibility load's
 * form names the airport and the city ("… stopover at Humberto Delgado Airport in Lisbon."); a stopover that changes
 * airports (observed 2026-10-27, results/2026-10-27/1) names the city, then the transfer as one sentence of its own
 * ("… stopover in Paris. Transfer here from Paris Charles de Gaulle Airport to Paris Orly Airport."). The airports and
 * cities carry no full stop, so an appended sentence can never hide inside one; a stopover whose name holds a dot
 * leaves the option unparsed (counted, never misread).
 */
// why: CodeRabbit on PR #33: each airport or city starts with a character other than a space, so a field of spaces only
// leaves the name unparsed
const FIELD = '[^.\\s][^.]*';
const STOPOVER =
  `Stopover \\([0-9]+ of [0-9]+\\) is a (?:${DURATION})(?: overnight)? stopover ` +
  `(?:at ${FIELD} in ${FIELD}\\.|in ${FIELD}\\. Transfer here from ${FIELD} to ${FIELD}\\.)`;

function grammarFor(interstitials: readonly Interstitial[]): RegExp {
  // why: the group is always present (empty when no interstitial is listed), so it is defined whenever the name matches.
  const inter =
    interstitials.length === 0
      ? '(?<inter>)'
      : `(?<inter>(?: (?:${interstitials.map((i) => esc(i.sentence)).join('|')}))*)`;
  return new RegExp(
    `^From (?<price>[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+) British pounds round trip total\\.${inter} ` +
      '(?<stops>Nonstop|Non-stop|[0-9]+ stops?) flight with (?<carriers>[^.]+(?:\\.[^ .][^.]*)*)\\. ' +
      // why: observed 2026-10-18 (the view-more recording): "Operated by X as Y for Z." or "Operated by X.", once
      '(?:Operated by (?<operator>[^.]+)\\. )?' +
      'Leaves (?<from>.+?) at [0-9]{1,2}:[0-9]{2} on [A-Z][a-z]+, (?<month>[A-Z][a-z]+) (?<day>[0-9]{1,2}) ' +
      `and arrives at (?<to>.+?) at [0-9]{1,2}:[0-9]{2} on ${DATE}\\. ` +
      // why: observed 2026-10-18: a name with no stopover sentence carries a run of spaces before "Select flight"; only
      // spaces may sit between the sentences, never other text
      `Total duration (?<duration>${DURATION})\\.(?<tail>(?: +${STOPOVER})*) +Select flight$`,
  );
}
const cache = new WeakMap<readonly Interstitial[], RegExp>();

/** A named group the grammar guarantees whenever it matches; its absence is a grammar bug, never a parse failure. */
export function group(m: RegExpExecArray, name: string): string {
  const v = m.groups?.[name];
  if (v === undefined) throw new Error(`result-name grammar: group ${name} missing on a match`);
  return v;
}

/** "12 hrs 40 min", "1 hr", "55 min" → minutes. */
function minutesOf(duration: string): number {
  const h = /^([0-9]+) hrs?/.exec(duration);
  const m = /([0-9]+) min$/.exec(duration);
  return (h === null ? 0 : Number(h[1])) * 60 + (m === null ? 0 : Number(m[1]));
}

/** Whole-name parse or null, never a partial read. Exact digits, no float: "1,204" pounds is 120400 pence. */
export function parseOptionName(
  name: string,
  interstitials: readonly Interstitial[] = INTERSTITIALS,
): ParsedOption | null {
  let re = cache.get(interstitials);
  if (re === undefined) {
    re = grammarFor(interstitials);
    cache.set(interstitials, re);
  }
  const m = re.exec(name);
  if (m === null) return null;
  const monthName = group(m, 'month');
  const month = MONTH_NAMES.indexOf(monthName) + 1;
  if (month === 0) return null;
  const stops = group(m, 'stops');
  const inter = group(m, 'inter');
  return {
    amountMinor: Number(group(m, 'price').replaceAll(',', '')) * 100,
    stops: /^Non-?stop$/.test(stops) ? 0 : Number.parseInt(stops, 10),
    carriers: group(m, 'carriers'),
    departsOn: { month, day: Number(group(m, 'day')) },
    from: group(m, 'from'),
    to: group(m, 'to'),
    interstitials:
      inter === '' ? [] : interstitials.filter((i) => inter.includes(i.sentence)).map((i) => i.sentence),
    durationMinutes: minutesOf(group(m, 'duration')),
    operatedBy: m.groups?.operator ?? null,
  };
}
