import { apiContract } from '@gmt/core';
import type { Page } from '@playwright/test';

/**
 * The Settings page as mockup 04 draws it, served over the real api's answers (settings plan Task 5): both API keys
 * saved (only their last four ever reach the page), the browser set up and ready with its consent record and two pages
 * at once, the three sources listed, and SearchApi's own balance. The fixture-mode api has none of these, so the bodies
 * are the real ones with these fields laid over them, each parsed by its contract schema.
 */
export async function showFullSettings(page: Page): Promise<void> {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = apiContract.settingsViewSchema.parse(await (await route.fetch()).json());
    await route.fulfill({
      json: apiContract.settingsViewSchema.parse({
        ...real,
        secrets: {
          ...real.secrets,
          TRAVELPAYOUTS_TOKEN: { set: true, last4: '91c0' },
          SEARCHAPI_KEY: { set: true, last4: '3f2a' },
        },
        values: { ...real.values, SEARCHAPI_PLAN: '40usd', SEARCHAPI_BILLING_DAY: '1' },
        newSearchSources: { discovery: ['travelpayouts', 'camoufox'], verification: ['searchapi'] },
        envOnly: { ...real.envOnly, camoufoxEnabled: true },
      }),
    });
  });
  await page.route('**/api/status', async (route) => {
    const real = apiContract.statusResponseSchema.parse(await (await route.fetch()).json());
    const others = real.checks.filter((c) => c.id !== 'worker' && c.id !== 'consent');
    await route.fulfill({
      json: apiContract.statusResponseSchema.parse({
        ...real,
        pagesAtOnce: 2,
        checks: [
          ...others,
          {
            id: 'worker',
            area: 'worker',
            providerId: 'camoufox',
            label: null,
            state: 'ok',
            summary: 'ready',
            note: null,
            offReason: null,
            fix: null,
          },
          {
            id: 'consent',
            area: 'consent',
            providerId: null,
            label: null,
            state: 'ok',
            summary: 'consent rejected, expires Thu, 18 Nov 2027, 10:00 (Europe/London) (cookie)',
            note: null,
            offReason: null,
            fix: null,
            expiresOn: '2027-11-18',
          },
        ],
      }),
    });
  });
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
      },
    });
  });
  await page.route('**/api/searchapi/account', async (route) => {
    await route.fulfill({
      json: {
        account: {
          remaining: 412,
          monthlyAllowance: 1000,
          periodEnd: '2026-12-01',
          // why: long past, so the line always carries its "as of" time; January's London time is GMT
          fetchedAt: '2026-01-15T14:05:00.000Z',
        },
      },
    });
  });
}

/**
 * Settings › Limits and Email and alerts as mockup 04 draws them (settings plan Task 6), over the real api's answers:
 * a £35 spend limit and 10 credits a run stored, Gmail stored (its password only as set, never a value), and one alert
 * rule on the search `definitionId` (a London → New York search of the real api) that sent once. The fixture-mode api
 * has none of these, so the bodies are laid over the real ones, each parsed by its contract schema.
 */
export async function showLimitsAndEmail(page: Page, definitionId: string): Promise<void> {
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const real = apiContract.settingsViewSchema.parse(await (await route.fetch()).json());
    await route.fulfill({
      json: apiContract.settingsViewSchema.parse({
        ...real,
        secrets: { ...real.secrets, SMTP_PASS: { set: true, last4: null } },
        values: {
          ...real.values,
          MONTHLY_SPEND_CAP_PENCE: '3500',
          EXECUTION_MAX_CALLS: '10',
          SMTP_HOST: 'smtp.gmail.com',
          SMTP_PORT: '465',
          SMTP_TLS: 'implicit',
          SMTP_USER: 'traveller@example.com',
          ALERT_EMAIL_FROM: 'traveller@example.com',
          ALERT_EMAIL_TO: 'alerts@example.com',
        },
      }),
    });
  });
  const rule = apiContract.alertRuleSchema.parse({
    id: 'rule-e2e',
    definitionId,
    type: 'absolute',
    thresholdPence: 40000,
    pct: null,
    basis: 'verified',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
  await page.route(
    (url) => url.pathname === '/api/alerts',
    (route) => (route.request().method() === 'GET' ? route.fulfill({ json: [rule] }) : route.fallback()),
  );
  await page.route(
    (url) => url.pathname === '/api/alerts/events',
    (route) =>
      route.fulfill({
        json: apiContract.alertEventSchema.array().parse([
          {
            id: 1,
            ruleId: rule.id,
            identityKey: 'k',
            observationId: null,
            calendarPriceId: null,
            dedupKey: 'd1',
            firedAt: '2026-10-14T12:00:00.000Z',
            status: 'notified',
            reason: null,
            payload: {},
          },
        ]),
      }),
  );
}
