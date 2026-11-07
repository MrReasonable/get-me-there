import type { ProviderId } from '@gmt/core';

/**
 * The estimate sentence's words (spec rev 55 §11 "The estimate sentence"; WP20 Task 20.5): the one sentence beside
 * Search now, Search again's second look, Save and search again and Repeat weekly's Save, and the notes under it. They
 * live apart from `src/copy.ts`, as the plan and set-up words do; `test/copy/estimateCatalogue.test.ts` sweeps every
 * string here for the spec §11 banned words. Coverage is worded as what is asked, never as prices found ("priced",
 * "prices for", "all combinations" and "will find" never appear); counts arrive already grouped ("9,880") and money
 * already formatted by the estimate panel's formatter.
 */

const noun = (n: number | string, one: string, many: string): string => (String(n) === '1' ? one : many);

export const ESTIMATE_COPY = {
  separator: ' · ',
  underAMinute: 'under a minute',
  aboutMinutes: (n: number) => `about ${n} ${noun(n, 'minute', 'minutes')}`,
  // why: "about 1 hour", "about 1½ hours": a half takes the plural, as it is read aloud
  aboutHours: (whole: number, half: boolean) =>
    `about ${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'hour' : 'hours'}`,
  // the same lengths without "about", for a clause that says "usually about" once before two figures
  minutes: (n: number) => `${n} ${noun(n, 'minute', 'minutes')}`,
  hours: (whole: number, half: boolean) =>
    `${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'hour' : 'hours'}`,
  free: 'free',
  about: (money: string) => `about ${money}`,
  asksAll: (total: string) => `asks about all ${total} date ${noun(total, 'pair', 'pairs')}`,
  asksSome: (asked: string, total: string) =>
    `asks about ${asked} of ${total} date ${noun(total, 'pair', 'pairs')}`,
  thisRun: 'this run',
  partly: (n: string) => `(${n} on some airports only)`,
  reused: (n: string) => `(${n} reused from earlier runs)`,
  restAgain: 'the rest when you search again',
  restNext: (day: string) => `the rest next ${day}`,
  restScheduled: 'the rest at the next scheduled run',
  nothingNew: (n: string) =>
    `Nothing new to ask: ${n} date ${noun(n, 'pair', 'pairs')} reused from earlier runs`,
  nothingToAsk: 'Nothing can be asked this run',
  cachedOnly: 'cached prices only where travellers searched recently',
  // why: ruling 20.5 concern 2 (spec rev 55 §11): the browser worker's flight lists after the first pass
  flights: (pairs: string, duration: string) =>
    `+ flights for up to ${pairs} date ${noun(pairs, 'pair', 'pairs')}, ${duration}`,
  // spec rev 56 §8.1 "Estimate" (R-estimate): with the return leg, the typical pages and time and the bound
  flightsOutAndBack: (
    pairs: string,
    pages: string,
    duration: string,
    pagesMax: string,
    durationMax: string,
  ) =>
    `+ flights, out and back, for up to ${pairs} date ${noun(pairs, 'pair', 'pairs')}: usually about ${pages} ${noun(pages, 'page', 'pages')} and ${duration}, at most ${pagesMax} ${noun(pagesMax, 'page', 'pages')} and ${durationMax}`,
  billed: (calls: string, left: string, name: string, window: 'month' | 'lifetime') =>
    window === 'month'
      ? `uses about ${calls} of the ${left} ${name} searches left this month`
      : `uses about ${calls} of the ${left} ${name} searches left on your trial`,
  billedNoCap: (calls: string, name: string) => `uses about ${calls} ${name} searches`,
  searchesTag: (calls: string, name: string) => `${calls} ${name} searches`,
  withTag: (verb: string, tag: string) => `${verb} · ${tag}`,
  notUsed: (source: string, why: string, cost: string | null) =>
    `${source} is not used: ${why}${cost === null ? '' : ` (about ${cost} not included)`}`,
  // why: a blocked line names the budget scope that blocked it (engine checkBudget); the browser's run scope is pages
  blockedWhy: {
    'execution-calls': "over this search's limit of paid calls a run",
    'execution-free-calls': "over this search's limit of free calls a run",
    'execution-cost': "over this search's spending limit a run",
    'provider-execution': 'over its page allowance for one run',
    'provider-month': 'no calls left this month',
    'provider-lifetime': 'no trial searches left',
    'global-month': "this month's spending limit is reached",
    unknown: 'a limit stops it this run',
  },
  softCost: (estimate: string, threshold: string, press: string) =>
    `This costs about ${estimate}, above your ${threshold} check; pressing ${press} confirms it`,
  softShare: (name: string, window: 'month' | 'lifetime', press: string) =>
    window === 'month'
      ? `This uses more than a fifth of this month's ${name} searches; pressing ${press} confirms it`
      : `This uses more than a fifth of your ${name} trial searches; pressing ${press} confirms it`,
  /** The billable-plan sources by the name their calls are counted in ("120 SearchApi searches"). */
  searchesOf: {
    searchapi: 'SearchApi',
    travelpayouts: 'Aviasales',
    camoufox: 'browser',
    fixture: 'test source',
  } satisfies Record<ProviderId, string>,
  /** Cron day-of-week (0 = Sunday) as "the rest next Monday" says it. */
  dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const;
