/**
 * The recorder's research reads (WP21 Task 21.0; moved out of the served driver after the task's review): every link
 * name in `main`, every button name and every tab name on the page, each with its `https://…` runs replaced by `<url>`
 * (no page URL is ever stored), at most NAMES_MAX of each. Only the select-outbound recorder reads them
 * (rules.test.ts pins that), so the page session's driver carries none. A leaf: it imports types only.
 */
import type { LocatorLike, PageLike } from './driver.js';
import type { Deadline } from './timers.js';

/** The most names each read returns. */
export const NAMES_MAX = 200;

/** A name as the research reads it: every `https://…` run replaced by `<url>`. */
function urlStripped(name: string): string {
  return name.replace(/https?:\/\/\S+/g, '<url>');
}

/**
 * Up to NAMES_MAX accessible names of the locator's matches, each under `d`: `aria-label`, else the text (the driver's
 * own reading, repeated here so this module stays a leaf); an unreadable name is empty.
 */
async function namesOf(l: LocatorLike, d: Deadline): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0, n = Math.min(NAMES_MAX, await d.race(l.count())); i < n; i++) {
    const one = l.nth(i);
    const timeout = { timeout: Math.max(1, d.remaining()) };
    const label = await d.race(one.getAttribute('aria-label', timeout));
    const name = label ?? (await d.race(one.textContent(timeout)));
    out.push(urlStripped(name ?? ''));
  }
  return out;
}

/** Every link name in `main`. */
export const linkNames = (page: PageLike, d: Deadline): Promise<string[]> =>
  namesOf(page.getByRole('main').getByRole('link'), d);
/** Every button name on the page. */
export const buttonNames = (page: PageLike, d: Deadline): Promise<string[]> =>
  namesOf(page.getByRole('button'), d);
/** Every tab name on the page. */
export const tabNames = (page: PageLike, d: Deadline): Promise<string[]> => namesOf(page.getByRole('tab'), d);
