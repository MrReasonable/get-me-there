import { describe, expect, it } from 'vitest';
import {
  STOP_DETAILS,
  type StopCause,
  type StopDetail,
  stopCauseSchema,
  stopTextSchema,
} from '../../src/api-contract/stopCause.js';
import { BUDGET_SCOPE_KINDS } from '../../src/errors.js';
import { NO_STOP_CAUSE_TEXT, type StopTextFacts, stopText } from '../../src/labels/stopCause.js';
import { findBannedWords } from '../../src/text/bannedWords.js';
import { SKIP_CODES } from '../../src/types/execution.js';
import { asIsoDateTime } from '../../src/types/ids.js';
import { providerIdSchema } from '../../src/types/provenance.js';

// Spec rev 55 §8.1 "Stop causes": every cause is one full sentence and one fix, from one template table.

const UNTIL = asIsoDateTime('2027-03-14T15:00:00.000Z');
const RESETS = asIsoDateTime('2027-03-31T23:00:00.000Z');
const F: StopTextFacts = { tz: 'Europe/London', mode: 'native', scheduled: false };

type Sources = Extract<StopCause, { kind: 'sources-unavailable' }>;
type Source = Sources['sources'][number];
type Budget = Extract<StopCause, { kind: 'budget' }>;

const browserDown: Source = {
  providerId: 'camoufox',
  skip: 'provider_unavailable',
  detail: 'provider-unavailable',
  until: null,
};
function sources(list: Sources['sources'], over: Partial<Omit<Sources, 'kind' | 'sources'>> = {}): Sources {
  return { kind: 'sources-unavailable', stage: 'discovery', searched: 0, sources: list, ...over };
}
function disabled(
  providerId: Source['providerId'],
  detail: StopDetail,
  until: Source['until'] = null,
): Source {
  return { providerId, skip: 'provider_disabled', detail, until };
}
function budget(over: Partial<Omit<Budget, 'kind'>>): Budget {
  return {
    kind: 'budget',
    scope: 'provider-execution',
    providerId: 'camoufox',
    unit: 'pages',
    cap: 100,
    resumeAfter: null,
    resetsAt: null,
    flights: null,
    ...over,
  };
}

const SEARCH_AGAIN = { text: 'Search again', command: null };
const START_NATIVE = { text: 'Start it with pnpm gmt start, then Search again', command: 'pnpm gmt start' };
const START_OTHER = { text: 'Start the browser worker, then Search again', command: null };
const CHECK_STATUS = { text: 'Check Status, then Search again', command: null };
const CHECK_PROVIDERS = { text: 'Check Providers, then Search again', command: null };
const RAISE = { text: 'Raise the limit in Edit, then Resume', command: null, resume: true };
const CARRY_ON = { text: 'Search again to carry on (prices already found are reused)', command: null };

type Row = [name: string, cause: StopCause, facts: Partial<StopTextFacts>, sentence: string, fix: unknown];

const ROWS: Row[] = [
  [
    'the browser worker not answering, nothing searched',
    sources([browserDown]),
    {},
    "The browser worker isn't answering, so nothing was searched.",
    START_NATIVE,
  ],
  [
    'the same in container mode',
    sources([browserDown]),
    { mode: 'container' },
    "The browser worker isn't answering, so nothing was searched.",
    START_OTHER,
  ],
  [
    'the same in dev mode (no command outside native mode)',
    sources([browserDown]),
    { mode: 'dev' },
    "The browser worker isn't answering, so nothing was searched.",
    START_OTHER,
  ],
  [
    'the browser worker stopped after 120 date pairs of a run of 405',
    sources([browserDown], { searched: 120 }),
    {},
    'The browser worker stopped answering, so the search stopped after 120 date pairs.',
    START_NATIVE,
  ],
  [
    'the browser worker stopped after 1 date pair',
    sources([browserDown], { searched: 1 }),
    {},
    'The browser worker stopped answering, so the search stopped after 1 date pair.',
    START_NATIVE,
  ],
  [
    'the browser worker stopped after 1,203 date pairs',
    sources([browserDown], { searched: 1203 }),
    {},
    'The browser worker stopped answering, so the search stopped after 1,203 date pairs.',
    START_NATIVE,
  ],
  [
    'the browser worker stopped while checking fares',
    sources([browserDown], { stage: 'verification', searched: 405 }),
    {},
    'The browser worker stopped answering, so the prices found were not checked.',
    START_NATIVE,
  ],
  [
    'the browser worker pausing until an instant',
    sources([disabled('camoufox', 'blocked', UNTIL)]),
    {},
    'The browser worker is pausing until 14 Mar 15:00, so nothing was searched.',
    { text: 'Search again after 14 Mar 15:00', command: null },
  ],
  [
    'the browser worker pausing after some date pairs',
    sources([disabled('camoufox', 'unusual-traffic', UNTIL)], { searched: 30 }),
    {},
    'The browser worker paused until 14 Mar 15:00, so the search stopped after 30 date pairs.',
    { text: 'Search again after 14 Mar 15:00', command: null },
  ],
  [
    'the browser profile signed in',
    sources([disabled('camoufox', 'signed-in')]),
    {},
    'The browser worker refused to load pages because its browser profile is signed in to an account, so nothing was searched.',
    CHECK_STATUS,
  ],
  [
    'the worker settings differing',
    sources([disabled('camoufox', 'settings-differ')]),
    {},
    "The browser worker refused to load pages because its settings differ from the app's, so nothing was searched.",
    CHECK_STATUS,
  ],
  [
    'the Aviasales token refused',
    sources([disabled('travelpayouts', 'auth')]),
    {},
    "The Aviasales cache couldn't be used because its token was refused, so nothing was searched.",
    CHECK_PROVIDERS,
  ],
  [
    'the SearchApi key refused',
    sources([disabled('searchapi', 'auth')]),
    {},
    "Google Flights via SearchApi couldn't be used because its API key was refused, so nothing was searched.",
    CHECK_PROVIDERS,
  ],
  [
    "the browser worker's key refused",
    sources([disabled('camoufox', 'auth')]),
    {},
    "The browser worker couldn't be used because its key was refused, so nothing was searched.",
    CHECK_STATUS,
  ],
  [
    'the Aviasales cache not answering',
    sources([{ ...browserDown, providerId: 'travelpayouts', detail: 'network' }]),
    {},
    "The Aviasales cache isn't answering, so nothing was searched.",
    CHECK_PROVIDERS,
  ],
  [
    'two sources',
    sources([browserDown, disabled('travelpayouts', 'auth')]),
    {},
    "The browser worker isn't answering and the Aviasales cache couldn't be used because its token was refused, so nothing was searched.",
    START_NATIVE,
  ],
  [
    'the monthly page limit, scheduled',
    budget({ scope: 'provider-month', resetsAt: RESETS }),
    { scheduled: true },
    "The browser worker's monthly page limit is used up; it resets on 1 Apr 00:00, and the next scheduled run picks these pages up.",
    { text: 'Search again after 1 Apr 00:00', command: null },
  ],
  [
    'the monthly page limit, unscheduled',
    budget({ scope: 'provider-month', resetsAt: RESETS }),
    {},
    "The browser worker's monthly page limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00', command: null },
  ],
  [
    'the monthly page limit with no reset stated',
    budget({ scope: 'provider-month', resetsAt: null }),
    {},
    "The browser worker's monthly page limit is used up.",
    SEARCH_AGAIN,
  ],
  [
    'the monthly scroll limit',
    budget({ scope: 'provider-month', unit: 'scrolls', resetsAt: RESETS }),
    {},
    "The browser worker's monthly scroll limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00', command: null },
  ],
  [
    "another source's monthly call limit, unscheduled",
    budget({
      scope: 'provider-month',
      providerId: 'travelpayouts',
      unit: 'calls',
      cap: 50_000,
      resetsAt: RESETS,
    }),
    {},
    "The Aviasales cache's monthly call limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00, or Resume', command: null, resume: true },
  ],
  [
    "another source's monthly call limit, scheduled with a resume set",
    budget({
      scope: 'provider-month',
      providerId: 'searchapi',
      unit: 'calls',
      cap: 1000,
      resetsAt: RESETS,
      resumeAfter: RESETS,
    }),
    { scheduled: true },
    "Google Flights via SearchApi's monthly call limit is used up; it resets on 1 Apr 00:00.",
    null,
  ],
  [
    "another source's monthly call limit, no reset stated",
    budget({ scope: 'provider-month', providerId: 'searchapi', unit: 'calls', cap: 1000 }),
    {},
    "Google Flights via SearchApi's monthly call limit is used up.",
    { text: 'Search again, or Resume', command: null, resume: true },
  ],
  [
    'the monthly page limit, scheduled, with no reset stated',
    budget({ scope: 'provider-month', resetsAt: null }),
    { scheduled: true },
    "The browser worker's monthly page limit is used up; the next scheduled run picks these pages up.",
    SEARCH_AGAIN,
  ],
  [
    "the monthly scroll limit, scheduled: the next run picks up scrolls, in the cause's unit",
    budget({ scope: 'provider-month', unit: 'scrolls', cap: 1500, resetsAt: RESETS }),
    { scheduled: true },
    "The browser worker's monthly scroll limit is used up; it resets on 1 Apr 00:00, and the next scheduled run picks these scrolls up.",
    { text: 'Search again after 1 Apr 00:00', command: null },
  ],
  [
    'the browser worker stopping at the start of checking fares',
    sources([browserDown], { stage: 'verification', searched: 0 }),
    {},
    'The browser worker stopped answering, so the prices found were not checked.',
    START_NATIVE,
  ],
  [
    'the per-run page limit with 8 of 10 flights read',
    budget({ flights: { read: 8, planned: 10 } }),
    {},
    'This search stopped at its limit of browser pages for one run; flights were read for 8 of 10 date pairs.',
    CARRY_ON,
  ],
  [
    'the per-run page limit with 10 of 10 flights read',
    budget({ flights: { read: 10, planned: 10 } }),
    {},
    'This search stopped at its limit of browser pages for one run; flights were read for 10 of 10 date pairs.',
    CARRY_ON,
  ],
  [
    'the per-run page limit when the flight step did not run',
    budget({ flights: null }),
    { scheduled: true },
    'This search stopped at its limit of browser pages for one run.',
    CARRY_ON,
  ],
  [
    'the per-run scroll limit',
    budget({ unit: 'scrolls', cap: 588 }),
    {},
    'This search stopped at its limit of page scrolls for one run.',
    CARRY_ON,
  ],
  [
    "another source's per-run call limit",
    budget({ providerId: 'searchapi', unit: 'calls', cap: 20 }),
    {},
    'This search stopped at its limit of calls to Google Flights via SearchApi for one run.',
    CARRY_ON,
  ],
  [
    'the per-run call limit',
    budget({ scope: 'execution-calls', providerId: null, unit: 'calls', cap: 6 }),
    {},
    'This search stopped at its limit of calls for one run.',
    RAISE,
  ],
  [
    'the per-run free-call limit',
    budget({ scope: 'execution-free-calls', providerId: null, unit: 'calls', cap: 200 }),
    {},
    'This search stopped at its limit of free calls for one run.',
    RAISE,
  ],
  [
    'the per-run spending limit of 500 p',
    budget({ scope: 'execution-cost', providerId: null, unit: 'pence', cap: 500 }),
    {},
    'This search stopped at £5, its spending limit for one run.',
    RAISE,
  ],
  [
    'the per-run spending limit of 250 p',
    budget({ scope: 'execution-cost', providerId: null, unit: 'pence', cap: 250 }),
    {},
    'This search stopped at £2.50, its spending limit for one run.',
    RAISE,
  ],
  [
    "SearchApi's plan used up",
    budget({ scope: 'provider-lifetime', providerId: 'searchapi', unit: 'calls', cap: 100 }),
    {},
    'Google Flights via SearchApi has no calls left on its plan.',
    { text: 'Check Providers', command: null },
  ],
  [
    "the month's spending limit, scheduled with a resume set",
    budget({
      scope: 'global-month',
      providerId: null,
      unit: 'pence',
      cap: 3500,
      resetsAt: RESETS,
      resumeAfter: RESETS,
    }),
    { scheduled: true },
    "This month's spending limit is used up; it resets on 1 Apr 00:00.",
    null,
  ],
  [
    "the month's spending limit, unscheduled",
    budget({ scope: 'global-month', providerId: null, unit: 'pence', cap: 3500, resetsAt: RESETS }),
    {},
    "This month's spending limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00, or Resume', command: null, resume: true },
  ],
  [
    "the month's spending limit, scheduled but no resume stored",
    budget({ scope: 'global-month', providerId: null, unit: 'pence', cap: 3500, resetsAt: RESETS }),
    { scheduled: true },
    "This month's spending limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00, or Resume', command: null, resume: true },
  ],
  [
    "the month's spending limit, no reset stated",
    budget({ scope: 'global-month', providerId: null, unit: 'pence', cap: 3500 }),
    {},
    "This month's spending limit is used up.",
    { text: 'Search again, or Resume', command: null, resume: true },
  ],
  [
    "the month's spending limit naming the browser worker (the guard's provider) is still the month's",
    budget({ scope: 'global-month', providerId: 'camoufox', unit: 'pence', cap: 3500, resetsAt: RESETS }),
    { scheduled: true },
    "This month's spending limit is used up; it resets on 1 Apr 00:00.",
    { text: 'Search again after 1 Apr 00:00, or Resume', command: null, resume: true },
  ],
  [
    'the per-run call limit naming the provider whose reserve tripped it',
    budget({ scope: 'execution-calls', providerId: 'searchapi', unit: 'calls', cap: 6 }),
    {},
    'This search stopped at its limit of calls for one run.',
    RAISE,
  ],
  [
    'the per-run spending limit naming a provider',
    budget({ scope: 'execution-cost', providerId: 'camoufox', unit: 'pence', cap: 500 }),
    {},
    'This search stopped at £5, its spending limit for one run.',
    RAISE,
  ],
  [
    'a limiter pause on a scheduled search with a resume set',
    { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: UNTIL },
    { scheduled: true },
    'The Aviasales cache is limiting how fast it answers; this search resumes at 14 Mar 15:00.',
    null,
  ],
  [
    'a limiter pause on an unscheduled search (ruling A7: never an automatic resume)',
    { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: UNTIL },
    {},
    'The Aviasales cache is limiting how fast it answers.',
    { text: 'Resume', command: null, resume: true },
  ],
  [
    'a limiter pause with no resume',
    { kind: 'limiter-timeout', providerId: 'camoufox', resumeAfter: null },
    { scheduled: true },
    'The browser worker is limiting how fast it answers.',
    { text: 'Resume', command: null, resume: true },
  ],
  ['cancelled', { kind: 'cancelled' }, {}, 'Stopped by you.', SEARCH_AGAIN],
  [
    'superseded by Search again',
    { kind: 'superseded', by: 'search-again' },
    {},
    'Replaced by a search you started.',
    null,
  ],
  [
    'superseded by a schedule',
    { kind: 'superseded', by: 'schedule' },
    {},
    'Replaced by a scheduled run.',
    null,
  ],
  [
    'superseded as stale',
    { kind: 'superseded', by: 'stale' },
    {},
    'Too old to carry on; a fresh run replaced it.',
    null,
  ],
  [
    'superseded by Remove',
    { kind: 'superseded', by: 'remove' },
    {},
    'Stopped when the search was removed.',
    null,
  ],
  ['never started', { kind: 'never-started' }, {}, 'This run never started.', SEARCH_AGAIN],
  [
    'interrupted',
    { kind: 'interrupted' },
    {},
    'The app stopped during this search.',
    { text: 'Resume, or Search again', command: null, resume: true },
  ],
  [
    'fatal',
    { kind: 'fatal' },
    {},
    'The app hit an error and stopped this search.',
    { text: 'Check Status, then Resume', command: null, resume: true },
  ],
  ['child cap', { kind: 'child-cap' }, {}, "Stopped at the on-demand search's limit.", null],
  [
    'a tool run that failed',
    { kind: 'tool', ended: 'failed' },
    {},
    'The tool run failed before it finished.',
    null,
  ],
  ['a tool run stopped', { kind: 'tool', ended: 'aborted' }, {}, 'The tool run was stopped.', null],
  [
    'skipped for its confirmation, 120 p against 100 p',
    { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: 100 },
    { scheduled: true },
    "Skipped: today's estimate (about £1.20) is above the confirmation you gave when you set the schedule (£1.00).",
    { text: "Change the schedule's confirmation in Edit", command: null },
  ],
  [
    'skipped for its confirmation, whole pounds',
    { kind: 'skipped-confirm', estimatePence: 300, confirmedPence: 200 },
    { scheduled: true },
    "Skipped: today's estimate (about £3) is above the confirmation you gave when you set the schedule (£2).",
    { text: "Change the schedule's confirmation in Edit", command: null },
  ],
  [
    'skipped for its confirmation on calls, the pence covered',
    { kind: 'skipped-confirm', estimatePence: 0, confirmedPence: 0 },
    { scheduled: true },
    "Skipped: today's estimate (about £0) needs more calls than the confirmation you gave when you set the schedule.",
    { text: "Change the schedule's confirmation in Edit", command: null },
  ],
  [
    'three sources',
    sources([browserDown, disabled('travelpayouts', 'auth'), disabled('searchapi', 'quota')]),
    { mode: 'container' },
    "The browser worker isn't answering, the Aviasales cache couldn't be used because its token was refused and Google Flights via SearchApi couldn't be used because its plan has no calls left, so nothing was searched.",
    START_OTHER,
  ],
  [
    'four sources whose full clauses would not fit one sentence',
    sources(
      [
        disabled('camoufox', 'grid-unverified'),
        disabled('travelpayouts', 'consent-unhandled'),
        disabled('searchapi', 'off-allowlist'),
        disabled('fixture', 'free-call-cap'),
      ],
      { stage: 'verification' },
    ),
    {},
    "The browser worker, the Aviasales cache, Google Flights via SearchApi and the test source couldn't be used, so the prices found were not checked.",
    CHECK_STATUS,
  ],
  [
    'skipped for its confirmation, the confirmation with pence',
    { kind: 'skipped-confirm', estimatePence: 300, confirmedPence: 250 },
    { scheduled: true },
    "Skipped: today's estimate (about £3.00) is above the confirmation you gave when you set the schedule (£2.50).",
    { text: "Change the schedule's confirmation in Edit", command: null },
  ],
  [
    'skipped with no confirmation given',
    { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: null },
    { scheduled: true },
    "Skipped: today's estimate (about £1.20) needs a confirmation, and none was given when the schedule was set.",
    { text: "Change the schedule's confirmation in Edit", command: null },
  ],
  [
    'skipped outside the window',
    { kind: 'skipped-window' },
    {},
    "Skipped: outside this search's window.",
    null,
  ],
  [
    'skipped at half the cadence',
    { kind: 'skipped-missed', code: 'half-cadence' },
    {},
    'Skipped: the next scheduled run was less than half the gap away.',
    null,
  ],
  [
    'skipped as browser-only',
    { kind: 'skipped-missed', code: 'browser-only-definition' },
    {},
    'Skipped: only the browser worker could run it, and a catch-up loads no browser pages.',
    null,
  ],
];

const SKIPPED_BUDGET: Array<[Extract<StopCause, { kind: 'skipped-budget' }>, string]> = [
  [
    { kind: 'skipped-budget', scope: 'global-month', providerId: null },
    "Skipped: this month's spending limit is used up.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-month', providerId: 'camoufox' },
    "Skipped: the browser worker's monthly page limit is used up.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-month', providerId: 'travelpayouts' },
    "Skipped: the Aviasales cache's monthly call limit is used up.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-month', providerId: null },
    "Skipped: a source's monthly call limit is used up.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-lifetime', providerId: 'searchapi' },
    'Skipped: Google Flights via SearchApi has no calls left on its plan.',
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-lifetime', providerId: null },
    'Skipped: a source has no calls left on its plan.',
  ],
  [
    { kind: 'skipped-budget', scope: 'global-month', providerId: 'camoufox' },
    "Skipped: this month's spending limit is used up.",
  ],
  [
    { kind: 'skipped-budget', scope: 'execution-cost', providerId: 'searchapi' },
    "Skipped: the estimate is above this search's spending limit for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'execution-calls', providerId: null },
    "Skipped: the estimate is above this search's limit of calls for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'execution-free-calls', providerId: null },
    "Skipped: the estimate is above this search's limit of free calls for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'execution-cost', providerId: null },
    "Skipped: the estimate is above this search's spending limit for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-execution', providerId: 'camoufox' },
    "Skipped: the estimate is above this search's limit of browser pages for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-execution', providerId: 'searchapi' },
    "Skipped: the estimate is above this search's limit of calls to Google Flights via SearchApi for one run.",
  ],
  [
    { kind: 'skipped-budget', scope: 'provider-execution', providerId: null },
    "Skipped: the estimate is above this search's limit of calls to a source for one run.",
  ],
];

describe('stopText (spec rev 55 §8.1 "Stop causes")', () => {
  it.each(ROWS)('%s', (_name, cause, facts, sentence, fix) => {
    expect(stopText(cause, { ...F, ...facts })).toEqual({ sentence, fix });
  });

  it.each(SKIPPED_BUDGET)('skipped-budget %j', (cause, sentence) => {
    expect(stopText(cause, F)).toEqual({ sentence, fix: null });
  });

  it('reads a row stopped before causes were stored as NO_STOP_CAUSE_TEXT', () => {
    expect(NO_STOP_CAUSE_TEXT).toEqual({
      sentence: 'No reason was recorded for this run.',
      fix: { text: 'Search again', command: null },
    });
  });

  it('words every STOP_DETAILS word for every source, so no raw class word reaches a sentence', () => {
    for (const providerId of providerIdSchema.options) {
      for (const detail of STOP_DETAILS) {
        const t = stopText(sources([disabled(providerId, detail)]), F);
        expect(t.sentence, `${providerId} ${detail}`).toMatch(/ because .+, so nothing was searched\.$/);
        // why: a class word is lower-case and hyphenated; the sentence must word it, never print it
        if (detail.includes('-')) expect(t.sentence).not.toContain(detail);
        expect(t.sentence).not.toMatch(new RegExp(`because ${detail}\\b`));
      }
    }
  });

  it('words each STOP_DETAILS word as the table pins it, and the browser worker refuses only for its own checks', () => {
    // why: a pinned copy of the template table, so a changed or emptied phrase fails here (spec rev 55 §8.1)
    const REASON: Record<StopDetail, string> = {
      auth: 'its key was refused',
      'rate-limit': 'it asked the app to slow down',
      quota: 'its plan has no calls left',
      upstream: 'its service was failing',
      parse: "its answers couldn't be read",
      network: 'the connection to it failed',
      'limiter-timeout': 'it was limiting how fast it answers',
      blocked: 'it stopped at a page it will not go past',
      'provider-unavailable': "it isn't answering",
      captcha: 'a page asked for a check it does not answer',
      'unusual-traffic': 'a page reported unusual traffic',
      'signed-in': 'its browser profile is signed in to an account',
      'consent-unhandled': "a consent page appeared that it couldn't answer",
      'sign-in': 'a page asked it to sign in',
      'off-allowlist': 'a page led away from the sites it may load',
      unrecognised: "a page appeared that it didn't recognise",
      'settings-differ': "its settings differ from the app's",
      'grid-unverified': "its date-grid reading hasn't been checked on this install",
      'counts-unreadable': "its page counts couldn't be read",
      'no-airport-names': 'the airports have no names it can match',
      'none-for-cell': 'its page listed nothing for these dates and airports',
      unparsed: "its page couldn't be read",
      'monthly-cap': 'its monthly limit is used up',
      'execution-cap': "this search's limit for one run is used up",
      'free-call-cap': "this search's limit of free calls is used up",
      'outside-browser-window': 'it is outside its set hours',
      fatal: 'it hit an error',
      aborted: 'the search was stopped',
    };
    const REFUSALS = new Set<StopDetail>([
      'blocked',
      'captcha',
      'unusual-traffic',
      'signed-in',
      'consent-unhandled',
      'sign-in',
      'off-allowlist',
      'unrecognised',
      'settings-differ',
      'grid-unverified',
      'counts-unreadable',
      'monthly-cap',
      'outside-browser-window',
    ]);
    for (const detail of STOP_DETAILS) {
      expect(stopText(sources([disabled('fixture', detail)]), F).sentence).toBe(
        `The test source couldn't be used because ${REASON[detail]}, so nothing was searched.`,
      );
      const verb = REFUSALS.has(detail) ? 'refused to load pages' : "couldn't be used";
      expect(stopText(sources([disabled('camoufox', detail)]), F).sentence).toBe(
        `The browser worker ${verb} because ${REASON[detail]}, so nothing was searched.`,
      );
    }
  });

  it('gives each STOP_DETAILS word its own words (no two details read the same)', () => {
    const seen = new Map<string, string>();
    for (const detail of STOP_DETAILS) {
      const s = stopText(sources([disabled('fixture', detail)]), F).sentence;
      expect(seen.get(s), `${detail} reads as ${seen.get(s) ?? ''}`).toBeUndefined();
      seen.set(s, detail);
    }
  });

  describe('every sentence the table can produce', () => {
    const facts: StopTextFacts[] = [];
    for (const mode of ['native', 'container', 'dev'] as const)
      for (const scheduled of [true, false]) facts.push({ tz: 'Europe/London', mode, scheduled });
    const causes: StopCause[] = [...ROWS.map((r) => r[1]), ...SKIPPED_BUDGET.map((r) => r[0])];
    for (const providerId of providerIdSchema.options) {
      for (const detail of STOP_DETAILS) {
        causes.push(sources([disabled(providerId, detail)]));
        causes.push(sources([disabled(providerId, detail, UNTIL)], { stage: 'verification' }));
        causes.push(
          sources([{ providerId, skip: 'provider_unavailable', detail, until: null }], { searched: 9 }),
        );
      }
      for (const scope of BUDGET_SCOPE_KINDS) {
        for (const unit of ['calls', 'pages', 'scrolls', 'pence'] as const) {
          causes.push(
            budget({ scope, providerId, unit, resetsAt: RESETS, flights: { read: 2, planned: 10 } }),
          );
          causes.push(budget({ scope, providerId: null, unit, resumeAfter: RESETS }));
        }
        causes.push({ kind: 'skipped-budget', scope, providerId });
      }
      causes.push({ kind: 'limiter-timeout', providerId, resumeAfter: UNTIL });
    }
    for (const code of SKIP_CODES) causes.push({ kind: 'skipped-missed', code });
    // why: the generated set crosses every scope with every unit and provider; only the causes the schema stores are
    // worded, and the pinned rows above must all be among them
    const stored = causes.filter((c) => stopCauseSchema.safeParse(c).success);
    const all = stored.flatMap((c) => facts.map((f) => ({ c, f, t: stopText(c, f) })));

    it('covers every pinned row, and a stored budget cause of every scope', () => {
      for (const [name, cause] of ROWS) expect(stopCauseSchema.safeParse(cause).success, name).toBe(true);
      for (const [cause] of SKIPPED_BUDGET) expect(stopCauseSchema.safeParse(cause).success).toBe(true);
      const scopes = new Set(stored.flatMap((c) => (c.kind === 'budget' ? [c.scope] : [])));
      expect([...scopes].sort()).toEqual([...BUDGET_SCOPE_KINDS].sort());
    });

    it('fits the stop-text schema', () => {
      for (const { c, t } of all) expect(stopTextSchema.safeParse(t).success, JSON.stringify(c)).toBe(true);
    });

    it('is a full sentence: a capital first letter, a full stop last, no caller prefix', () => {
      for (const { t } of all) {
        expect(t.sentence).toMatch(/^[A-Z].*\.$/);
        if (t.sentence.startsWith('Skipped:')) continue;
        expect(t.sentence).not.toMatch(/^(Stopped|Paused):/);
      }
    });

    it('starts "Skipped:" only for a skipped cause', () => {
      for (const { c, t } of all)
        expect(t.sentence.startsWith('Skipped:')).toBe(c.kind.startsWith('skipped-'));
    });

    it('holds the main-path words: no banned word, no bare "error", no "definition", "cell" or "hard stop"', () => {
      for (const { t } of all) {
        const words = [t.sentence, t.fix?.text ?? ''];
        for (const w of words) {
          expect(findBannedWords(w), w).toEqual([]);
          expect(w).not.toMatch(/(?<!an )\berror\b/i);
          expect(w).not.toMatch(/definition|\bcells?\b|hard stop|camoufox|travelpayouts|discovery/i);
        }
      }
    });

    it('gives a command only in native mode, and only a pnpm gmt line', () => {
      for (const { f, t } of all) {
        if (t.fix?.command == null) continue;
        expect(f.mode).toBe('native');
        expect(t.fix.command.startsWith('pnpm gmt ')).toBe(true);
      }
    });

    it('never offers Resume for a browser page limit, monthly or per run', () => {
      for (const { c, t } of all) {
        if (c.kind !== 'budget' || c.providerId !== 'camoufox') continue;
        if (c.scope !== 'provider-month' && c.scope !== 'provider-execution') continue;
        expect(t.fix?.text ?? '').not.toMatch(/Resume/);
        // why: the structured flag the web reads, never matched on words
        expect(t.fix?.resume).toBeUndefined();
      }
    });

    it('never promises an automatic resume to an unscheduled search', () => {
      for (const { f, t } of all)
        if (!f.scheduled) expect(t.sentence).not.toMatch(/resumes|picks these pages up/);
    });
  });
});

describe('the structured resume flag on a fix (review finding 10)', () => {
  it('is set exactly when the fix offers Resume, and absent on a fresh-search fix and on NO_STOP_CAUSE_TEXT', () => {
    const facts = { tz: 'Europe/London', mode: 'native', scheduled: true } as const;
    expect(stopText({ kind: 'interrupted' }, facts).fix?.resume).toBe(true);
    expect(stopText({ kind: 'cancelled' }, facts).fix?.resume).toBeUndefined();
    expect(NO_STOP_CAUSE_TEXT.fix?.resume).toBeUndefined();
  });
});
