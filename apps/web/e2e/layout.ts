import { expect, type Page } from '@playwright/test';

/**
 * The shared layout check of every UI task (Trips and Search plan, Layout checks): the page never scrolls sideways, so
 * `document.documentElement.scrollWidth` is at most the window's `innerWidth`. Call it on each page a task changes at
 * 375 px and 1280 px, in light and dark, after the page's own content is on screen (never on a loading state).
 */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `the page is ${scrollWidth}px wide in a ${innerWidth}px window`).toBeLessThanOrEqual(
    innerWidth,
  );
}
