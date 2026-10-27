/**
 * A grid page in the page session (spec §2 rev 34; split from session.ts, fix round 1, CA 11): the Best view settled and
 * classified, the search form and the currency checked before anything is clicked (PA-12), then the dialog flow
 * (gridPage.ts). The no-flights page (past the sale window) is a grid answer with no views, which the adapter reads as
 * no data for the covered cells on or after the page's start. The session owns everything around it: the pacer, SOCS,
 * the read-back, the cool-downs and the close.
 */
import { type BlockedPage, GRID_GRAMMAR_VERSION, type GridRequest, type WorkerAnswer } from '@gmt/core';
import type { PageBudget } from './budget.js';
import { type Driver, type PageLike, pollUntilSettled } from './driver.js';
import { checkForm } from './form.js';
import { gridPage } from './gridPage.js';
import { pointOfSaleOf } from './pointOfSale.js';
import type { Selectors } from './selectors.js';
import type { SessionDeps } from './session.js';

export interface GridRead {
  driver: Driver;
  page: PageLike;
  req: GridRequest;
  budget: PageBudget;
  started: number;
  counter: { scrolls: number };
  S: Selectors;
  pollMs: number;
}

/** A blocked answer whose end the session's stop handling fills in. */
const placeholder =
  (d0: Pick<SessionDeps, 'clock'>) =>
  (page: BlockedPage): WorkerAnswer => ({
    kind: 'blocked',
    page,
    cooldownUntil: d0.clock.now(),
  });

export async function readGrid(
  o: GridRead,
  d0: Pick<SessionDeps, 'clock' | 'timers' | 'log' | 'versions' | 'grid'>,
): Promise<{ answer: WorkerAnswer; stop: BlockedPage | null; rule?: string }> {
  const blockedPlaceholderOf = placeholder(d0);
  const { driver, page, req, budget, started, counter, S, pollMs } = o;
  const d = budget.d;
  const settled = await pollUntilSettled(driver, d, d0.timers, pollMs, S, {
    view: 'best',
    log: d0.log,
    startedAt: started,
  });
  if (settled.kind.kind === 'blocked')
    return {
      answer: blockedPlaceholderOf(settled.kind.page),
      stop: settled.kind.page,
      rule: settled.rule,
    };
  const grid = (
    views: Extract<WorkerAnswer, { kind: 'grid' }>['views'],
    ended: Extract<WorkerAnswer, { kind: 'grid' }>['ended'],
    notes: string[],
    pointOfSale: string,
  ): WorkerAnswer => ({
    kind: 'grid',
    fetchedAt: d0.clock.now(),
    currency: 'GBP',
    pointOfSale,
    views,
    scrolls: counter.scrolls,
    ended,
    notes,
    versions: { ...d0.versions, gridGrammar: GRID_GRAMMAR_VERSION },
  });
  if (settled.kind.kind === 'no-flights')
    return { answer: grid([], 'no-flights', [], 'unknown'), stop: null };
  const form = checkForm(await driver.formFacts(d), {
    departureDate: req.start.departureDate,
    returnDate: req.start.returnDate,
  });
  const list = await driver.listFacts(d);
  if (form !== 'ok' || list.currencyName !== 'Currency GBP')
    return {
      answer: blockedPlaceholderOf('unrecognised'),
      stop: 'unrecognised',
      rule: form !== 'ok' ? `search-form:${form}` : 'currency',
    };
  const g = d0.grid;
  const r = await gridPage(driver, page, budget, req, {
    timers: d0.timers,
    pollMs: pollMs,
    S,
    steps: { timers: d0.timers, log: d0.log, startedAt: started },
    spacingMs: g?.spacingMs ?? 0,
    stepDays: g?.stepDays ?? { departures: 1, returns: 1 },
    // why: CA 10: the operator's date, as the app's planner takes it
    today: d0.clock.todayLondon(),
    counter,
  });
  if (r.kind === 'stop')
    return {
      answer: blockedPlaceholderOf(r.page),
      stop: r.page,
      rule: r.rule,
    };
  return { answer: grid(r.views, r.ended, r.notes, pointOfSaleOf(list.locationName)), stop: null };
}
