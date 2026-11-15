import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { gmtAliases } from '../../../vitest.aliases.js';
import { expectNoSidewaysScroll } from './layout.js';

// Trips and Search plan, Task 5: the shared trip and calendar rows in a real layout, at 375 px and 1280 px, light and
// dark: a long seller, three airlines each way and a failed read's reason wrap, and nothing scrolls sideways. The rows
// are mounted by a test-only harness (e2e/rowsHarness.tsx) that this spec bundles itself with Vite and serves through
// the page's own content; the app has no route for it. The harness holds synthetic values only.

const WEB = fileURLToPath(new URL('..', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
let html = '';

test.beforeAll(async () => {
  const out = await build({
    root: WEB,
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    resolve: { alias: gmtAliases(ROOT) },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      cssCodeSplit: false,
      lib: {
        entry: fileURLToPath(new URL('./rowsHarness.tsx', import.meta.url)),
        formats: ['iife'],
        name: 'RowsHarness',
      },
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]).flatMap((o) => ('output' in o ? o.output : []));
  const code = outputs.map((o) => (o.type === 'chunk' ? o.code : '')).join('\n');
  const css = outputs
    .map((o) => (o.type === 'asset' && String(o.fileName).endsWith('.css') ? String(o.source) : ''))
    .join('\n');
  // why: a script is never closed by the text it holds
  html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:var(--t-bg);color:var(--t-ink);font:400 15px/1.4 system-ui,sans-serif}</style><style>${css}</style></head><body><div id="root"></div><script>${code.replaceAll('</script', '<\\/script')}</script></body></html>`;
});

for (const width of [375, 1280] as const)
  for (const scheme of ['light', 'dark'] as const)
    test(`the rows at ${width}px, ${scheme}: long seller, three airlines and a failed read wrap, no sideways scroll`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.setContent(html);
      const trips = page.getByTestId('trips').getByRole('listitem');
      await expect(page.getByTestId('trip-row').first()).toBeVisible();
      // the head row is aria-hidden; the two trips and the calendar row are the list's items
      await expect(trips).toHaveCount(2);
      // three long airline names each way, and a booking link on a long host: named in full, wrapped, never sideways
      await expect(page.getByTestId('trips')).toContainText(
        'Virgin Atlantic Airways Limited, Aer Lingus Regional, British Airways Cityflyer',
      );
      const host = 'flights-booking.partner-redirects.seller-checkout.google.com';
      const book = page.getByRole('link', { name: new RegExp(`Book on ${host.replaceAll('.', '\\.')}`) });
      await expect(book).toBeAttached();
      // the words are drawn at a desktop; a phone shows "£412 ↗" and keeps them in the link's name
      if (width >= 720) await expect(book).toContainText(host);
      await expect(page.getByTestId('row-airports').first()).toHaveText('LGW → JFK');
      await expect(page.getByTestId('calendar-row')).toContainText("Flights couldn't be read:");
      await expectNoSidewaysScroll(page);
      // every row stays inside the window
      for (const row of await page.locator('.trip-row').all()) {
        const box = await row.boundingBox();
        if (box !== null) expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }
      const shot = await page.screenshot({ fullPage: true });
      await testInfo.attach(`rows-${width}-${scheme}.png`, { body: shot, contentType: 'image/png' });
      // why: a passing run drops its attachments; ROWS_SHOTS names a folder to keep them in for a task report
      const keep = process.env.ROWS_SHOTS;
      if (keep !== undefined) await writeFile(join(keep, `rows-${width}-${scheme}.png`), shot);
    });
