import { expect, type Page, test } from '@playwright/test';
import { COPY } from '../src/copy.js';
import { CELLS_CASE, DATE_PAIRS_CASE, PERF_DEFINITION_ID, PERF_NOW, servePerfCase } from './perfFixtures.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6, the performance bound (WP19 Task 19.9; design 2026-11-08 Tasks 8 and 9): the decoded worst cases
// served through the browser's route interception; a search's page (its header, both sections and the calendar) drawn
// within 1.5 s of the response, a stay filter change, "Show 10 more" and a day's panel opening each within 200 ms, and
// no main-thread task longer than 200 ms. Every limit is multiplied by GMT_TIMING_FACTOR (default 1; CI's e2e job runs at 3, revision
// 50). Each wait is on its step's User Timing mark (`DATES_DRAWN_MARK`, which the page sets once it has drawn), so a
// page that never sets it fails at the backstop.

const FACTOR = Number(process.env.GMT_TIMING_FACTOR ?? '1');
const DRAW_MS = 1_500 * FACTOR;
const REDRAW_MS = 200 * FACTOR;
const LONG_TASK_MS = 200 * FACTOR;
const BACKSTOP_MS = 60_000;
const RESPONSE = 'gmt:dates-response';
const DRAWN = 'gmt:dates-drawn';
const INPUT = 'perf:input';
const CLICK = 'perf:click';

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
  document.addEventListener('click', () => perf.mark('perf:click'), true);
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

for (const c of [DATE_PAIRS_CASE, CELLS_CASE]) {
  test(`${c.name}: drawn within 1.5 s, a stay change, "Show 10 more" and a day's panel each within 200 ms, no long task over 200 ms @perf`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { state } = await servePerfCase(page, c);
    await page.addInitScript(beforeClock);
    // why: Playwright takes the ISO instant as a string, so no `Date` is made outside `src/now.tsx`
    await page.clock.install({ time: PERF_NOW });
    await page.addInitScript(afterClock);

    // (1) the first read: response to the header, both sections and the calendar drawn (DATES_DRAWN_MARK is set once
    // the page's commit holds all of them)
    await page.goto(`/?view=dates&def=${PERF_DEFINITION_ID}`);
    const response = await markTime(page, RESPONSE);
    const drawn = await markTime(page, DRAWN);
    const draw = drawn - response;
    const trips = page.getByRole('region', { name: SMOKE.cheapestTrips });
    await expect(trips.locator(SMOKE.tripRow)).toHaveCount(5);
    await expect(
      page.getByRole('region', { name: SMOKE.lowerOnCalendar }).locator(SMOKE.calendarRow),
    ).toHaveCount(3);
    await expect(page.locator(SMOKE.pricedDay).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: COPY.syntheticBanner })).toBeVisible();

    // (2) a stay filter change: the range applies in the browser, so it is measured from the input event
    const filters = page.getByRole('group', { name: SMOKE.filterRow });
    const min = filters.getByLabel(COPY.searchPage.stayShortest);
    const max = filters.getByLabel(COPY.searchPage.stayLongest);
    // why: a lone maximum is not yet a range, so it changes nothing; the minimum then applies the range
    await max.fill(String(c.maxNights - 5));
    await clearMarks(page);
    await min.fill(String(c.minNights + 2));
    const input = await markTime(page, INPUT);
    const stay = (await markTime(page, DRAWN)) - input;

    // (3) "Show 10 more": ten more trips, measured from the click
    await expect(trips.locator(SMOKE.tripRow)).toHaveCount(5);
    await clearMarks(page);
    await trips.getByRole('button', { name: COPY.searchPage.showMore(10) }).click();
    const click = await markTime(page, CLICK);
    const more = (await markTime(page, DRAWN)) - click;
    await expect(trips.locator(SMOKE.tripRow)).toHaveCount(15);

    // (4) a day's panel (Ruling 18): its region drawn, measured from the click on the day
    await clearMarks(page);
    await page.locator(SMOKE.calendarTabStop).click();
    const dayClick = await markTime(page, CLICK);
    const panel = (await markTime(page, DRAWN)) - dayClick;
    await expect(page.getByRole('region', { name: SMOKE.dayPanel })).toBeVisible();

    const longTasks: number[] = await page.evaluate(() => Reflect.get(window, '__gmtLongTasks'));
    const longest = Math.max(0, ...longTasks);
    const measured = {
      case: c.name,
      factor: FACTOR,
      drawMs: Math.round(draw),
      stayMs: Math.round(stay),
      showMoreMs: Math.round(more),
      dayPanelMs: Math.round(panel),
      longestTaskMs: Math.round(longest),
      longTasks: longTasks.length,
      unserved: [...state.unknown],
    };
    // why: the measured figures are the PR's record (the brief asks for each), printed once per case
    console.log(`perf ${JSON.stringify(measured)}`);
    expect(draw, 'header and both sections drawn after the response').toBeLessThanOrEqual(DRAW_MS);
    expect(stay, 'stay filter redraw').toBeLessThanOrEqual(REDRAW_MS);
    expect(more, '"Show 10 more" redraw').toBeLessThanOrEqual(REDRAW_MS);
    expect(panel, "a day's panel opening").toBeLessThanOrEqual(REDRAW_MS);
    expect(longest, 'longest main-thread task').toBeLessThanOrEqual(LONG_TASK_MS);
  });
}
