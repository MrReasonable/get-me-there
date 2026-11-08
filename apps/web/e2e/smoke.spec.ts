import { SOURCE_LABELS } from '@gmt/core';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { PLAN_COPY } from '../src/copy/plan.js';
import { COPY } from '../src/copy.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA (WP19 Task 19.9, the
// Dates view). Every price here is synthetic, and every view must say so beside the red banner (spec §5.5).

const EXAMPLE = COPY.datesView;
/** The Google Flights link's accessible name is its aria-label ("Open in Google Flights for <dates>, opens in a new tab"). */
const OPEN_LINK = /^Open in Google Flights/;
/** The smoke's stay range is 10–11 nights; it narrows it to 10 so "Back to dates" has a filter to keep. */
const NIGHTS = '10-10';

/**
 * Adds one airport to a From/To picker the way an operator does: types its code, waits for the list to answer, and picks
 * the highlighted option with Enter; the chip it becomes names the code.
 */
async function addAirport(page: Page, label: string, code: string) {
  const picker = page.getByRole('combobox', { name: label });
  await picker.fill(code);
  await expect(page.getByRole('option').first()).toBeVisible();
  await picker.press('Enter');
  // the airport became a chip (its remove button names it) and the option list closed
  await expect(page.getByRole('button', { name: `Remove ${code}` })).toBeVisible();
  await expect(picker).toHaveAttribute('aria-expanded', 'false');
}

/**
 * The id of the search the first test made. The api is read directly so each test stands on its own run of the file
 * (the phone project runs only its @phone tests, on the database the desktop project left).
 */
async function searchId(page: Page): Promise<string> {
  const res = await page.request.get('/api/definitions');
  const [first] = z.array(z.object({ id: z.string() })).parse(await res.json());
  if (first === undefined) throw new Error('the smoke search was not created');
  return first.id;
}

const board = (page: Page) => page.getByRole('table', { name: SMOKE.boardTable });
const banner = (page: Page) => page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });

test('fixture mode: a new search, Search now, then Dates, the date pair detail and History show synthetic prices with provenance', async ({
  page,
}) => {
  // (1) the first screen is Searches: fill the new-search form, point both stages at the fixture provider, press Search now
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 2, name: COPY.searchesView.heading })).toBeVisible();
  await addAirport(page, PLAN_COPY.from, 'LHR');
  await addAirport(page, PLAN_COPY.to, 'JFK');
  await page.locator('#w-from').fill('2027-03-14');
  await page.locator('#w-to').fill('2027-03-15');
  await page.locator('#n-min').fill('10');
  await page.locator('#n-max').fill('11');
  // why: the provider checkboxes sit behind More options, below the short form.
  await page.getByText(PLAN_COPY.moreOptions, { exact: true }).click();
  // the name is suggested from the airports picked (the airports table's cities for LHR and JFK)
  const searchName = 'London → New York';
  await expect(page.getByRole('textbox', { name: PLAN_COPY.name })).toHaveValue(searchName);
  // why: the presets name the real providers, which fixture mode does not configure; switch both stages to the fixture provider.
  for (const prefix of ['p-d-', 'p-v-']) {
    for (const box of await page.locator(`input[type="checkbox"][id^="${prefix}"]`).all())
      await box.uncheck();
    await page.locator(`#${prefix}fixture`).check();
  }
  // why: the press is the confirmation (spec rev 55 §11): there is no separate estimate or enable step. The button
  // waits for the estimate of the form as it now is, so a click on it is a click on a ready button.
  const press = page.locator(SMOKE.newSearchForm).getByRole('button', { name: SMOKE.searchNow });
  await expect(press).not.toHaveAttribute('aria-disabled', 'true');
  await press.click();
  // the new search's page opens, and its state line reads "Searched" once the run has finished. The timeout is a
  // backstop for the fixture run, never a wait in itself.
  await expect(page).toHaveURL(/view=dates&def=/);
  const defId = new URL(page.url()).searchParams.get('def') ?? '';
  expect(defId).not.toBe('');
  await expect(page.getByRole('status', { name: SMOKE.stateLine })).toHaveText(
    COPY.searchPage.stateKind.searched,
    { timeout: 90_000 },
  );
  // test-013: the fixture provider has no flight lists, so the page says so and offers neither a read nor a Google
  // Flights link beside synthetic prices
  // (WP21 Task 21.8: the same holds with the return leg. No e2e run can show a pairing, so SMOKE.pairing is pinned by
  // the jsdom selectors test, and the @phone project asserts only what it can see.)
  await expect(page.locator(SMOKE.flightsUnavailable)).toHaveText(COPY.flights.unavailable);
  await expect(page.locator(SMOKE.flightsBlock)).toHaveCount(0);
  await expect(page.getByRole('link', { name: OPEN_LINK })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Read flights for this date/ })).toHaveCount(0);
  // the name the form suggested from the two airports picked, now the page's heading
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(searchName);

  // (2) Dates: the header line, the banner, the first row's provenance, the legend, the overview's keyboard and rings
  await page.goto(`/?view=dates&def=${defId}&d.nights=${NIGHTS}`);
  await expect(board(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(searchName);
  await expect(page.getByTestId('dates-run')).toHaveText(/^Searched .+ · \d+ of \d+ date pairs priced/);
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
  await expect(stop).toHaveCSS(
    'box-shadow',
    /rgb\(0, 0, 0\) 0px 0px 0px 2px, rgb\(0, 0, 0\) 0px 0px 0px 7px$/,
  );
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

  // (4) a search's page by its id, ?view=definitions landing on Searches (the old Definitions URL), the nav naming the
  // search last opened; the retired views' URLs land on Dates; ?view=coverage opens the coverage section
  await page.goto(`/?view=dates&def=${defId}`);
  await expect(board(page)).toBeVisible();
  await page.goto('/?view=definitions');
  await expect(page.getByRole('heading', { level: 2, name: COPY.searchesView.heading })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('searches');
  await expect(page.locator(SMOKE.searchCard)).toHaveCount(1);
  await expect(
    page.getByRole('navigation', { name: SMOKE.nav }).getByRole('link', { name: searchName }),
  ).toBeVisible();
  await page.goto(`/?view=calendar&def=${defId}`);
  await expect(board(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('dates');
  await page.goto(`/?view=coverage&def=${defId}`);
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
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
  await expect(board(page)).toBeVisible();
  const marks = page.locator(SMOKE.legendMark);
  expect(await marks.count()).toBeGreaterThan(0);
  for (const m of await marks.all()) {
    const glyph = m.locator(SMOKE.legendGlyph);
    await expect(glyph).toBeVisible();
    // why: the five marks (spec rev 55 §11): "priced" is its shade ("brighter is cheaper"), every other mark has a glyph
    if ((await m.getAttribute('data-mark')) !== 'priced') await expect(glyph).not.toHaveText('');
  }
  // why: the overview's marked cells need a seed that has some; marks.spec.ts holds that forced-colours case
  const current = page.getByRole('navigation', { name: SMOKE.nav }).locator(SMOKE.navCurrent);
  await expect(current).toHaveCSS('border-bottom-style', 'solid');
  await expect(current).toHaveCSS('border-bottom-width', '4px');
});

test('at 375px Dates shows stacked cards and one month of 24px cells, a tap shows the readout, and the filters fit @phone', async ({
  page,
}) => {
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
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
  searches: (p) => p.locator(SMOKE.searchCard),
  definitions: (p) => p.locator(SMOKE.searchCard),
  // why: the fixture run fires no alert, so the loaded Alerts view is the one that says there are no rules yet
  alerts: (p) => p.getByText(COPY.alertsView.noRules),
  providers: (p) => p.getByRole('region', { name: COPY.provider.fixture }),
  // why: the report's area headings draw only once the report has loaded
  status: (p) => p.getByRole('heading', { level: 3 }),
};

test('at 375px the nav is one row whose menu opens both tiers of 44px links, and no loaded view scrolls the page sideways (UI-005, UI-009, UI-011) @phone', async ({
  page,
}) => {
  const id = await searchId(page);
  for (const [view, loaded] of Object.entries(LOADED)) {
    if (view === 'results') {
      await page.goto(`/?view=dates&def=${id}`);
      await page.locator(SMOKE.phoneCard).first().getByRole('link').click();
    } else await page.goto(view === 'dates' ? `/?view=dates&def=${id}` : `/?view=${view}`);
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
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
  const table = board(page);
  await expect(table).toBeVisible();
  const box = await table.boundingBox();
  // the board's caption is in the first screen, so the operator sees the board without scrolling
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(812);
});

test('at 375px the new-search form sits above the list, and the cards list fits with 44px actions @phone', async ({
  page,
}) => {
  await page.goto('/');
  const card = page.locator(SMOKE.searchCard).first();
  await expect(card).toBeVisible();
  // spec rev 55 §11: narrower than 900 px the form is first in the DOM, so it is above the list
  const form = await page.locator(SMOKE.newSearchForm).boundingBox();
  const first = await card.boundingBox();
  expect((form?.y ?? Number.POSITIVE_INFINITY) + (form?.height ?? 0)).toBeLessThanOrEqual(first?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const actions = await page.locator(SMOKE.cardAction).all();
  expect(actions.length).toBeGreaterThan(0);
  for (const action of actions) {
    const box = await action.boundingBox();
    expect(box?.height ?? 0, (await action.textContent()) ?? '').toBeGreaterThanOrEqual(44);
  }
});

test('at 375px a search’s page with a flights block does not scroll sideways @phone', async ({ page }) => {
  const id = await searchId(page);
  // why: the fixture provider has no flight lists, so the answer is served here, in the api's shape, for the date pairs
  // the board asks about: one read list of flights beside a Google Flights link
  await page.route(`**/api/definitions/${id}/flight-lists*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const asked = (new URL(route.request().url()).searchParams.get('pairs') ?? '').split(',').filter(Boolean);
    const fetchedAt = '2026-10-14T10:44:00.000Z';
    const pairs = asked.map((key) => {
      const [departureDate = '', returnDate = ''] = key.split('_');
      return {
        departureDate,
        returnDate,
        origin: 'LHR',
        destination: 'JFK',
        link: {
          url: `https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+${departureDate}+through+${returnDate}&hl=en-GB&gl=GB`,
          host: 'www.google.com',
          label: 'search link, not a fare link',
        },
        list: {
          id: 1,
          executionId: 'exec-0001',
          origin: 'LHR',
          destination: 'JFK',
          departureDate,
          returnDate,
          fetchedAt,
          ageHours: 0,
          stale: false,
          provenance: {
            providerId: 'camoufox',
            sourceKind: 'scraped-self',
            fetchedAt,
            maxAgeHours: 0,
            fx: { converted: false },
            pointOfSale: 'GB',
            cabin: 'economy',
          },
          status: 'read',
          reason: null,
          listed: 'flights',
          minMinor: 9200,
          tabMinor: null,
          cheapestView: 'cheapest',
          flights: [
            {
              departsLocal: '07:15',
              arrivesLocal: '18:05',
              arrivesDayOffset: 1,
              durationMinutes: 650,
              stops: 1,
              carriers: ['Virgin Atlantic'],
              operatedBy: null,
              amountMinor: 9200,
            },
          ],
          optionsUnparsed: 0,
          optionsOtherCell: 0,
          resultsStated: null,
          // why: WP21 (spec rev 56 §10): a list read before the return leg existed has no return read
          returns: null,
        },
        listOtherPair: null,
        // why: final review B-I3: required; a young read list is not read again on demand
        readNow: false,
      };
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        unavailableReason: null,
        refreshHours: 24,
        // why: WP21 Task 21.7: required; the pages one on-demand read plans (2 while the worker's flags are unread)
        pagesPlanned: 2,
        reading: null,
        pairs,
      }),
    });
  });
  await page.goto(`/?view=dates&def=${id}`);
  // why: design 2026-11-08 §5.3 — rows are closed by default: no flights block until a row's button is pressed
  const toggle = page.getByRole('button', { name: /^Show flights/ }).first();
  await expect(toggle).toBeVisible();
  await expect(page.locator(SMOKE.flightsBlock)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await toggle.click();
  await expect(page.locator(SMOKE.flightsBlock).first()).toBeVisible();
  await expect(page.getByRole('link', { name: OPEN_LINK }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
