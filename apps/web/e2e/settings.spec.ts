import { SETTING_LABELS } from '@gmt/core';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { COPY } from '../src/copy.js';
import { expectNoSidewaysScroll } from './layout.js';
import {
  showFullSettings,
  showLimitsAndEmail,
  showSetAsideSettings,
  showSystemChecks,
} from './settingsFixtures.js';
import { FIXTURE_SEARCH } from './tripFixtures.js';

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
        // fix round 1, important 2: at 375 px the row scrolls, and part of the last link always shows, so a fourth
        // section is seen to be there
        expect(await nav.getByRole('list').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
        await expect(nav.getByRole('link').last()).toBeInViewport();
        expect(navBox.y + navBox.height).toBeLessThanOrEqual(headBox.y);
      } else {
        // a side list beside the section
        expect(navBox.x + navBox.width).toBeLessThanOrEqual(headBox.x);
      }
      // the switch's state in words beside it, not by colour alone
      const sa = page.getByRole('region', { name: COPY.newSearch.source.searchapi });
      await expect(sa.getByText(S.switchOn)).toBeVisible();
      await expect(
        page.getByRole('region', { name: S.everySource }).getByRole('link', { name: S.callsAndCapsLink }),
      ).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    });

for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`Settings › Price sources at ${width}px, ${colorScheme}, with settings set aside and no browser: every one has its field, Every source links Calls and caps (review I1, I3)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showSetAsideSettings(page);
      await page.goto('/?view=settings');
      const browser = page.getByRole('region', { name: COPY.newSearch.source.camoufox });
      await expect(browser).toContainText(S.browserNotSetUp);
      for (const [where, role, name] of [
        [browser, 'spinbutton', SETTING_LABELS.FLIGHT_READ_PATIENCE],
        [browser, 'combobox', SETTING_LABELS.CAMOUFOX_BROWSER_WINDOW],
        [
          page.getByRole('region', { name: COPY.newSearch.source.searchapi }),
          'spinbutton',
          SETTING_LABELS.SEARCHAPI_BILLING_DAY,
        ],
        [
          page.getByRole('region', { name: S.everySource }),
          'spinbutton',
          SETTING_LABELS.DISCOVERY_REFRESH_DAYS,
        ],
      ] as const)
        await expect(where.getByRole(role, { name })).toBeVisible();
      await expect(page.getByText(S.valueSetAside)).toHaveCount(4);
      const link = page
        .getByRole('region', { name: S.everySource })
        .getByRole('link', { name: S.callsAndCapsLink });
      await expect(link).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-set-aside-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await link.click();
      expect(new URL(page.url()).searchParams.get('view')).toBe('providers');
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
  await page.getByRole('button', { name: S.saveLabel.sources }).click();
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

// Settings plan Task 6 (rulings 5, 11, 12, 14): Limits and Email and alerts at 375 and 1280 px in light and dark, never
// scrolling sideways, and a mail password typed and saved that is never left in the page.

const ids = z.array(z.object({ id: z.string() }));

/** A search for the alert rule to name: the smoke's when it ran first, else one saved here (as the Trip spec does). */
async function searchId(request: APIRequestContext): Promise<string> {
  const [first] = ids.parse(await (await request.get('/api/definitions')).json());
  if (first !== undefined) return first.id;
  // why: the api refuses a change without the header its own client sends
  const saved = await request.post('/api/definitions', {
    data: FIXTURE_SEARCH,
    headers: { 'X-Requested-With': 'get-me-there' },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return z.object({ id: z.string() }).parse(await saved.json()).id;
}

/** The boot id the page reads before a save and after it; the save below moves it on, as a restart would. */
async function serveHealth(page: Page, boot: { id: string }): Promise<void> {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ok: true,
        degraded: false,
        bootId: boot.id,
        db: { ok: true, sizeBytes: 1 },
        providers: [],
        scheduler: { jobCount: 0, nextRun: null, lastExecutionAt: null, degraded: false, blockedSince: null },
      },
    }),
  );
}

for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`Settings › Limits at ${width}px, ${colorScheme}: the two sentences and the month's spend, no sideways scroll`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showLimitsAndEmail(page, await searchId(request));
      await page.goto('/?view=settings&section=limits');
      await expect(page.getByRole('textbox', { name: SETTING_LABELS.MONTHLY_SPEND_CAP_PENCE })).toHaveValue(
        '35',
      );
      await expect(page.getByRole('spinbutton', { name: SETTING_LABELS.EXECUTION_MAX_CALLS })).toHaveValue(
        '10',
      );
      await expect(page.getByText(S.limits.spent('£0'))).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-limits-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    });

    test(`Settings › Email and alerts at ${width}px, ${colorScheme}: Gmail stored, the rule and its last send, no sideways scroll`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showLimitsAndEmail(page, await searchId(request));
      await page.goto('/?view=settings&section=email');
      await expect(page.getByRole('radio', { name: S.email.modeGmail })).toBeChecked();
      await expect(page.getByRole('textbox', { name: S.email.gmailAddress })).toHaveValue(
        'traveller@example.com',
      );
      const rules = page.getByRole('list', { name: S.alerts.heading });
      await expect(rules.getByRole('listitem')).toHaveCount(1);
      await expect(rules).toContainText(S.alerts.lastSent('14 Oct 2026 13:00'));
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-email-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    });
  }

// Settings plan Task 7 (ruling 13): System at 375 and 1280 px in light and dark, every kind of line, no sideways scroll,
// and a fix that links to its section.
for (const width of [375, 1280] as const)
  for (const colorScheme of ['light', 'dark'] as const)
    test(`Settings › System at ${width}px, ${colorScheme}: one line per check, off and failing in words, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await showSystemChecks(page);
      await page.goto('/?view=settings&section=system');
      const list = page.getByRole('list', { name: S.systemLabel });
      await expect(list.getByRole('listitem').first()).toBeVisible();
      await expect(list).toContainText(`${S.sysState.off}: Can't be seen from inside the container.`);
      await expect(list).toContainText(`${S.sysState.fail}: Mail server port isn't valid`);
      await expect(list).toContainText(`${S.sysState.warn}: SearchApi key in .env is ignored`);
      await expect(list.getByRole('link', { name: 'Open Settings › Email and alerts' })).toHaveAttribute(
        'href',
        '/?view=settings&section=email',
      );
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: `test-results/settings-shots/settings-system-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    });

test("at 375px the section row is scrolled so the open section's link is fully in view", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await showSystemChecks(page);
  await page.goto('/?view=settings&section=system');
  const link = page.getByRole('navigation', { name: S.sectionsLabel }).locator('a[aria-current="page"]');
  await expect(link).toHaveText(S.section.system);
  await expect(async () => {
    const box = await link.boundingBox();
    if (box === null) throw new Error('the current link is on the page');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }).toPass();
  await expectNoSidewaysScroll(page);
});

test('a System fix link opens its Settings section', async ({ page }) => {
  await showSystemChecks(page);
  await page.goto('/?view=settings&section=system');
  await page.getByRole('link', { name: 'Open Settings › Email and alerts' }).click();
  await expect(page.getByRole('heading', { level: 2, name: S.section.email })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('section')).toBe('email');
});

test('a mail password typed and saved is never left in the page: the PUT carries it, the page shows only "saved"', async ({
  page,
}) => {
  // a synthetic password, never a real one
  const PASS = 'synthetic-mail-pass-e2e-0123';
  const boot = { id: 'boot-a' };
  await serveHealth(page, boot);
  const bodies: unknown[] = [];
  // why: the save is answered here, so the fixture-mode api is not restarted under the other tests
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    bodies.push(route.request().postDataJSON());
    boot.id = 'boot-b';
    await route.fulfill({ json: { warnings: [], applies: 'now' } });
  });
  await page.goto('/?view=settings&section=email');
  await page.getByRole('textbox', { name: S.email.gmailAddress }).fill('traveller@example.com');
  const field = page.locator('input[type="password"]');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'new-password');
  await field.fill(PASS);
  await page.getByRole('textbox', { name: SETTING_LABELS.ALERT_EMAIL_TO }).fill('alerts@example.com');
  await page.getByRole('button', { name: S.saveLabel.email }).click();
  await expect(page.getByText(S.restarted)).toBeVisible();
  expect(bodies).toEqual([
    {
      changes: {
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '465',
        SMTP_USER: 'traveller@example.com',
        SMTP_PASS: PASS,
        ALERT_EMAIL_TO: 'alerts@example.com',
        ALERT_EMAIL_FROM: 'traveller@example.com',
      },
    },
  ]);
  expect(await page.content()).not.toContain(PASS);
  const values = await page.$$eval('input', (els) =>
    els.map((el) => (el instanceof HTMLInputElement ? el.value : '')),
  );
  expect(values).not.toContain(PASS);
});
