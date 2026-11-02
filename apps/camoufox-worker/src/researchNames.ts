/**
 * The recorder's research reads (WP21 Task 21.0; moved out of the served driver after the task's review): every link
 * name in `main`, every button name and every tab name on the page (and every button name in `main`, on a booking view), each with its `https://…` runs replaced by `<url>`
 * (no page URL is ever stored), at most NAMES_MAX of each. Only the select-outbound recorder reads them
 * (rules.test.ts pins that), so the page session's driver carries none. A leaf: it imports types only.
 */
import type { LocatorLike, NamedElement, PageLike } from './driver.js';
import type { Deadline } from './timers.js';

/** The most names each read returns. */
export const NAMES_MAX = 200;

/** A name as the research reads it: every `https://…` run replaced by `<url>`. */
function urlStripped(name: string): string {
  return name.replace(/https?:\/\/\S+/g, '<url>');
}

/** Run in the page: each element's `aria-label`, else its text, else empty (self-contained, as a page function must be). */
function namesInPage(elements: NamedElement[]): string[] {
  return elements.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? '');
}

/**
 * Up to NAMES_MAX accessible names of the locator's matches: `aria-label`, else the text (the driver's own reading,
 * repeated here so this module stays a leaf); an unreadable name is empty.
 */
// why: ruling of 2026-10-18 ("never getAttribute on a node the page may have replaced") as WP21 Task 21.3 fix round 2
// applies it: the recorder reads these right after a selection, while the view re-renders, so every name is read in
// one page call (the matches of one moment), never counted and then read one node at a time
async function namesOf(l: LocatorLike, d: Deadline): Promise<string[]> {
  return (await d.race(l.evaluateAll(namesInPage))).slice(0, NAMES_MAX).map(urlStripped);
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
