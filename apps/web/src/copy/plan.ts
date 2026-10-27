/**
 * The words of the Searches view's "Plan a search" form: where from, where to, when and how long, in plain words,
 * with everything else behind "More options". They live apart from `src/copy.ts` so the two can change
 * independently; `test/copy/planCatalogue.test.ts` sweeps every string here for the spec §11 banned words.
 * No place is named here: the airports come from the airports table, never from code (spec §1).
 */

const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The departure-window presets: a rolling window of this many months, from the start offset (spec §11 relative window). */
export const WINDOW_PRESET_MONTHS = [3, 6, 9, 12] as const;
export type WindowPresetMonths = (typeof WINDOW_PRESET_MONTHS)[number];

export const PLAN_COPY = {
  // --- The view ---
  viewHeading: 'Searches',
  searchList: 'Searches to edit',
  newSearch: 'New search',
  editSearch: (name: string) => `Edit ${name}`,
  notFound: 'The search in this link no longer exists. Pick another one above.',

  // --- The short form ---
  heading: 'Plan a search',
  lead: 'Where from, where to and when. Everything else starts from sensible defaults under More options.',
  from: 'From',
  to: 'To',
  fromPlaceholder: 'City, airport or code',
  toPlaceholder: 'City, airport or code',
  departing: 'Departing between',
  earliest: 'Earliest departure',
  latest: 'Latest departure',
  presets: 'Quick choices for the departure window',
  preset: (months: number) => `Next ${months} months`,
  rolling: (startDays: number, lengthDays: number) =>
    `Rolling window: each run searches departures from ${startDays} ${noun(startDays, 'day', 'days')} ahead, for ${lengthDays} ${noun(lengthDays, 'day', 'days')}. Change a date to fix the window instead.`,
  fixed:
    'Fixed dates: runs search these dates until you change them. Pick a quick choice to roll with today again.',
  stay: 'Stay',
  shortest: 'Shortest stay',
  longest: 'Longest stay',
  stayTo: 'to',
  nights: 'nights',
  journey: 'Longest journey each way',
  journeyHint: 'Blank for no limit.',
  name: 'Name',
  nameHint: 'Suggested from the airports; change it if you like.',
  nameArrow: (from: string, to: string) => `${from} → ${to}`,

  // --- More options ---
  moreOptions: 'More options',
  moreOptionsHint: 'Price sources, checking fares, constraints, run budget, schedule, notes per destination.',
  rollingHeading: 'Rolling window',
  notesHeading: 'Notes and onward costs per destination',
  notesEmpty: 'Add a destination above to give it a note or an onward cost.',

  // --- The airport picker ---
  airportHelp: 'Type a city, an airport name or a three-letter code, then pick from the list.',
  airportOption: (name: string, code: string, city: string, country: string) =>
    `${name} (${code}) · ${city}, ${country}`,
  listbox: (field: string) => `${field}: matching airports`,
  placeLine: (city: string, country: string) => ` · ${city}, ${country}`,
  metroOption: (city: string, codes: readonly string[]) => `${city}, all airports (${codes.join(', ')})`,
  searching: 'Searching airports…',
  noMatch: (text: string) => `No airport matches "${text}".`,
  noMatchCode: (text: string) =>
    `No airport matches "${text}". Press Enter to add it as a code; the search checks it when you estimate.`,
  lookupFailed: 'Could not search airports just now. You can still type a three-letter code and press Enter.',
  pickOrCode: 'Pick an airport from the list, or type its three-letter code.',
  remove: (code: string) => `Remove ${code}`,
  added: (labels: string) => `Added ${labels}.`,
} as const;
