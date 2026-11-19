import { expect, test } from '@playwright/test';
import { COPY } from '../src/copy.js';
import { expectNoSidewaysScroll } from './layout.js';
import { showFullSettings } from './settingsFixtures.js';

// Settings plan Task 5 (rulings 9, 10, 14; Global Constraints layout checks): the Settings page through the built SPA,
// its Price sources at 375 and 1280 px in light and dark, never scrolling sideways, and a key typed and saved that is
// never left in the page. Screenshots go to test-results/settings-shots/ for the report, beside mockup 04.

const S = COPY.settingsView;

test('against the real api: the page reads GET /settings and shows this install as it is (fixture mode: no keys, no browser)', async ({
  page,
}) => {
  await page.goto('/?view=settings');
  await expect(page.getByRole('heading', { level: 1, name: S.heading })).toBeVisible();
  const browser = page.getByRole('region', { name: COPY.newSearch.source.camoufox });
  await expect(browser).toContainText(S.browserNotSetUp);
  await expect(browser.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('region', { name: COPY.newSearch.source.searchapi })).toContainText(
    S.searchapiNoKey,
  );
  await page
    .getByRole('navigation', { name: S.sectionsLabel })
    .getByRole('link', { name: S.section.system })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: S.section.system })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('section')).toBe('system');
});

for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`Settings › Price sources at ${width}px, ${colorScheme}: the section links, the three sources, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showFullSettings(page);
      await page.goto('/?view=settings');
      await expect(page.getByText(S.browserReady)).toBeVisible();
      await expect(page.getByText(S.credits(412, null), { exact: true })).toBeVisible();
      await expect(page.getByText(S.secretEnds('91c0'))).toBeVisible();
      const nav = page.getByRole('navigation', { name: S.sectionsLabel });
      const heading = page.getByRole('heading', { level: 2, name: S.section.sources });
      const navBox = await nav.boundingBox();
      const headBox = await heading.boundingBox();
      if (navBox === null || headBox === null)
        throw new Error('the section list and heading are on the page');
      if (width === 375) {
        // one row of links above the section
        const tops = new Set<number>();
        for (const link of await nav.getByRole('link').all())
          tops.add(Math.round((await link.boundingBox())?.y ?? -1));
        expect(tops.size).toBe(1);
        expect(navBox.y + navBox.height).toBeLessThanOrEqual(headBox.y);
      } else {
        // a side list beside the section
        expect(navBox.x + navBox.width).toBeLessThanOrEqual(headBox.x);
      }
      // the switch's state in words beside it, not by colour alone
      const sa = page.getByRole('region', { name: COPY.newSearch.source.searchapi });
      await expect(sa.getByText(S.switchOn)).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    });

test('a key typed and saved is never left in the page: the PUT carries it, the page shows only its last four', async ({
  page,
}) => {
  // a synthetic key, never a real one
  const KEY = 'sk-e2e-synthetic-0123456789abcdef';
  await showFullSettings(page);
  let bootId = 'boot-a';
  const bodies: unknown[] = [];
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        degraded: false,
        bootId,
        db: { ok: true, sizeBytes: 1 },
        providers: [],
        scheduler: { jobCount: 0, nextRun: null, lastExecutionAt: null, degraded: false, blockedSince: null },
      },
    }),
  );
  // why: the save is answered here, so the fixture-mode api is not restarted under the other tests
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    bodies.push(route.request().postDataJSON());
    bootId = 'boot-b';
    await route.fulfill({ json: { warnings: [], applies: 'now' } });
  });
  await page.goto('/?view=settings');
  const card = page.getByRole('region', { name: COPY.newSearch.source.searchapi });
  await expect(card.getByText(S.secretEnds('3f2a'))).toBeVisible();
  await card.getByRole('button', { name: S.replace }).click();
  const field = card.locator('input[type="password"]');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await field.fill(KEY);
  await page.getByRole('button', { name: S.save(S.section.sources) }).click();
  await expect(page.getByText(S.restarted)).toBeVisible();
  expect(bodies).toEqual([{ changes: { SEARCHAPI_KEY: KEY } }]);
  await expect(field).toHaveCount(0);
  await expect(card.getByText(S.secretEnds('3f2a'))).toBeVisible();
  expect(await page.content()).not.toContain(KEY);
  const values = await page.$$eval('input', (els) =>
    els.map((el) => (el instanceof HTMLInputElement ? el.value : '')),
  );
  expect(values).not.toContain(KEY);
});
