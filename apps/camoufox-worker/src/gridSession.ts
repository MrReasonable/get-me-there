/**
 * A grid page in the page session (spec §2 rev 34; split from session.ts, fix round 1, CA 11): the Best view settled and
 * classified, the search form and the currency checked before anything is clicked (PA-12), then the dialog flow
 * (gridPage.ts). The no-flights page (past the sale window) is a grid answer with no views, which the adapter reads as
 * no data for the covered cells on or after the page's start. A first view whose prices never arrived (`first-not-drawn`)
 * loads the same page once more, after the pacer's spacing, and reads it again from the Best view (Ian's ruling of
 * 2026-11-03). The session owns everything around it: the pacer's claim, SOCS, the read-back, the cool-downs and the
 * close.
 */
import { type BlockedPage, GRID_GRAMMAR_VERSION, type GridRequest, type WorkerAnswer } from '@gmt/core';
import type { PageBudget } from './budget.js';
import { type Driver, type PageLike, pollUntilSettled } from './driver.js';
import { checkForm } from './form.js';
import { gridPage } from './gridPage.js';
import type { GuardState } from './guard.js';
import type { Pacer } from './pacer.js';
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
  /**
   * The worker's grid row (Ian's ruling of 2026-11-03: a second page in a row that ends `first-not-drawn` stops), read
   * and set when this page's reload ends not drawn, shared by every page session.
   */
  row: { notDrawn: boolean };
  /** The page's one reload after a first view that never drew a price: its URL (the first load's), guard and pacer. */
  reload: {
    url: string;
    guard: Pick<GuardState, 'refused'>;
    pacer: Pick<Pacer, 'reclaim' | 'spacingMs'>;
    /** CAMOUFOX_PAGE_TIMEOUT_SECONDS in ms: the reloaded first view's period, and its dialog's. */
    pageTimeoutMs: number;
  };
}

type GridEnd = { answer: WorkerAnswer; stop: BlockedPage | null; rule?: string };

/**
 * The budget after the reload: the current deadline as the page's, and the dialog's deadline (`next`) a whole page
 * period from its click, inside the page's overall cap (which holds the reload's two periods), never the first view's
 * twice-the-page-timeout bound, which the first load has already spent.
 */
const reloaded = (b: PageBudget, pageTimeoutMs: number): PageBudget => ({
  get d() {
    return b.d;
  },
  next: () => b.nextFor(pageTimeoutMs),
  nextFor: (ms) => b.nextFor(ms),
  onExpire: (fn) => b.onExpire(fn),
});

const notDrawn = (e: GridEnd): boolean => e.answer.kind === 'grid' && e.answer.ended === 'first-not-drawn';

/** A blocked answer whose end the session's stop handling fills in. */
const placeholder =
  (d0: Pick<SessionDeps, 'clock'>) =>
  (page: BlockedPage): WorkerAnswer => ({
    kind: 'blocked',
    page,
    cooldownUntil: d0.clock.now(),
  });

type ReadDeps = Pick<SessionDeps, 'clock' | 'timers' | 'log' | 'versions' | 'grid'>;

export async function readGrid(o: GridRead, d0: ReadDeps): Promise<GridEnd> {
  const first = await readOnce(o, o.budget, d0, []);
  if (!notDrawn(first)) return first;
  // why: Ian's ruling of 2026-11-03: a grid whose prices never arrived filled on a fresh load of the same page (that
  // morning's run), so the page is loaded once more, inside this request, after the pacer's spacing (the return
  // phase's reload, R-spacing), and read again from its Best view
  const { url, guard, pacer, pageTimeoutMs } = o.reload;
  await pacer.reclaim(o.budget.nextFor(pacer.spacingMs), d0.timers);
  try {
    await o.driver.goto(url, o.budget.nextFor(pageTimeoutMs));
  } catch (e) {
    if (guard.refused === null) throw e;
    const page = guard.refused;
    return { answer: placeholder(d0)(page), stop: page, rule: `guard-refused:${page}` };
  }
  d0.log.debug({ elapsedMs: d0.timers.now() - o.started }, 'grid reloaded');
  const again = await readOnce(o, reloaded(o.budget, pageTimeoutMs), d0, ['grid-reloaded']);
  // why: Ian's ruling of 2026-11-03: one grid whose prices never arrived, even after its reload, loses its page; two
  // such pages in a row may be prices withheld, so the second is refused as unrecognised, with its cool-down
  if (!notDrawn(again)) return again;
  // why: CodeRabbit on PR #49: with pages at once the row is read and set in one step here, when the page ends, so two
  // pages that end not drawn together still make a row
  const before = o.row.notDrawn;
  o.row.notDrawn = true;
  if (before)
    return {
      answer: placeholder(d0)('unrecognised'),
      stop: 'unrecognised',
      rule: 'grid:first-view:not-drawn-again',
    };
  return again;
}

/** One load's read: the Best view settled, the form and currency checked, then the dialog flow; `notes` lead the answer's. */
async function readOnce(o: GridRead, budget: PageBudget, d0: ReadDeps, lead: string[]): Promise<GridEnd> {
  const blockedPlaceholderOf = placeholder(d0);
  const { driver, page, req, started, counter, S, pollMs } = o;
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
    notes: [...lead, ...notes],
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
