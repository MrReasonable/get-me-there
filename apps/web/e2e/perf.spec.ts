import { expect, type Page, test } from '@playwright/test';
import { COPY } from '../src/copy.js';
import {
  CELLS_CASE,
  DATE_PAIRS_CASE,
  datePairsBody,
  definitionBody,
  executionBody,
  PERF_DEFINITION_ID,
  PERF_EXECUTION_ID,
  PERF_NOW,
  type PerfCase,
  providersBody,
  resultsBody,
} from './perfFixtures.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6, the performance bound (WP19 Task 19.9): the decoded worst cases served through the browser's route
// interception; the board and the overview drawn within 1.5 s of the response, a stay filter change and a re-rank each
// redrawn within 200 ms, and no main-thread task longer than 200 ms. Every limit is multiplied by GMT_TIMING_FACTOR
// (default 1; CI's e2e job runs at 3, revision 50). Each wait is on its step's User Timing mark; the timeout is only a
// backstop.

const FACTOR = Number(process.env.GMT_TIMING_FACTOR ?? '1');
const DRAW_MS = 1_500 * FACTOR;
const REDRAW_MS = 200 * FACTOR;
const LONG_TASK_MS = 200 * FACTOR;
const BACKSTOP_MS = 60_000;
const RESPONSE = 'gmt:dates-response';
const DRAWN = 'gmt:dates-drawn';
const INPUT = 'perf:input';

/**
 * Before the clock: keep the browser's own User Timing functions, observe long tasks, and mark every input event at
 * dispatch (the stay filter step measures from it).
 */
function beforeClock() {
  const real = window.performance;
  const perf = {
    mark: real.mark.bind(real),
    clearMarks: real.clearMarks.bind(real),
    getEntriesByName: real.getEntriesByName.bind(real),
  };
  const longTasks: number[] = [];
  Object.assign(window, { __gmtPerf: perf, __gmtLongTasks: longTasks });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push(e.duration);
  }).observe({ type: 'longtask', buffered: true });
  document.addEventListener('input', () => perf.mark('perf:input'), true);
}

/**
 * After the clock: Playwright's clock replaces `performance` with one whose `mark` records nothing (its fake keeps
 * only `now`), so the app's marks are routed back to the browser's, which the test reads.
 */
function afterClock() {
  const saved: unknown = Reflect.get(window, '__gmtPerf');
  if (typeof saved !== 'object' || saved === null) return;
  const perf = Object.fromEntries(Object.entries(saved));
  for (const k of ['mark', 'clearMarks', 'getEntriesByName']) Reflect.set(window.performance, k, perf[k]);
}

/** Waits for a mark's first entry and returns its start time (the browser's real clock). */
async function markTime(page: Page, name: string): Promise<number> {
  await page.waitForFunction(
    (n) => Reflect.get(window, '__gmtPerf').getEntriesByName(n, 'mark').length > 0,
    name,
    { timeout: BACKSTOP_MS, polling: 'raf' },
  );
  return page.evaluate((n) => {
    const all: PerformanceEntry[] = Reflect.get(window, '__gmtPerf').getEntriesByName(n, 'mark');
    return all[all.length - 1]?.startTime ?? Number.NaN;
  }, name);
}

const clearMarks = (page: Page) => page.evaluate(() => Reflect.get(window, '__gmtPerf').clearMarks());

async function serve(page: Page, c: PerfCase) {
  const bodies = { first: datePairsBody(c, 0), second: datePairsBody(c, 1) };
  const state = { datePairs: bodies.first, tick: 0, unknown: new Set<string>() };
  const json = (body: string) => ({ status: 200, contentType: 'application/json', body });
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/providers') return route.fulfill(json(providersBody()));
    if (path === '/api/definitions') return route.fulfill(json(definitionBody(c)));
    if (path === `/api/definitions/${PERF_DEFINITION_ID}/date-pairs`)
      return route.fulfill(json(state.datePairs));
    if (path === `/api/definitions/${PERF_DEFINITION_ID}/results`) return route.fulfill(json(resultsBody(c)));
    if (path === `/api/executions/${PERF_EXECUTION_ID}`)
      return route.fulfill(json(executionBody(c, state.tick)));
    state.unknown.add(path);
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'not_found', message: 'not served by the performance test' } }),
    });
  });
  return { bodies, state };
}

for (const c of [DATE_PAIRS_CASE, CELLS_CASE]) {
  test(`${c.name}: drawn within 1.5 s, a stay change and a re-rank each within 200 ms, no long task over 200 ms @perf`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { bodies, state } = await serve(page, c);
    await page.addInitScript(beforeClock);
    await page.clock.install({ time: new Date(PERF_NOW) });
    await page.addInitScript(afterClock);

    // (1) the first read: response to the board and the overview drawn
    await page.goto(`/?view=dates&def=${PERF_DEFINITION_ID}`);
    const response = await markTime(page, RESPONSE);
    const drawn = await markTime(page, DRAWN);
    const draw = drawn - response;
    await expect(page.getByRole('table', { name: SMOKE.boardTable })).toBeVisible();
    await expect(page.locator(SMOKE.overviewCell).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: COPY.syntheticBanner })).toBeVisible();

    // (2) a stay filter change: the range applies in the browser, so it is measured from the input event
    const min = page.getByLabel(COPY.datesView.stayMin);
    const max = page.getByLabel(COPY.datesView.stayMax);
    // why: a lone maximum is not yet a range, so it changes nothing; the minimum then applies the range
    await max.fill(String(c.maxNights - 5));
    await clearMarks(page);
    await min.fill(String(c.minNights + 2));
    const input = await markTime(page, INPUT);
    const stay = (await markTime(page, DRAWN)) - input;

    // (3) a re-rank during a running run: not held (pointer off the board, focus on the body), the next execution
    // poll answers changed progress, 31 s pass the 30 s throttle, and the route answers a body in another order
    await page.mouse.move(1, 1);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    state.tick = 1;
    state.datePairs = bodies.second;
    await clearMarks(page);
    await page.clock.fastForward('00:31');
    const reread = await markTime(page, RESPONSE);
    const rerank = (await markTime(page, DRAWN)) - reread;

    const longTasks: number[] = await page.evaluate(() => Reflect.get(window, '__gmtLongTasks'));
    const longest = Math.max(0, ...longTasks);
    const measured = {
      case: c.name,
      factor: FACTOR,
      drawMs: Math.round(draw),
      stayMs: Math.round(stay),
      rerankMs: Math.round(rerank),
      longestTaskMs: Math.round(longest),
      longTasks: longTasks.length,
      unserved: [...state.unknown],
    };
    // why: the measured figures are the PR's record (the brief asks for each), printed once per case
    console.log(`perf ${JSON.stringify(measured)}`);
    expect(draw, 'board and overview drawn after the response').toBeLessThanOrEqual(DRAW_MS);
    expect(stay, 'stay filter redraw').toBeLessThanOrEqual(REDRAW_MS);
    expect(rerank, 're-rank redraw').toBeLessThanOrEqual(REDRAW_MS);
    expect(longest, 'longest main-thread task').toBeLessThanOrEqual(LONG_TASK_MS);
  });
}
