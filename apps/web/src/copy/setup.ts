/**
 * The words of the set-up screens (Definitions, Providers, Alerts, Status, History) added by the set-up polish pass.
 * They live apart from `src/copy.ts` so the two can change independently; `test/copy/setupCatalogue.test.ts` sweeps
 * every string here for the spec §11 banned words, as the main catalogue test sweeps `COPY`. Plain words first, with
 * the spec's own term (cell, discovery, itinerary search) kept beside them where spec §11 binds it.
 */

const noun = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Monday first, as a UK week reads; index = cron day-of-week (0 = Sunday). */
export const DAY_PLURAL = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "A", "A and B", "A, B and C". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const SETUP_COPY = {
  // --- The Edit page's More options (spec rev 55 §3, §11: main-path words; each set-up term that stays carries its
  // one-line explanation, WP20 Task 20.6) ---
  definitions: {
    policyHeading: 'Checking fares',
    policyIntro:
      'The first pass prices date pairs across your dates from the cheaper sources. Checking fares then looks up the flights, with booking options, for the cheapest of those date pairs. These settings choose which date pairs it checks.',
    maxCells: 'Date pairs to check per run, at most',
    maxCellsHint:
      'Each date pair is one departure date and one return date, on one airport pair. A run checks the fares of no more than this many.',
    topN: 'Cheapest date pairs to check',
    topNHint: 'Ranked by their first-pass price; no more than the limit above.',
    priceCeilingHint: 'Also check any other date pair priced at or under this, up to the limit.',
    perDepartureDateBest: 'Most date pairs per departure date (optional)',
    perDepartureDateBestHint: 'Spreads the checks across departure dates instead of one cheap date.',
    expandTop: 'Outbound flights priced per date pair',
    expandTopHint: (calls: number) =>
      `SearchApi prices this many of the cheapest outbound flights with their returns: ${calls} ${noun(calls, 'call', 'calls')} per date pair.`,
    providersHeading: 'Price sources',
    discoveryProviders: 'The first pass across your dates',
    verificationProviders: 'Checking fares (the cheapest date pairs)',
    /** A source's tick, by its main-path name ("The Aviasales cache"). */
    sourceLabel: (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    refreshLabel: (source: string) => `How often to ask ${source} again (hours)`,
    refreshHint:
      "A price older than this is asked for again by the next run, and until then reads as older than this search's refresh.",
    maxCallsZero:
      '0 allows no billed calls: SearchApi does not run for this search, so its date grid and its fare checks are skipped. Raise this number to let it run. New searches start from EXECUTION_MAX_CALLS in .env.',
    maxCallsHint: 'Calls to paid sources (SearchApi). New searches start from EXECUTION_MAX_CALLS in .env.',
    maxFreeCallsHint:
      "Requests to free sources (the Aviasales cache, the browser worker's pages) a run may make before it stops.",
    maxCostHint: 'A run stops before it would spend more than this. 0 means it spends nothing.',
    constraintsHint:
      'Limits on the flights a fare check keeps. A calendar price is never checked against them, and says so.',
    // the budget fit, each limit in words (spec rev 55 §11: no variable names on the main path)
    fitScope: {
      'execution-calls': 'billed calls a run',
      'execution-free-calls': 'free requests a run',
      'execution-cost': 'cost a run',
      'global-month': "this month's spending",
    } satisfies Record<string, string>,
    fitProviderMonth: (source: string) => `${source} this month`,
    fitProviderLifetime: (source: string) => `${source} over its trial`,
    fitLine: (what: string, estimated: string, cap: string) => `${what}: about ${estimated}, limit ${cap}`,
    journeyHours: 'hours',
    journeyMinutes: 'minutes',
    journeyPart: (label: string, part: string) => `${label}, ${part}`,
  },

  // --- Definitions: schedule picker ---
  schedule: {
    repeat: 'Repeat',
    mode: {
      none: 'No schedule (it runs when you press Search again)',
      daily: 'Every day',
      weekly: 'Weekly, on chosen days',
      custom: 'Custom (cron)',
    },
    time: 'At (24-hour time)',
    days: 'On these days',
    dayShort: DAY_SHORT,
    cron: 'Cron expression (minute hour day month weekday)',
    cronHint: 'Digits, * / , - and spaces. The scheduler checks it when you save.',
    noDays: 'Choose at least one day.',
    noTime: 'Enter a time, for example 05:00.',
    blocked: 'Cannot estimate or save: the schedule needs at least one day and a time.',
    reads: 'Runs:',
    none: 'No scheduled runs; start one with Search again.',
    daily: (time: string, tz: string) => `Every day at ${time} (${tz})`,
    weekly: (days: readonly number[], time: string, tz: string) =>
      days.length === 7
        ? `Every day at ${time} (${tz})`
        : `${listText(days.map((d) => DAY_PLURAL[d] ?? String(d)))} at ${time} (${tz})`,
    custom: (cron: string, tz: string) => `On the cron schedule "${cron}" (${tz})`,
    disabled: 'Scheduled runs are off until "Enabled" is ticked.',
  },

  // --- Providers ---
  providers: {
    intro:
      'Discovery prices date pairs across the whole window, without checking your constraints. Itinerary search, which runs only when a source below offers it, checks the cheapest of them for full itineraries with booking options.',
    markLine: (mark: string) => `Its prices carry the mark ${mark} where space is short.`,
    ageUnknownHint:
      "Vendor's cache age unknown: the vendor does not say how old its answer may be, so each price shows when this app fetched it.",
    emptyHeading: 'No price source is set up',
    emptyLead:
      'Searches find nothing until one is. Each source is set up with pnpm gmt setup (or in the .env file); docs/setup.md has the steps.',
    sources: [
      {
        id: 'travelpayouts',
        name: 'Travelpayouts (Aviasales cache)',
        what: "Cached prices from other people's recent searches, up to 48 hours old. Discovery only.",
        cost: 'Free; needs a free Travelpayouts token.',
        command: 'pnpm gmt setup --reconfigure travelpayouts',
        doc: 'or docs/setup.md section 2.',
      },
      {
        id: 'searchapi',
        name: 'SearchApi (Google Flights)',
        what: 'The Google date grid for discovery, and Google Flights itinerary search with booking options.',
        cost: 'Paid: one-off trial credits, or the $40-a-month plan; each run stops at its call cap.',
        command: 'pnpm gmt setup --reconfigure searchapi',
        doc: 'or docs/setup.md section 2.',
      },
      {
        id: 'camoufox',
        name: 'Camoufox (Google Flights in a browser on your machine)',
        what: 'Reads Google Flights prices one date pair a page, while this machine is on. Discovery only; off by default.',
        cost: 'Free; capped in pages a run (100 by default).',
        command: 'pnpm gmt setup --reconfigure browser',
        doc: 'after reading docs/setup.md section 14.',
      },
    ],
    whatLabel: 'What it is:',
    costLabel: 'Cost:',
    setupLabel: 'Set up:',
  },

  // --- History ---
  history: {
    runsWithoutPrice: (missing: number, total: number, subject: 'route' | 'itinerary') =>
      `${missing} of the ${total} ${noun(total, 'run', 'runs')} named above ${noun(missing, 'has', 'have')} no price for this ${subject}.`,
  },
} as const;
