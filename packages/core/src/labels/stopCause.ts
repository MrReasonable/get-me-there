import type { BudgetUnit, StopCause, StopDetail, StopText } from '../api-contract/stopCause.js';
import { BLOCKED_PAGES } from '../camoufox/protocol.js';
import { formatInstantShort } from '../status/time.js';
import { formatPence, groupThousands } from '../text/money.js';
import type { SkipCode } from '../types/execution.js';
import type { IsoDateTime } from '../types/ids.js';
import type { ProviderId } from '../types/provenance.js';
import { mainPathSource } from './mainPath.js';

// Spec revision 55 §8.1 "Stop causes": every stored cause is worded here, from one template table, as one full sentence
// and one fix. Sources are named through their main-path names (§3, `mainPathSource`), instants as "14 Mar 15:00"
// (`formatInstantShort`), money through core's pence formatter. No caller adds a prefix; no sentence starts "Stopped:"
// or "Paused:" (only the skipped rows start "Skipped:"); no stored detail word is ever printed as it is.

/** What `stopText` needs besides the cause: the display zone, how the app runs, and whether the search is scheduled. */
export interface StopTextFacts {
  tz: string;
  /** `native`: `pnpm gmt` on this machine, so a fix may name a command; `container` and `dev`: never. */
  mode: 'native' | 'container' | 'dev';
  /** `isScheduled(def)` read now: only a scheduled search is promised an automatic resume or a next scheduled run. */
  scheduled: boolean;
}

type Fix = NonNullable<StopText['fix']>;
type Sources = Extract<StopCause, { kind: 'sources-unavailable' }>;
type Source = Sources['sources'][number];
type Budget = Extract<StopCause, { kind: 'budget' }>;

/** A row stopped before causes were stored (migration 0011) reads this, whatever its `error_text` holds (§8.1). */
export const NO_STOP_CAUSE_TEXT: StopText = {
  sentence: 'No reason was recorded for this run.',
  fix: { text: 'Search again', command: null },
};

const fix = (text: string): Fix => ({ text, command: null });
const SEARCH_AGAIN = fix('Search again');
const CHECK_STATUS = fix('Check Status, then Search again');
const CHECK_PROVIDERS = fix('Check Providers, then Search again');
const RAISE_AND_RESUME = fix('Raise the limit in Edit, then Resume');
// why: Ian's ruling (2026-10-31): a browser page limit, monthly or per run, offers a fresh run and never Resume (a
// resume past the run's browser window reads no browser pages); a fresh run reuses the prices already found.
const CARRY_ON = fix('Search again to carry on (prices already found are reused)');

/** What a source's key is called in a refused-key sentence. */
const KEY_WORD: Readonly<Record<ProviderId, string>> = {
  travelpayouts: 'token',
  searchapi: 'API key',
  camoufox: 'key',
  fixture: 'key',
};

/**
 * Every `STOP_DETAILS` word as the end of a "because …" clause (a table over the whole enum, so no class word reaches a
 * sentence). `auth` names the source's own key word.
 */
const DETAIL_REASON: Readonly<Record<StopDetail, (id: ProviderId) => string>> = {
  auth: (id) => `its ${KEY_WORD[id]} was refused`,
  'rate-limit': () => 'it asked the app to slow down',
  quota: () => 'its plan has no calls left',
  upstream: () => 'its service was failing',
  parse: () => "its answers couldn't be read",
  network: () => 'the connection to it failed',
  'limiter-timeout': () => 'it was limiting how fast it answers',
  blocked: () => 'it stopped at a page it will not go past',
  'provider-unavailable': () => "it isn't answering",
  captcha: () => 'a page asked for a check it does not answer',
  'unusual-traffic': () => 'a page reported unusual traffic',
  'signed-in': () => 'its browser profile is signed in to an account',
  'consent-unhandled': () => "a consent page appeared that it couldn't answer",
  'sign-in': () => 'a page asked it to sign in',
  'off-allowlist': () => 'a page led away from the sites it may load',
  unrecognised: () => "a page appeared that it didn't recognise",
  'settings-differ': () => "its settings differ from the app's",
  'grid-unverified': () => "its date-grid reading hasn't been checked on this install",
  'counts-unreadable': () => "its page counts couldn't be read",
  'no-airport-names': () => 'the airports have no names it can match',
  'none-for-cell': () => 'its page listed nothing for these dates and airports',
  unparsed: () => "its page couldn't be read",
  'monthly-cap': () => 'its monthly limit is used up',
  'execution-cap': () => "this search's limit for one run is used up",
  'free-call-cap': () => "this search's limit of free calls is used up",
  'outside-browser-window': () => 'it is outside its set hours',
  fatal: () => 'it hit an error',
  aborted: () => 'the search was stopped',
};

/**
 * The details that are the browser worker's own refusal to load pages (its blocked pages, its settings and grid checks,
 * its monthly count and hours); every other detail, and every other source, reads "couldn't be used because …".
 */
const WORKER_REFUSALS: ReadonlySet<StopDetail> = new Set<StopDetail>([
  'blocked',
  ...BLOCKED_PAGES,
  'settings-differ',
  'grid-unverified',
  'counts-unreadable',
  'monthly-cap',
  'outside-browser-window',
]);

const SKIP_CODE_SENTENCE: Readonly<Record<SkipCode, string>> = {
  'half-cadence': 'the next scheduled run was less than half the gap away',
  'browser-only-definition': `only ${mainPathSource('camoufox')} could run it, and a catch-up loads no browser pages`,
};

const SUPERSEDED_SENTENCE: Readonly<Record<Extract<StopCause, { kind: 'superseded' }>['by'], string>> = {
  'search-again': 'Replaced by a search you started.',
  schedule: 'Replaced by a scheduled run.',
  stale: 'Too old to carry on; a fresh run replaced it.',
  remove: 'Stopped when the search was removed.',
};

/** The words for a monthly limit's unit: "page limit", "call limit", "spending limit". */
const MONTHLY_UNIT: Readonly<Record<BudgetUnit, string>> = {
  calls: 'call',
  pages: 'page',
  scrolls: 'scroll',
  pence: 'spending',
};

/** The longest stop sentence `stopTextSchema` takes; a longer sources sentence falls back to names only. */
const MAX_SENTENCE = 400;

const capitalise = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** A source's main-path name, or "a source" when the cause names none. */
const nameOf = (id: ProviderId | null) => (id === null ? 'a source' : mainPathSource(id));
const possessive = (name: string) => `${name}'s`;
/** "A", "A and B", "A, B and C". */
function listOf(items: readonly string[]): string {
  // why: a one-element slice's string form is its element, with no branch for an empty list the callers never pass
  const last = String(items.slice(-1));
  const head = items.slice(0, -1);
  return head.length === 0 ? last : `${head.join(', ')} and ${last}`;
}

/**
 * Wording of a cause (spec revision 55 §8.1 "Stop causes"): one full sentence and one fix (`{ text, command }`, the
 * command only in native mode), from the template table above.
 */
export function stopText(c: StopCause, f: StopTextFacts): StopText {
  const at = (i: IsoDateTime) => formatInstantShort(i, f.tz);
  switch (c.kind) {
    case 'sources-unavailable':
      return sourcesText(c, f, at);
    case 'budget':
      return budgetText(c, f, at);
    case 'limiter-timeout': {
      const head = `${capitalise(mainPathSource(c.providerId))} is limiting how fast it answers`;
      // why: ruling A7 / Ian's ruling 2: only a scheduled search resumes by itself; an unscheduled one offers Resume.
      if (f.scheduled && c.resumeAfter !== null)
        return { sentence: `${head}; this search resumes at ${at(c.resumeAfter)}.`, fix: null };
      return { sentence: `${head}.`, fix: fix('Resume') };
    }
    case 'cancelled':
      return { sentence: 'Stopped by you.', fix: SEARCH_AGAIN };
    case 'superseded':
      return { sentence: SUPERSEDED_SENTENCE[c.by], fix: null };
    case 'never-started':
      return { sentence: 'This run never started.', fix: SEARCH_AGAIN };
    case 'interrupted':
      return { sentence: 'The app stopped during this search.', fix: fix('Resume, or Search again') };
    case 'fatal':
      return {
        sentence: 'The app hit an error and stopped this search.',
        fix: fix('Check Status, then Resume'),
      };
    case 'child-cap':
      return { sentence: "Stopped at the on-demand search's limit.", fix: null };
    case 'skipped-confirm':
      return {
        sentence: `Skipped: ${confirmWords(c.estimatePence, c.confirmedPence)}.`,
        fix: fix("Change the schedule's confirmation in Edit"),
      };
    case 'skipped-budget':
      return { sentence: `Skipped: ${skippedBudgetWords(c.scope, c.providerId)}.`, fix: null };
    case 'skipped-window':
      return { sentence: "Skipped: outside this search's window.", fix: null };
    case 'skipped-missed':
      return { sentence: `Skipped: ${SKIP_CODE_SENTENCE[c.code]}.`, fix: null };
  }
}

/**
 * The sources a run could not use, each as a clause, then what that left: nothing searched, the date pairs searched
 * before the stop, or the prices found not checked. The fix is the first source's.
 */
function sourcesText(c: Sources, f: StopTextFacts, at: (i: IsoDateTime) => string): StopText {
  // why: the browser worker "stopped answering" once the run had searched something or reached verification; before
  // that it "isn't answering".
  const past = c.stage === 'verification' || c.searched > 0;
  const tail =
    c.stage === 'verification'
      ? 'the prices found were not checked'
      : c.searched === 0
        ? 'nothing was searched'
        : `the search stopped after ${groupThousands(c.searched)} date ${c.searched === 1 ? 'pair' : 'pairs'}`;
  const clauses = c.sources.map((s) => sourceClause(s, past, at));
  let sentence = `${capitalise(listOf(clauses))}, so ${tail}.`;
  // why: four sources with long reasons can pass the stop-text limit; the names alone still say what was left out.
  if (sentence.length > MAX_SENTENCE) {
    sentence = `${capitalise(listOf(c.sources.map((s) => mainPathSource(s.providerId))))} couldn't be used, so ${tail}.`;
  }
  return { sentence, fix: sourceFix(c.sources[0], f, at) };
}

function sourceClause(s: Source, past: boolean, at: (i: IsoDateTime) => string): string {
  const name = mainPathSource(s.providerId);
  if (s.until !== null) return `${name} ${past ? 'paused' : 'is pausing'} until ${at(s.until)}`;
  if (s.skip === 'provider_unavailable') return `${name} ${past ? 'stopped answering' : "isn't answering"}`;
  const verb =
    s.providerId === 'camoufox' && WORKER_REFUSALS.has(s.detail)
      ? 'refused to load pages'
      : "couldn't be used";
  return `${name} ${verb} because ${DETAIL_REASON[s.detail](s.providerId)}`;
}

function sourceFix(s: Source, f: StopTextFacts, at: (i: IsoDateTime) => string): Fix {
  if (s.until !== null) return fix(`Search again after ${at(s.until)}`);
  if (s.providerId !== 'camoufox') return CHECK_PROVIDERS;
  if (s.skip === 'provider_disabled') return CHECK_STATUS;
  // why: §8.1: the command is a `pnpm gmt …` line in native mode only; a container or dev install starts its worker
  // its own way.
  return f.mode === 'native'
    ? { text: 'Start it with pnpm gmt start, then Search again', command: 'pnpm gmt start' }
    : fix('Start the browser worker, then Search again');
}

/** A budget stop: the cap's sentence, then (when the flight-list step ran after it) the flights read of planned. */
function budgetText(c: Budget, f: StopTextFacts, at: (i: IsoDateTime) => string): StopText {
  const { head, fix: action } = budgetHead(c, f, at);
  const flights =
    c.flights === null ? '' : `; flights were read for ${c.flights.read} of ${c.flights.planned} date pairs`;
  return { sentence: `${head}${flights}.`, fix: action };
}

function budgetHead(
  c: Budget,
  f: StopTextFacts,
  at: (i: IsoDateTime) => string,
): { head: string; fix: Fix | null } {
  const browser = c.providerId === 'camoufox';
  // why: a scheduled search whose run stored a resume carries on by itself, so it needs nothing from the operator.
  const resumes = f.scheduled && c.resumeAfter !== null;
  const resets = c.resetsAt === null ? null : at(c.resetsAt);
  const resetsClause = resets === null ? '' : `; it resets on ${resets}`;
  const afterResetOrResume = fix(
    resets === null ? 'Search again, or Resume' : `Search again after ${resets}, or Resume`,
  );
  switch (c.scope) {
    case 'provider-month': {
      const limit = `${capitalise(possessive(nameOf(c.providerId)))} monthly ${MONTHLY_UNIT[c.unit]} limit is used up`;
      if (!browser) return { head: `${limit}${resetsClause}`, fix: resumes ? null : afterResetOrResume };
      // why: a browser page limit is never resumed (Ian's ruling); a scheduled search's next run picks the pages up.
      const next = f.scheduled
        ? `${resets === null ? '; ' : ', and '}the next scheduled run picks these pages up`
        : '';
      return {
        head: `${limit}${resetsClause}${next}`,
        fix: fix(resets === null ? 'Search again' : `Search again after ${resets}`),
      };
    }
    case 'provider-execution': {
      const what =
        c.unit === 'scrolls'
          ? 'page scrolls'
          : browser
            ? 'browser pages'
            : `calls to ${nameOf(c.providerId)}`;
      return { head: `This search stopped at its limit of ${what} for one run`, fix: CARRY_ON };
    }
    case 'provider-lifetime':
      return {
        head: `${capitalise(nameOf(c.providerId))} has no calls left on its plan`,
        fix: fix('Check Providers'),
      };
    case 'execution-calls':
      return { head: 'This search stopped at its limit of calls for one run', fix: RAISE_AND_RESUME };
    case 'execution-free-calls':
      return { head: 'This search stopped at its limit of free calls for one run', fix: RAISE_AND_RESUME };
    case 'execution-cost':
      return {
        head: `This search stopped at ${formatPence(c.cap)}, its spending limit for one run`,
        fix: RAISE_AND_RESUME,
      };
    case 'global-month':
      return {
        head: `This month's spending limit is used up${resetsClause}`,
        fix: resumes ? null : afterResetOrResume,
      };
  }
}

/** A skipped firing's budget words, from its scope and provider alone (a skipped row stores no unit or figures). */
function skippedBudgetWords(scope: Budget['scope'], providerId: ProviderId | null): string {
  const browser = providerId === 'camoufox';
  const name = nameOf(providerId);
  switch (scope) {
    case 'provider-month':
      return `${possessive(name)} monthly ${browser ? 'page' : 'call'} limit is used up`;
    case 'provider-lifetime':
      return `${name} has no calls left on its plan`;
    case 'provider-execution':
      return `the estimate is above this search's limit of ${browser ? 'browser pages' : `calls to ${name}`} for one run`;
    case 'execution-calls':
      return "the estimate is above this search's limit of calls for one run";
    case 'execution-free-calls':
      return "the estimate is above this search's limit of free calls for one run";
    case 'execution-cost':
      return "the estimate is above this search's spending limit for one run";
    case 'global-month':
      return "this month's spending limit is used up";
  }
}

/**
 * A skipped confirmation's words. Two amounts side by side show pence alike: when either has pence, both do ("about
 * £1.20" against "£1.00"), so a whole-pound confirmation never reads as a different kind of figure.
 */
function confirmWords(estimatePence: number, confirmedPence: number | null): string {
  if (confirmedPence === null) {
    return `today's estimate (about ${formatPence(estimatePence)}) needs a confirmation, and none was given when the schedule was set`;
  }
  const withPence = estimatePence % 100 !== 0 || confirmedPence % 100 !== 0;
  const pounds = (p: number) => (withPence && p % 100 === 0 ? `${formatPence(p)}.00` : formatPence(p));
  const estimate = `today's estimate (about ${pounds(estimatePence)})`;
  // why: a schedule's confirmation covers pence and calls together (decision 37); an estimate within the pence was
  // skipped for its calls, and saying it is "above" the amount would be false.
  if (estimatePence <= confirmedPence) {
    return `${estimate} needs more calls than the confirmation you gave when you set the schedule`;
  }
  return `${estimate} is above the confirmation you gave when you set the schedule (${pounds(confirmedPence)})`;
}
