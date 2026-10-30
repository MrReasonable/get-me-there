import { SOURCE_LABELS } from '@gmt/core';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { PLAN_COPY } from '../src/copy/plan.js';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA (WP19 Task 19.9, the
// Dates view). Every price here is synthetic, and every view must say so beside the red banner (spec §5.5).

const EXAMPLE = COPY.datesView;
/** The example's stay range is 10–21 nights; the smoke narrows it so "Back to dates" has a filter to keep. */
const NIGHTS = '10-14';

const board = (page: Page) => page.getByRole('table', { name: SMOKE.boardTable });
const banner = (page: Page) => page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });

test('fixture mode: import, run, then Dates, the date pair detail and History show synthetic prices with provenance', async ({
  page,
}) => {
  // (1) import the example, switch both stages to the fixture provider, enable, estimate, create, run now
  await page.goto('/?view=definitions');
  await page.getByRole('button', { name: /^Import example/ }).click();
  // why: the provider checkboxes sit behind More options, below the Plan a search form.
  await page.getByText(PLAN_COPY.moreOptions, { exact: true }).click();
  // why: the example JSON names the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all())
      await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  // why: a new definition is created disabled (spec rev 27), and the api refuses "Run now" for a disabled one (409).
  // The budget is not touched: Import example leaves the plan preset's budget, which the api's EXECUTION_MAX_CALLS sets.
  await page.getByLabel(COPY.enabled).check();
  // why: WP9's form offers the create click only after an estimate for the current draft.
  await page.getByRole('button', { name: COPY.showEstimate }).click();
  await page.getByRole('button', { name: /^Create and confirm about/ }).click();
  await page.getByRole('button', { name: /^Run now/ }).click();
  // why: the status bar polls the run (spec §11); its status words say "completed" once the run has finished. The
  // timeout is a backstop for the fixture run, never a wait in itself.
  const status = page.getByRole('region', { name: COPY.statusBarLabel });
  await expect(status).toContainText(COPY.statusName.completed, { timeout: 90_000 });

  // (2) Dates: the header line, the banner, the first row's provenance, the legend, the overview's keyboard and rings
  await page.goto(`/?view=dates&d.nights=${NIGHTS}`);
  await expect(board(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('London → New York (example)');
  await expect(page.getByTestId('dates-run')).toHaveText(/^run finished (just now|.+ ago)$/);
  await expect(banner(page)).toBeVisible();
  // the alarm plate: the red of spec §5.5, with white words (styles/world.css --alarm)
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(163, 35, 26)');
  const first = board(page).locator(SMOKE.boardRow).first();
  await expect(first).toContainText(SOURCE_LABELS.synthetic);
  await expect(first.getByTestId('price-cell')).toContainText(/ago|just now|old/);
  await expect(page.locator(SMOKE.legend)).toBeVisible();
  const stop = page.locator(SMOKE.overviewTabStop);
  await expect(stop).toHaveCount(1);
  const before = await stop.getAttribute('data-cell');
  // why: focus-visible applies once the keyboard is in use: focus() puts focus on the tab stop and the arrow key that
  // follows switches the page to keyboard modality, so the outline is then computed as for a Tab user.
  await stop.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stop).toHaveCount(1);
  await expect(stop).not.toHaveAttribute('data-cell', before ?? '');
  await expect(stop).toBeFocused();
  await expect(stop).toHaveCSS('outline-style', 'solid');
  // the black gap of the one focus ring (world.css, unlayered): no lamp's own ring shadow may take its place
  await expect(stop).toHaveCSS('box-shadow', /0px 0px 0px 7px/);
  await first.hover();
  const lit = page.locator(SMOKE.litCell);
  await expect(lit).toHaveCount(1);
  await expect(lit).toHaveAttribute('data-ringed', '');

  // (3) the first row opens the detail, whose headline names the synthetic source and whose URL carries the date pair;
  // "Back to dates" returns with the stay filter kept
  await first.getByRole('link', { name: SMOKE.rowLink }).click();
  await expect(page.getByRole('table', { name: SMOKE.detailTable })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('view')).toBe('results');
  expect(url.searchParams.get('depart')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(url.searchParams.get('return')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(url.searchParams.get('d.nights')).toBe(NIGHTS);
  await expect(page.locator(SMOKE.detailHeadline)).toContainText(SOURCE_LABELS.synthetic);
  await expect(page.locator(SMOKE.airportPairPanel).first()).toBeVisible();
  await page.locator(SMOKE.backToDates).click();
  await expect(board(page)).toBeVisible();
  const back = new URL(page.url()).searchParams;
  expect(back.get('view')).toBe('dates');
  expect(back.get('d.nights')).toBe(NIGHTS);
  expect(back.get('depart')).toBeNull();

  // (4) the retired views' URLs land on Dates; ?view=coverage opens the coverage section
  await page.goto('/?view=calendar');
  await expect(board(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('dates');
  await page.goto('/?view=coverage');
  await expect(board(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('d.coverage')).toBe('open');
  await expect(page.getByRole('button', { name: SMOKE.coverageToggle })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('table', { name: COPY.coverageHeading })).toBeVisible();

  // (5) History: the charts draw in a real layout and the table names the synthetic source
  await page.goto('/?view=history');
  await expect(
    page.getByRole('figure', { name: COPY.historyView.fetchChartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText(SOURCE_LABELS.synthetic);
});

test('forced colours: every mark keeps its glyph, and the current nav entry its bar', async ({ page }) => {
  // (7) spec §11: nothing by colour alone; jsdom cannot apply forced colours, so the browser checks it here
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/?view=dates');
  await expect(board(page)).toBeVisible();
  const marks = page.locator(SMOKE.legendMark);
  expect(await marks.count()).toBeGreaterThan(0);
  for (const m of await marks.all()) {
    const glyph = m.locator(SMOKE.legendGlyph);
    await expect(glyph).toBeVisible();
    await expect(glyph).not.toHaveText('');
  }
  // every overview cell that carries a mark still shows its glyphs; the striped mark keeps its pattern too
  const marked = page.locator(`${SMOKE.overviewCell}:not([data-marks=""])`);
  const count = await marked.count();
  expect(count).toBeGreaterThan(0);
  const unseen = await marked.evaluateAll((cells) =>
    cells
      .filter((c) => {
        const g = c.querySelector<HTMLElement>('[data-testid="cell-glyphs"]');
        const box = g?.getBoundingClientRect();
        return g === null || g === undefined || box === undefined || box.width === 0 || g.textContent === '';
      })
      .map((c) => c.getAttribute('data-cell')),
  );
  expect(unseen).toEqual([]);
  const striped = page.locator(`${SMOKE.overviewCell}[data-marks~="partly"]`).first();
  if ((await striped.count()) > 0)
    await expect(striped).toHaveCSS('background-image', /repeating-linear-gradient/);
  const current = page.getByRole('navigation', { name: SMOKE.nav }).locator(SMOKE.navCurrent);
  await expect(current).toHaveCSS('border-bottom-style', 'solid');
  await expect(current).toHaveCSS('border-bottom-width', '4px');
});

test('at 375px Dates shows stacked cards and one month of 24px cells, a tap shows the readout, and the filters fit @phone', async ({
  page,
}) => {
  await page.goto('/?view=dates');
  await expect(page.locator(SMOKE.phoneCard).first()).toBeVisible();
  // the cards are the board table's own rows: one semantic table at every width, its roles written out
  await expect(board(page).locator(SMOKE.phoneCard).first()).toBeVisible();
  await expect(page.locator(SMOKE.phoneCard).first()).toHaveAttribute('role', 'row');
  await expect(page.getByRole('button', { name: SMOKE.previousMonth })).toBeVisible();
  await expect(page.getByRole('button', { name: SMOKE.nextMonth })).toBeVisible();
  const cells = page.locator(SMOKE.overviewCell);
  const months = await cells.evaluateAll(
    (all) => new Set(all.map((c) => c.getAttribute('data-date')?.slice(0, 7))).size,
  );
  expect(months).toBe(1);
  // why: spec §11 Phone: every cell's box is at least 24 × 24 px, and nothing spills out of a cell
  const small = await cells.evaluateAll((all) =>
    all
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width < 24 || r.height < 24;
      })
      .map((c) => c.getAttribute('data-cell')),
  );
  expect(small).toEqual([]);
  const spilled = await cells.evaluateAll((all) =>
    all
      .filter((c) => c.scrollWidth > c.clientWidth || c.scrollHeight > c.clientHeight)
      .map((c) => c.getAttribute('data-cell')),
  );
  expect(spilled).toEqual([]);
  // revision 50: a first tap on a cell shows its readout (and does not leave the view)
  const cell = cells.nth(3);
  await cell.tap();
  await expect(page.locator(SMOKE.readout)).toContainText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);
  expect(new URL(page.url()).searchParams.get('view')).toBe('dates');
  // why: on a phone the filters fold to one line (the departure board, Ian 2026-10-27); opened, the form must fit
  await page.locator('summary', { hasText: EXAMPLE.filtersLabel }).click();
  const form = page.getByRole('form', { name: EXAMPLE.filtersLabel });
  await expect(form).toBeVisible();
  const box = await form.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

/** What each view shows only once its data has loaded: a named heading, table or row, never a timeout. */
const LOADED: Record<string, (page: Page) => Locator> = {
  dates: (p) => p.locator(SMOKE.phoneCard),
  // why: the detail is reached from the first card's link (its URL carries the date pair)
  results: (p) => p.getByRole('table', { name: SMOKE.detailTable }),
  history: (p) => p.getByRole('figure', { name: COPY.historyView.fetchChartTitle }),
  definitions: (p) => p.getByRole('button', { name: COPY.showEstimate }),
  // why: the fixture run fires no alert, so the loaded Alerts view is the one that says there are no rules yet
  alerts: (p) => p.getByText(COPY.alertsView.noRules),
  providers: (p) => p.getByRole('region', { name: COPY.provider.fixture }),
  // why: the report's area headings draw only once the report has loaded
  status: (p) => p.getByRole('heading', { level: 3 }),
};

test('at 375px the nav is one row whose menu opens both tiers of 44px links, and no loaded view scrolls the page sideways (UI-005, UI-009, UI-011) @phone', async ({
  page,
}) => {
  for (const [view, loaded] of Object.entries(LOADED)) {
    if (view === 'results') {
      await page.goto('/?view=dates');
      await page.locator(SMOKE.phoneCard).first().getByRole('link').click();
    } else await page.goto(`/?view=${view}`);
    const nav = page.getByRole('navigation', { name: SMOKE.nav });
    await expect(nav).toBeVisible();
    // why: the departure board (Ian, 2026-10-27): one row (the current tier and view, and the menu), so the view
    // starts in the first screen
    const row = await nav.boundingBox();
    expect(row?.height ?? 0, view).toBeLessThanOrEqual(44 + 8);
    const menu = nav.getByRole('button', { name: COPY.navMenu });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    for (const name of SMOKE.navTiers) await expect(nav.getByRole('list', { name })).toBeVisible();
    for (const link of await nav.getByRole('link').all()) {
      await expect(link).toBeInViewport({ ratio: 1 });
      const box = await link.boundingBox();
      expect(box?.height ?? 0, view).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    // why: measured only after the view's own content is on the page, never on its loading state
    await expect(loaded(page).first(), view).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, view).toBeLessThanOrEqual(375);
  }
});

test('at 375 x 812 the board starts in the first screen (Ian, 2026-10-27) @phone', async ({ page }) => {
  await page.goto('/?view=dates');
  const table = board(page);
  await expect(table).toBeVisible();
  const box = await table.boundingBox();
  // the board's caption is in the first screen, so the operator sees the board without scrolling
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(812);
});
