/**
 * The recorder's research reads (WP21 Task 21.0; moved out of the served driver after the task's review): every link
 * name in `main`, every button name and every tab name on the page (and every button name in `main`, on a booking view), each with its `https://…` runs replaced by `<url>`
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
/**
 * WP21 Task 21.3 (review M9): every button name in `main`, the scope the driver's `bookingFacts` reads the offers and
 * controls in, so a recorded booking view replays exactly as the driver reads it.
 */
export const mainButtonNames = (page: PageLike, d: Deadline): Promise<string[]> =>
  namesOf(page.getByRole('main').getByRole('button'), d);
/** Every tab name on the page. */
export const tabNames = (page: PageLike, d: Deadline): Promise<string[]> => namesOf(page.getByRole('tab'), d);

/** The roles the booking research counts inside `main` (Ian's ruling of 2026-11-01: the booking view's structure). */
const BOOKING_ROLES = [
  'link',
  'button',
  'listitem',
  'list',
  'row',
  'gridcell',
  'heading',
  'dialog',
  'alertdialog',
  'region',
] as const;

/** How many headings the page has at each level, 1 to 6 (index 0 is level 1). */
export async function headingLevels(page: PageLike, d: Deadline): Promise<number[]> {
  const out: number[] = [];
  for (let level = 1; level <= 6; level++)
    out.push(await d.race(page.getByRole('heading', { level }).count()));
  return out;
}

/** How many elements of each booking role `main` holds (counts only). */
export async function roleCounts(
  page: PageLike,
  d: Deadline,
): Promise<Record<(typeof BOOKING_ROLES)[number], number>> {
  const main = page.getByRole('main');
  const out: Record<string, number> = {};
  for (const role of BOOKING_ROLES) out[role] = await d.race(main.getByRole(role).count());
  return {
    link: out.link ?? 0,
    button: out.button ?? 0,
    listitem: out.listitem ?? 0,
    list: out.list ?? 0,
    row: out.row ?? 0,
    gridcell: out.gridcell ?? 0,
    heading: out.heading ?? 0,
    dialog: out.dialog ?? 0,
    alertdialog: out.alertdialog ?? 0,
    region: out.region ?? 0,
  };
}
