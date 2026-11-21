import { apiContract, SOURCE_LABELS } from '@gmt/core';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { PLAN_COPY } from '../src/copy/plan.js';
import { COPY } from '../src/copy.js';
import { estimate, estimateResponse } from '../test/fixtures.js';
import { expectNoSidewaysScroll } from './layout.js';
import { SMOKE } from './selectors.js';

// Spec §9 item 6: one Playwright smoke in fixture mode, through the real api and the built SPA (WP19 Task 19.9, the
// Dates view). Every price here is synthetic, and every view must say so beside the red banner (spec §5.5).

/**
 * The smoke's stay range is 10–11 nights; it narrows it to 10, so each day of the calendar shows one stay and the Trip
 * page's crumb back has a filter to keep.
 */
const NIGHTS = '10-10';

/**
 * Adds one airport to a From/To picker the way an operator does: types its code, waits for the list to answer, and picks
 * the highlighted option with Enter; the chip it becomes names the code.
 */
async function addAirport(page: Page, label: string, code: string) {
  // why: exact, since a name matches by substring and "When to leave" holds "to"
  const picker = page.getByRole('combobox', { name: label, exact: true });
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
  // why: by name, so a search another spec saved first neither is taken nor breaks this one
  const mine = z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(await res.json())
    .find((d) => d.name === SMOKE_SEARCH);
  if (mine === undefined) throw new Error('the smoke search was not created');
  return mine.id;
}

/** The name the first test gives its search (the form's suggested name for the worked example's route). */
const SMOKE_SEARCH = 'London → New York';
/** The smoke's own search card, found by its name, never by how many cards the page has. */
const smokeCard = (page: Page) =>
  page
    .locator(SMOKE.searchCard)
    .filter({ has: page.getByRole('heading', { level: 2, name: SMOKE_SEARCH, exact: true }) });

/** Design 2026-11-08 §5.2: a search's page has drawn once its sections have; the fixture run reads no flights. */
const trips = (page: Page) => page.getByRole('region', { name: SMOKE.cheapestTrips });
const lower = (page: Page) => page.getByRole('region', { name: SMOKE.lowerOnCalendar });
const banner = (page: Page) => page.getByRole('alert').filter({ hasText: COPY.syntheticBanner });

test('fixture mode: a new search, Search, then Dates, the Trip page and History show synthetic prices with provenance', async ({
  page,
}) => {
  // (1) the first screen is Trips: fill the new-search panel and press Search (fixture mode sets up only the fixture
  // provider, which the presets name for both stages; Where to look offers no checkbox and says so, Ruling 13)
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: COPY.searchesView.heading })).toBeVisible();
  await addAirport(page, PLAN_COPY.from, 'LHR');
  await addAirport(page, PLAN_COPY.to, 'JFK');
  // why: a new search starts on Next 6 months; the smoke run pins two days so its space stays small
  await page.getByLabel(PLAN_COPY.whenToLeave).selectOption('range');
  await page.locator('#w-from').fill('2027-03-14');
  await page.locator('#w-to').fill('2027-03-15');
  await page.locator('#n-min').fill('10');
  await page.locator('#n-max').fill('11');
  const panel = page.locator(SMOKE.newSearchPanel);
  await expect(panel.getByRole('group', { name: COPY.newSearch.whereToLook })).toContainText(
    COPY.newSearch.notSetUpLink,
  );
  await expect(panel.getByRole('checkbox', { name: /^(Google Flights|Aviasales|SearchApi)/ })).toHaveCount(0);
  // the name is suggested from the airports picked (the airports table's cities for LHR and JFK), under More options
  await page.getByText(PLAN_COPY.moreOptions, { exact: true }).click();
  const searchName = SMOKE_SEARCH;
  await expect(page.getByRole('textbox', { name: PLAN_COPY.name })).toHaveValue(searchName);
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
  // test-013, spec §5.5: the fixture's trips are synthetic, so no price links out of the app, and its search reads no
  // flight lists, so nothing offers a read
  await expect(trips(page).locator(SMOKE.tripRow).first()).toBeVisible();
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Read flights/ })).toHaveCount(0);
  // the name the form suggested from the two airports picked, now the page's heading
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(searchName);

  // (2) the search's page: the run line, the banner, Cheapest trips (the fixture checks fares, so its dates are trips;
  // none is lower on the calendar) with their labels, the calendar with its key, its keyboard and its days' prices
  await page.goto(`/?view=dates&def=${defId}&d.nights=${NIGHTS}`);
  await expect(trips(page)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(searchName);
  await expect(page.locator(SMOKE.runLine)).toHaveText(
    /^Searched .+ · calendar prices for \d+ of \d+ dates? · \d+ dates? with flights read · what was searched$/,
  );
  await expect(banner(page)).toBeVisible();
  // the alarm plate: the red of spec §5.5, with white words (styles/world.css --alarm)
  await expect(banner(page)).toHaveCSS('background-color', 'rgb(163, 35, 26)');
  const rows = trips(page).locator(SMOKE.tripRow);
  const first = rows.first();
  // why: a row's source and age are its one label (design 2026-11-08 §5.1); the synthetic source is the banner above
  await expect(first.getByTestId('price-label')).toContainText(/ · (just now|\d+[hdm])/);
  await expect(first.getByRole('link', { name: SMOKE.detailsLink })).toBeVisible();
  await expect(lower(page)).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  await expect(page.getByRole('list', { name: SMOKE.calendarKey }).getByRole('listitem')).toHaveCount(5);
  // Ruling 18: each day of the window prints its trip's price with the dot (one stay in view each, so a trip a day)
  await expect(page.locator(SMOKE.tripDay)).toHaveCount(await rows.count());
  await expect(page.locator(SMOKE.tripDay).first().getByTestId('price-cell')).toContainText('£');
  const stop = page.locator(SMOKE.calendarTabStop);
  await expect(stop).toHaveCount(1);
  const before = await stop.getAttribute('data-day');
  // why: focus-visible applies once the keyboard is in use: focus() puts focus on the tab stop and the arrow key that
  // follows switches the page to keyboard modality, so the ring is then computed as for a Tab user.
  await stop.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stop).toHaveCount(1);
  await expect(stop).not.toHaveAttribute('data-day', before ?? '');
  await expect(stop).toBeFocused();
  await expect(stop).toHaveCSS('outline-style', 'solid');
  await expect(stop).toHaveCSS('outline-width', '2px');

  // (3) Enter opens the day's panel below the calendar, focus on its heading (Ruling 18); its trip row's › opens the
  // Trip page, whose URL carries the dates and the search page's filters and whose card shows the synthetic price
  // beside the red banner; the breadcrumb back keeps the filter. Escape on the panel puts focus back on the day.
  await stop.press('Enter');
  const dayPanel = page.getByRole('region', { name: SMOKE.dayPanel });
  await expect(dayPanel).toBeVisible();
  await expect(dayPanel.getByRole('heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dayPanel).toHaveCount(0);
  await expect(stop).toBeFocused();
  await stop.press('Enter');
  await dayPanel.locator(SMOKE.tripRow).first().getByRole('link', { name: SMOKE.detailsLink }).click();
  await expect(page.getByRole('region', { name: SMOKE.tripCard })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('view')).toBe('trip');
  expect(url.searchParams.get('depart')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(url.searchParams.get('return')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Task 9 fix round 1 (ruling): a trip link from the Search page carries the page's filters
  expect(url.searchParams.get('d.nights')).toBe(NIGHTS);
  await expect(banner(page)).toBeVisible();
  await expect(
    page.getByRole('region', { name: SMOKE.tripCard }).getByTestId('price-cell').first(),
  ).toContainText('£');
  // why: spec §5.5: a synthetic price never links out of the app
  await expect(page.locator(`${SMOKE.tripPage} a[target="_blank"]`)).toHaveCount(0);
  await page.locator(SMOKE.tripBack).click();
  await expect(trips(page)).toBeVisible();
  const back = new URL(page.url()).searchParams;
  expect(back.get('view')).toBe('dates');
  expect(back.get('d.nights')).toBe(NIGHTS);
  expect(back.get('depart')).toBeNull();

  // (4) a search's page by its id, ?view=definitions landing on Searches (the old Definitions URL), the breadcrumb naming the
  // search; the retired views' URLs land on Dates; ?view=coverage opens the coverage section
  await page.goto(`/?view=dates&def=${defId}`);
  await expect(trips(page)).toBeVisible();
  await page.goto('/?view=definitions');
  await expect(page.getByRole('heading', { level: 1, name: COPY.searchesView.heading })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('searches');
  await expect(smokeCard(page)).toHaveCount(1);
  // why: Ruling 9 — the nav names no search; a search's page carries its name in its breadcrumb instead
  await page.goto(`/?view=dates&def=${defId}`);
  await expect(page.getByRole('navigation', { name: SMOKE.crumbs }).getByText(searchName)).toBeVisible();
  await page.goto(`/?view=calendar&def=${defId}`);
  await expect(trips(page)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('dates');
  await page.goto(`/?view=coverage&def=${defId}`);
  await expect(trips(page)).toBeVisible();
  // Ruling 19: the landing opens the What was searched fold, moves focus to its summary and shows the full log; the
  // landing is then consumed, so it never travels to another search (final review I2)
  await expect(page).toHaveURL(new RegExp(`\\?view=dates&def=${defId}$`));
  const searched = page
    .getByRole('region', { name: SMOKE.folds })
    .locator('details', { hasText: SMOKE.searchedFold })
    .first();
  await expect(searched).toHaveAttribute('open', '');
  await expect(searched.locator('summary')).toBeFocused();
  await expect(page.getByRole('table', { name: COPY.coverageHeading })).toBeVisible();

  // (5) History: the charts draw in a real layout and the table names the synthetic source
  await page.goto('/?view=history');
  await expect(
    page.getByRole('figure', { name: COPY.historyView.fetchChartTitle }).locator('svg[role="application"]'),
  ).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText(SOURCE_LABELS.synthetic);
});

test('forced colours: the calendar key keeps its words, and the current nav entry its bar', async ({
  page,
}) => {
  // (7) spec §11: nothing by colour alone; jsdom cannot apply forced colours, so the browser checks it here
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
  await expect(trips(page)).toBeVisible();
  const key = page.getByRole('list', { name: SMOKE.calendarKey }).getByRole('listitem');
  await expect(key).toHaveCount(5);
  for (const item of await key.all()) {
    await expect(item).toBeVisible();
    await expect(item).not.toHaveText('');
  }
  // why: the days of every kind need a seed that has them; marks.spec.ts holds that forced-colours case
  const current = page.getByRole('navigation', { name: SMOKE.nav }).locator(SMOKE.navCurrent);
  await expect(current).toHaveCSS('border-bottom-style', 'solid');
  await expect(current).toHaveCSS('border-bottom-width', '4px');
});

test('at 375px a search’s page shows its rows, one month of days with its month buttons, a tap opens the day’s panel, and the filter row fits @phone', async ({
  page,
}) => {
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
  const row = trips(page).locator(SMOKE.tripRow).first();
  await expect(row).toBeVisible();
  // the rows lay out as two columns on a phone (rows.css): the row stays inside the window
  const rowBox = await row.boundingBox();
  expect((rowBox?.x ?? 0) + (rowBox?.width ?? 0)).toBeLessThanOrEqual(375);
  await expect(page.getByRole('button', { name: SMOKE.previousMonth })).toBeVisible();
  await expect(page.getByRole('button', { name: SMOKE.nextMonth })).toBeVisible();
  const days = page.locator(SMOKE.calendarDay);
  const months = await days.evaluateAll(
    (all) => new Set(all.map((c) => c.getAttribute('data-day')?.slice(0, 7))).size,
  );
  expect(months).toBe(1);
  // why: every day's box is at least 24 × 24 px, and nothing spills out of a day
  const small = await days.evaluateAll((all) =>
    all
      .filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width < 24 || r.height < 24;
      })
      .map((c) => c.getAttribute('data-day')),
  );
  expect(small).toEqual([]);
  // why: the printed price clips its own overflow, so it is measured as well as the day
  const spilled = await days.evaluateAll((all) =>
    all
      .filter((c) =>
        [c, c.querySelector('.cal-dp')].some(
          (e) => e !== null && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1),
        ),
      )
      .map((c) => c.getAttribute('data-day')),
  );
  expect(spilled).toEqual([]);
  // Ruling 18: a tap on a day opens its panel below the calendar (and does not leave the page)
  await days.first().tap();
  await expect(page.getByRole('region', { name: SMOKE.dayPanel })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('dates');
  // why: Ruling 16: one filter row, wrapping on a phone (no fold); it fits the window
  const filters = page.getByRole('group', { name: SMOKE.filterRow });
  await expect(filters).toBeVisible();
  const box = await filters.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  await expectNoSidewaysScroll(page);
});

/** The Trip page reached as an operator reaches it: a day's panel on the search's page, then its trip row's ›. */
async function openTripFromDay(page: Page, id: string) {
  await page.goto(`/?view=dates&def=${id}`);
  await page.locator(SMOKE.calendarTabStop).press('Enter');
  await page
    .getByRole('region', { name: SMOKE.dayPanel })
    .locator(SMOKE.tripRow)
    .first()
    .getByRole('link', { name: SMOKE.detailsLink })
    .click();
}

/** What each view shows only once its data has loaded: a named heading, table or row, never a timeout. */
const LOADED: Record<string, (page: Page) => Locator> = {
  dates: (p) => p.locator(SMOKE.tripRow),
  // why: the Trip page is reached from a day's panel (its trip row's › carries the dates)
  trip: (p) => p.getByRole('region', { name: SMOKE.tripCard }),
  history: (p) => p.getByRole('figure', { name: COPY.historyView.fetchChartTitle }),
  searches: (p) => p.locator(SMOKE.searchCard),
  definitions: (p) => p.locator(SMOKE.searchCard),
  // why: the fixture run fires no alert, so the loaded Alerts view is the one that says there are no rules yet
  alerts: (p) => p.getByText(COPY.alertsView.noRules),
  providers: (p) => p.getByRole('region', { name: COPY.provider.fixture }),
  // why: Settings is three links, each a heading
  settings: (p) => p.getByRole('heading', { name: COPY.settingsView.section.sources }),
  // why: the report's area headings draw only once the report has loaded
  status: (p) => p.getByRole('heading', { level: 3 }),
};

test('at 375px the nav is one row of two 44px links, the top bar wraps under it, and no loaded view scrolls the page sideways, light and dark (UI-005, UI-009, UI-011) @phone', async ({
  page,
}) => {
  const id = await searchId(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [view, loaded] of Object.entries(LOADED)) {
      const label = `${view}, ${colorScheme}`;
      if (view === 'trip') await openTripFromDay(page, id);
      else await page.goto(view === 'dates' ? `/?view=dates&def=${id}` : `/?view=${view}`);
      const nav = page.getByRole('navigation', { name: SMOKE.nav });
      await expect(nav).toBeVisible();
      // why: Ruling 9 — the same two links in one row at every width, no menu
      const links = await nav.getByRole('link').all();
      expect(links, label).toHaveLength(SMOKE.navItems.length);
      const tops = new Set<number>();
      for (const link of links) {
        await expect(link).toBeInViewport({ ratio: 1 });
        const box = await link.boundingBox();
        expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(44);
        tops.add(Math.round(box?.y ?? -1));
      }
      expect(tops.size, `${label}: one row`).toBe(1);
      // why: Ruling 10 — the health line, then the limits, under the nav
      const health = page
        .getByRole('status')
        .filter({ hasText: /All working|needs attention|failing|things need you|Status:/ });
      await expect(health.first(), label).toBeVisible();
      const healthBox = await health.first().boundingBox();
      const navBox = await nav.boundingBox();
      expect(healthBox?.y ?? 0, label).toBeGreaterThanOrEqual((navBox?.y ?? 0) + (navBox?.height ?? 0) - 1);
      // why: measured only after the view's own content is on the page, never on its loading state
      await expect(loaded(page).first(), label).toBeVisible();
      await expectNoSidewaysScroll(page);
    }
  }
});

// final review I3: the ground is the tokens' page colour on every view, light and dark; the views not yet rebuilt keep
// their plates, but their heading and crumbs on the ground read in dark too. Shots of each view at 375 px for the report.
test('at 375px every view sits on the tokens’ ground, its heading and crumbs readable on what they sit on, light and dark @phone', async ({
  page,
}) => {
  const id = await searchId(page);
  const views = [
    'searches',
    'dates',
    'definitions',
    'trip',
    'settings',
    'providers',
    'alerts',
    'status',
    'history',
  ];
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const view of views) {
      const label = `${view}, ${colorScheme}`;
      if (view === 'trip') await openTripFromDay(page, id);
      else if (view === 'definitions') await page.goto(`/?view=definitions&edit=${id}`);
      else
        await page.goto(
          view === 'dates' || view === 'history' ? `/?view=${view}&def=${id}` : `/?view=${view}`,
        );
      if (view === 'definitions')
        await expect(page.getByRole('group', { name: COPY.newSearch.whereToLook }), label).toBeVisible();
      else await expect((LOADED[view] ?? ((p: Page) => p.locator('h1')))(page).first(), label).toBeVisible();
      const seen = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--t-bg)';
        document.body.append(probe);
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
        const lum = (c: string) => {
          const [r = 0, g = 0, b = 0] = rgb(c).map((v) => {
            const x = v / 255;
            return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        // the colour a heading is painted on: its nearest ancestor with an opaque background
        const groundOf = (el: Element | null): string => {
          for (let e = el; e !== null; e = e.parentElement) {
            const c = getComputedStyle(e).backgroundColor;
            if (rgb(c).length === 3 || (rgb(c)[3] ?? 0) > 0) return c;
          }
          return getComputedStyle(document.body).backgroundColor;
        };
        const ratio = (el: Element) => {
          const [a, b] = [lum(getComputedStyle(el).color), lum(groundOf(el))];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        // the heading and each breadcrumb, against what each sits on
        const read = [...document.querySelectorAll('main h1, .crumbs a, .crumbs [aria-current]')];
        return {
          body: getComputedStyle(document.body).backgroundColor,
          image: getComputedStyle(document.body).backgroundImage,
          bg,
          headed: document.querySelector('main h1') !== null,
          low: read.filter((el) => ratio(el) < 4.5).map((el) => `${el.textContent}: ${ratio(el).toFixed(2)}`),
        };
      });
      expect(seen.image, label).toBe('none');
      expect(seen.body, label).toBe(seen.bg);
      expect(seen.headed, label).toBe(true);
      expect(seen.low, `${label}: the heading and crumbs against what they sit on`).toEqual([]);
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/ground-shots/${view}-375-${colorScheme}.png`,
        fullPage: true,
      });
    }
  }
});

test('at 1280px every loaded view fits without scrolling sideways, light and dark, with the limits on the right of the health line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await searchId(page);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [view, loaded] of Object.entries(LOADED)) {
      const label = `${view}, ${colorScheme}`;
      if (view === 'trip') await openTripFromDay(page, id);
      else await page.goto(view === 'dates' ? `/?view=dates&def=${id}` : `/?view=${view}`);
      await expect(loaded(page).first(), label).toBeVisible();
      const limits = page.getByRole('region', { name: COPY.topBar.limitsLabel });
      await expect(limits, label).toBeVisible();
      const health = page
        .getByRole('status')
        .filter({ hasText: /All working|needs attention|failing|things need you|Status:/ });
      const [h, l] = [await health.first().boundingBox(), await limits.boundingBox()];
      // why: Ruling 10 — health on the left, the limits on its right on a desktop
      expect((l?.x ?? 0) - ((h?.x ?? 0) + (h?.width ?? 0)), label).toBeGreaterThanOrEqual(0);
      await expectNoSidewaysScroll(page);
    }
  }
});

test('at 375 x 812 Cheapest trips starts in the first screen (Ian, 2026-10-27) @phone', async ({ page }) => {
  await page.goto(`/?view=dates&def=${await searchId(page)}`);
  const heading = trips(page).getByRole('heading', { name: SMOKE.cheapestTrips });
  await expect(heading).toBeVisible();
  const box = await heading.boundingBox();
  // the section's heading is in the first screen, so the operator sees it without scrolling
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(812);
});

test('at 375px the new-search panel sits below the list, and the cards list fits with 44px actions @phone', async ({
  page,
}) => {
  await page.goto('/');
  const card = smokeCard(page);
  await expect(card).toBeVisible();
  // Ruling 13: the cards come first in the DOM at every width, so on a phone the panel is below them
  const form = await page.locator(SMOKE.newSearchForm).boundingBox();
  const last = await page.locator(SMOKE.searchCard).last().boundingBox();
  expect(form?.y ?? 0).toBeGreaterThanOrEqual((last?.y ?? Number.POSITIVE_INFINITY) + (last?.height ?? 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const actions = await page.locator(SMOKE.cardAction).all();
  expect(actions.length).toBeGreaterThan(0);
  for (const action of actions) {
    const box = await action.boundingBox();
    expect(box?.height ?? 0, (await action.textContent()) ?? '').toBeGreaterThanOrEqual(44);
  }
});

/**
 * Serves `/providers` with the three sources of Where to look set up beside the fixture one, and SearchApi's month, so
 * the panel shows its three checkboxes with their costs as mockup 01 does. Nothing is pressed: the api never sees them.
 */
async function showEverySource(page: Page) {
  await page.route('**/api/providers', async (route) => {
    const real = apiContract.providersResponseSchema.parse(await (await route.fetch()).json());
    const base = real.providers[0];
    if (base === undefined) throw new Error('fixture mode lists the fixture provider');
    const source = (providerId: 'camoufox' | 'travelpayouts' | 'searchapi', plan: '40usd' | 'free') => ({
      ...base,
      providerId,
      displayName: providerId,
      plan,
      usage: [],
    });
    await route.fulfill({
      json: {
        ...real,
        providers: [
          ...real.providers,
          source('camoufox', 'free'),
          source('travelpayouts', 'free'),
          source('searchapi', '40usd'),
        ],
        presets: {
          ...real.presets,
          providers: { ...real.presets.providers, discovery: ['camoufox', 'travelpayouts'] },
        },
      },
    });
  });
  await page.route('**/api/budget', async (route) => {
    const real = apiContract.budgetResponseSchema.parse(await (await route.fetch()).json());
    const month = real.scopes.find((u) => u.scope === 'global-month');
    await route.fulfill({
      json: {
        ...real,
        scopes: [
          ...real.scopes,
          ...(month === undefined
            ? []
            : [{ ...month, scope: 'provider-month:searchapi', calls: 588, cap: 1000 }]),
        ],
      },
    });
  });
}

// Ruling 13 (Trips and Search Task 7): the new-search panel after the cards in the DOM at every width, sticky beside
// them from 900 px, its fields readable in light and dark, the page never scrolling sideways. Screenshots go to
// test-results/panel-shots/ for the report, beside mockup 01.
for (const width of [375, 900, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`the Trips page with the new-search panel at ${width}px, ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showEverySource(page);
      await page.goto('/');
      const panel = page.locator(SMOKE.newSearchPanel);
      await expect(
        panel.getByRole('heading', { level: 2, name: COPY.searchesView.sideHeading }),
      ).toBeVisible();
      await expect(page.locator(SMOKE.searchCard).first()).toBeVisible();
      // the cards come before the panel in the DOM
      const cardsFirst = await page.evaluate((sel) => {
        const card = document.querySelector('[data-card]');
        const side = document.querySelector(sel);
        return card !== null && side !== null && (card.compareDocumentPosition(side) & 4) !== 0;
      }, SMOKE.newSearchPanel);
      expect(cardsFirst).toBe(true);
      // sticky beside the cards from 900 px; in the single column below
      const position = await panel.evaluate((el) => getComputedStyle(el).position);
      const [cardBox, panelBox] = [
        await page.locator(SMOKE.searchCard).first().boundingBox(),
        await panel.boundingBox(),
      ];
      if (width >= 900) {
        expect(position).toBe('sticky');
        expect(panelBox?.x ?? 0).toBeGreaterThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0));
      } else {
        expect(position).toBe('static');
        expect(panelBox?.y ?? 0).toBeGreaterThan(cardBox?.y ?? 0);
      }
      // the fields read in dark: When to leave's ink differs from its ground (Task 6 note: unreadable before)
      const date = page.locator('#w-choice');
      const [ink, ground] = await date.evaluate((el) => [
        getComputedStyle(el).color,
        getComputedStyle(el).backgroundColor,
      ]);
      expect(ink).not.toBe(ground);
      if (colorScheme === 'dark') expect(ground).not.toBe('rgb(255, 255, 255)');
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/panel-shots/trips-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByText(PLAN_COPY.moreOptions, { exact: true }).click();
      await expect(page.getByLabel(COPY.newSearch.repeat)).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/panel-shots/trips-${width}-${colorScheme}-more.png`,
        fullPage: true,
      });
    });

// Settings plan ruling 10, Global Constraints layout check: the top bar with its longest SearchApi line ("SearchApi:
// 9,988 credits left · resets 1 Dec · as of 14:05": a balance with its reset day, read more than ten minutes ago) on the
// Settings page, at 375 and 1280 px in light and dark, never scrolling sideways. Screenshots go to
// test-results/credits-shots/ for the report, beside mockup 04's top bar.
for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`the top bar's longest SearchApi line on Settings at ${width}px, ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showEverySource(page);
      await page.route('**/api/searchapi/account', async (route) => {
        await route.fulfill({
          json: {
            account: {
              remaining: 9988,
              monthlyAllowance: 10000,
              periodEnd: '2026-12-01',
              // why: long past, so it is always older than ten minutes; January's London time is GMT
              fetchedAt: '2026-01-15T14:05:00.000Z',
            },
          },
        });
      });
      await page.goto('/?view=settings');
      const line = page.getByText('SearchApi: 9,988 credits left · resets 1 Dec · as of 14:05');
      await expect(line).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({ path: `test-results/credits-shots/settings-${width}-${colorScheme}.png` });
    });

test('"+ New search" moves focus to From in the panel', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator(SMOKE.searchCard).first()).toBeVisible();
  await page.getByRole('button', { name: COPY.searchesView.newSearch }).click();
  await expect(page.getByRole('combobox', { name: PLAN_COPY.from })).toBeFocused();
  await expect(page.getByRole('combobox', { name: PLAN_COPY.from })).toBeInViewport();
});

// Task 7 fix round 1: the Edit page is the panel's form on the same tokens and face, at 375 and 1280 px, light and dark
for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`the Edit page shares the form, with Limits and checks, at ${width}px, ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showEverySource(page);
      const id = await searchId(page);
      await page.goto(`/?view=definitions&edit=${id}`);
      await expect(page.getByRole('group', { name: COPY.newSearch.whereToLook })).toBeVisible();
      await expect(page.getByRole('navigation', { name: SMOKE.crumbs })).toBeVisible();
      // the tokens' ground and surface and the UI face, not the board's steel and flap lettering: each colour is
      // compared with the token it must be, resolved by the page itself
      const heading = page.getByRole('heading', { level: 1 });
      expect(await heading.evaluate((el) => getComputedStyle(el).textTransform)).toBe('none');
      expect(await heading.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^ui-sans-serif/);
      const colours = await page.evaluate(() => {
        const token = (name: string) => {
          const probe = document.createElement('div');
          probe.style.backgroundColor = `var(${name})`;
          document.body.append(probe);
          const c = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return c;
        };
        const plate = document.querySelector('.def-form');
        return {
          body: getComputedStyle(document.body).backgroundColor,
          image: getComputedStyle(document.body).backgroundImage,
          plate: plate === null ? null : getComputedStyle(plate).backgroundColor,
          bg: token('--t-bg'),
          surface: token('--t-surface'),
        };
      });
      expect(colours.image).toBe('none');
      expect(colours.body).toBe(colours.bg);
      expect(colours.plate).toBe(colours.surface);
      const date = page.locator('#w-from');
      const [ink, field] = await date.evaluate((el) => [
        getComputedStyle(el).color,
        getComputedStyle(el).backgroundColor,
      ]);
      expect(ink).not.toBe(field);
      if (colorScheme === 'dark') expect(field).not.toBe('rgb(255, 255, 255)');
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/panel-shots/edit-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByText(PLAN_COPY.moreOptions, { exact: true }).click();
      await page.getByText(COPY.newSearch.limitsHeading, { exact: true }).click();
      await expect(page.getByLabel(COPY.maxCalls)).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/panel-shots/edit-${width}-${colorScheme}-limits.png`,
        fullPage: true,
      });
    });

// Task 7 fix round 2: the panel filled as mockup 01 shows it (two From airports, To, the dates, SearchApi ticked), its
// sentence answered from a served estimate, so the chips, the sentence and the costed press are compared with the
// mockup. Nothing is pressed.
for (const [width, colorScheme] of [
  [1280, 'light'],
  [1280, 'dark'],
  [375, 'light'],
] as const)
  test(`the new-search panel filled at ${width}px, ${colorScheme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await showEverySource(page);
    await page.route('**/api/definitions/estimate', (route) =>
      route.fulfill({
        json: estimateResponse({
          estimate: estimate({
            seconds: 1500,
            flightLists: {
              pages: 23,
              seconds: 100,
              pairs: 15,
              returns: true,
              pagesMax: 580,
              secondsMax: 1825,
            },
          }),
          billedCalls: [{ providerId: 'searchapi', calls: 12, left: 412, window: 'month' }],
        }),
      }),
    );
    await page.goto('/');
    const panel = page.locator(SMOKE.newSearchPanel);
    await expect(panel.getByRole('heading', { level: 2 })).toBeVisible();
    await addAirport(page, PLAN_COPY.from, 'LHR');
    await addAirport(page, PLAN_COPY.from, 'LGW');
    await addAirport(page, PLAN_COPY.to, 'JFK');
    await page.getByLabel(PLAN_COPY.whenToLeave).selectOption('range');
    await page.locator('#w-from').fill('2027-03-14');
    await page.locator('#w-to').fill('2027-09-14');
    await panel.getByRole('checkbox', { name: /^SearchApi · / }).check();
    await expect(panel.getByRole('status', { name: COPY.newSearch.estimateRegion })).toContainText(
      'Then flights are read for the cheapest dates until the 5 cheapest stop changing.',
    );
    await expect(panel.getByRole('button', { name: 'Search · 12 SearchApi credits' })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await panel.screenshot({ path: `test-results/panel-shots/panel-filled-${width}-${colorScheme}.png` });
    await page.screenshot({
      path: `test-results/panel-shots/trips-filled-${width}-${colorScheme}.png`,
      fullPage: true,
    });
  });
