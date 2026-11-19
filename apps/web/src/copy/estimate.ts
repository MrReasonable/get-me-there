import type { ProviderId } from '@gmt/core';

/**
 * The estimate sentence's words (spec rev 55 §11 "The estimate sentence"; design 2026-11-08 Ruling 13): the sentence
 * beside the new-search panel's Search, Search again's second look, Save and search again and Repeat weekly's Save, and
 * the notes under it. A free run reads as the mockup's "About 25 min, free. Then flights are read for the cheapest dates
 * until the 5 cheapest stop changing." They live apart from `src/copy.ts`, as the plan and set-up words do;
 * `test/copy/estimateCatalogue.test.ts` sweeps every string here for the spec §11 banned words and the main path's words
 * ("date pair", "reused"). Coverage is worded as what is asked, never as prices found ("priced", "prices for", "all
 * combinations" and "will find" never appear); counts arrive already grouped ("9,880") and money already formatted by
 * the estimate panel's formatter.
 */

const noun = (n: number | string, one: string, many: string): string => (String(n) === '1' ? one : many);

export const ESTIMATE_COPY = {
  /** Joins the cost tags of several billed sources on a button ("Search · 120 SearchApi calls · …"). */
  separator: ' · ',
  /** Joins the clauses of one sentence ("About 3 hours, about £1.20, asks about …"). */
  clause: ', ',
  /** Ends each sentence; the sentences of the line are joined by a space. */
  stop: '.',
  underAMinute: 'under a minute',
  aboutMinutes: (n: number) => `about ${n} min`,
  // why: "about 1 hour", "about 1½ hours": a half takes the plural, as it is read aloud
  aboutHours: (whole: number, half: boolean) =>
    `about ${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'hour' : 'hours'}`,
  // the same lengths without "about" (kept for callers that word a length after their own "about")
  minutes: (n: number) => `${n} min`,
  hours: (whole: number, half: boolean) =>
    `${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'hour' : 'hours'}`,
  free: 'free',
  about: (money: string) => `about ${money}`,
  asksSome: (asked: string, total: string) =>
    `asks about ${asked} of ${total} ${noun(total, 'date', 'dates')}`,
  thisRun: 'this run',
  partly: (n: string) => `(${n} on some airports only)`,
  kept: (n: string) => `(${n} kept from earlier searches)`,
  restAgain: 'the rest when you search again',
  restNext: (day: string) => `the rest next ${day}`,
  restScheduled: 'the rest at the next scheduled run',
  nothingNew: (n: string) =>
    `Nothing new to ask: ${n} ${noun(n, 'date', 'dates')} kept from earlier searches`,
  nothingToAsk: 'Nothing can be asked this run',
  cachedOnly: 'cached prices only where travellers searched recently',
  // why: ruling 20.5 concern 2 (spec rev 55 §11): the browser's flight lists after the first pass, outbound only
  flights: (dates: string, duration: string) =>
    `Then flights are read for up to ${dates} ${noun(dates, 'date', 'dates')}, ${duration}`,
  // design 2026-11-08 §6, Ruling 13: with the return leg the step reads flights until more reading stops finding cheaper
  // trips (core's CONFIRM_TARGET), so the sentence says the rule, not how many pages; the dates read go in a note
  flightsUntilSettled: (target: number) =>
    `Then flights are read for the cheapest dates until the ${target} cheapest stop changing`,
  flightsDates: (typical: string, most: string) =>
    `usually about ${typical} ${noun(typical, 'date', 'dates')}, at most ${most}`,
  // why: controller ruling R9 — SearchApi's unit is credits; the other sources keep "calls"
  unit: (id: ProviderId, n: string) => (id === 'searchapi' ? noun(n, 'credit', 'credits') : 'calls'),
  billed: (calls: string, left: string, name: string, window: 'month' | 'lifetime', unit: string) =>
    window === 'month'
      ? `uses about ${calls} of the ${left} ${name} ${unit} left this month`
      : `uses about ${calls} of the ${left} ${name} ${unit} left on your trial`,
  billedNoCap: (calls: string, name: string, unit: string) => `uses about ${calls} ${name} ${unit}`,
  callsTag: (calls: string, name: string, unit: string) => `${calls} ${name} ${unit}`,
  withTag: (verb: string, tag: string) => `${verb} · ${tag}`,
  notUsed: (source: string, why: string, cost: string | null) =>
    `${source} is not used: ${why}${cost === null ? '' : ` (about ${cost} not included)`}`,
  // why: a blocked line names the budget scope that blocked it (engine checkBudget); the browser's run scope is pages
  blockedWhy: {
    'execution-calls': "over this search's limit of paid calls a run",
    'execution-free-calls': "over this search's limit of free calls a run",
    'execution-cost': "over this search's spending limit a run",
    // why: design 2026-11-08 §4.8: the browser's per-run flight allowance is withdrawn (its page cap was, spec rev 65),
    // so a stored stop at this scope is named without an allowance
    'provider-execution': 'a limit on its pages stops it this run',
    'provider-month': 'no calls left this month',
    'provider-lifetime': 'no trial searches left',
    'global-month': "this month's spending limit is reached",
    unknown: 'a limit stops it this run',
  },
  /** The two provider windows' stop words when the source is SearchApi, whose unit is credits. */
  blockedWhySearchApi: {
    'provider-month': 'no credits left this month',
    'provider-lifetime': 'no trial credits left',
  },
  softCost: (estimate: string, threshold: string, press: string) =>
    `This costs about ${estimate}, above your ${threshold} check; pressing ${press} confirms it`,
  softShare: (name: string, window: 'month' | 'lifetime', press: string, unit: string) =>
    window === 'month'
      ? `This uses more than a fifth of this month's ${name} ${unit}; pressing ${press} confirms it`
      : `This uses more than a fifth of your ${name} trial ${unit}; pressing ${press} confirms it`,
  /** The billable-plan sources by the name their calls are counted in ("120 SearchApi credits"). */
  callsOf: {
    searchapi: 'SearchApi',
    travelpayouts: 'Aviasales',
    camoufox: 'browser',
    fixture: 'test source',
  } satisfies Record<ProviderId, string>,
  /** Cron day-of-week (0 = Sunday) as "the rest next Monday" says it. */
  dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const;
