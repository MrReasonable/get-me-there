/**
 * The recorder's probe of the outbound's link before its click (WP21 Task 21.0, after the first live select-outbound
 * recording, whose click timed out): how many links in `main` carry the exact name, the first one's box size, whether
 * Playwright sees it visible and enabled, and what the page's own hit test finds at the box's centre (an element's tag,
 * its role attribute and its relation to the target). Tokens, numbers and booleans only, never text; each token that is
 * not a plain one is reported as `other`. Every read is under the probe's own bound, so a probe that overruns is
 * recorded as such and never costs the step its deadline. Only recordSelect.ts imports this module (rules.test.ts pins
 * that). A leaf: it imports the driver's types and the timers' error only.
 */
import type { PageLike } from './driver.js';
import { DeadlineExceeded, type Timers } from './timers.js';

/** The page's element as the hit test reads it (a structural subset of the DOM's Element). */
export interface HitElement {
  tagName: string;
  getAttribute(name: string): string | null;
  contains(other: HitElement): boolean;
  /** The nearest ancestor (or itself) matching a selector: the probe asks for the row. */
  closest(selector: string): HitElement | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
}
interface HitDocument {
  elementFromPoint(x: number, y: number): HitElement | null;
}
type ComputedStyleOf = (el: HitElement) => { pointerEvents: string; position: string };

/** What is at the target's centre: the target itself, inside it, around it, something else, or nothing. */
export interface HitTest {
  tag: string | null;
  role: string | null;
  relation: 'self' | 'descendant' | 'ancestor' | 'other' | 'none';
  inViewport: boolean;
  /**
   * After recording 2 (the controller's ruling): whether the element at the centre sits in the target's own row (its
   * nearest list item or row; null when the target is in none), whether its box covers the target's within
   * COVER_SLACK_PX, and its computed `pointer-events` and `position` (CSS keywords).
   */
  sameRow: boolean | null;
  coversTarget: boolean | null;
  pointerEvents: string | null;
  position: string | null;
}

/**
 * The page function: `document.elementFromPoint` at the element's centre, and that element's relation to it. It runs in
 * the page (serialised by Playwright), so it reads the page's globals through `globalThis` and closes over nothing.
 */
export function hitTestOf(el: HitElement): HitTest {
  // why: written out here, not shared: the function is serialised into the page and closes over nothing
  const slack = 4;
  const rowOf = (e: HitElement): HitElement | null => e.closest('li, [role="listitem"], [role="row"]');
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const doc: HitDocument = Reflect.get(globalThis, 'document');
  const styleOf: ComputedStyleOf = Reflect.get(globalThis, 'getComputedStyle');
  const width: number = Reflect.get(globalThis, 'innerWidth');
  const height: number = Reflect.get(globalThis, 'innerHeight');
  const inViewport = x >= 0 && y >= 0 && x < width && y < height;
  const at = doc.elementFromPoint(x, y);
  if (at === null)
    return {
      tag: null,
      role: null,
      relation: 'none',
      inViewport,
      sameRow: null,
      coversTarget: null,
      pointerEvents: null,
      position: null,
    };
  const relation =
    at === el ? 'self' : el.contains(at) ? 'descendant' : at.contains(el) ? 'ancestor' : 'other';
  const row = rowOf(el);
  const a = at.getBoundingClientRect();
  const covers =
    a.left <= r.left + slack &&
    a.top <= r.top + slack &&
    a.left + a.width >= r.left + r.width - slack &&
    a.top + a.height >= r.top + r.height - slack;
  const style = styleOf(at);
  return {
    tag: at.tagName.toLowerCase(),
    role: at.getAttribute('role'),
    relation,
    inViewport,
    sameRow: row === null ? null : rowOf(at) === row,
    coversTarget: covers,
    pointerEvents: style.pointerEvents,
    position: style.position,
  };
}

/** The probe as the recording stores it; null where a read was not made or did not answer. */
export interface TargetProbe {
  matches: number | null;
  box: { width: number; height: number } | null;
  visible: boolean | null;
  enabled: boolean | null;
  hit: HitTest | null;
  /** A read did not answer within PROBE_MS. */
  probeOverran: boolean;
  /** A read failed otherwise (the page closed, say): the class of its error, as a word. */
  probeFailed?: string;
}

/** The probe's own bound, inside the step (each read is short; the whole stays well inside a page timeout). */
export const PROBE_MS = 5000;

/** A tag or role as a plain token, else `other` (never anything that could be page text). */
function token(s: string | null, re: RegExp): string | null {
  return s === null ? null : re.test(s) ? s : 'other';
}

/** Probes the first link in `main` named exactly `name`, under its own bound of PROBE_MS. */
export async function probeTarget(page: PageLike, name: string, timers: Timers): Promise<TargetProbe> {
  const out: TargetProbe = {
    matches: null,
    box: null,
    visible: null,
    enabled: null,
    hit: null,
    probeOverran: false,
  };
  const links = page.getByRole('main').getByRole('link', { name, exact: true });
  const h = timers.deadline(PROBE_MS);
  const timeout = (): { timeout: number } => ({ timeout: Math.max(1, h.remaining()) });
  try {
    out.matches = await h.race(links.count());
    if (out.matches === 0) return out;
    const first = links.nth(0);
    const box = await h.race(first.boundingBox(timeout()));
    out.box = box === null ? null : { width: box.width, height: box.height };
    out.visible = await h.race(first.isVisible());
    out.enabled = await h.race(first.isEnabled(timeout()));
    const hit = await h.race(first.evaluate(hitTestOf, undefined, timeout()));
    out.hit = {
      tag: token(hit.tag, /^[a-z][a-z0-9-]{0,31}$/),
      role: token(hit.role, /^[a-z]{1,32}$/),
      relation: hit.relation,
      inViewport: hit.inViewport,
      sameRow: hit.sameRow,
      coversTarget: hit.coversTarget,
      pointerEvents: token(hit.pointerEvents, /^[a-z-]{1,24}$/),
      position: token(hit.position, /^[a-z-]{1,24}$/),
    };
  } catch (e) {
    // why: a probe is diagnostics only: what it could not read stays null and is marked, never the step's failure;
    // a failure other than the bound keeps only its error class (a word), never its message
    if (e instanceof DeadlineExceeded) out.probeOverran = true;
    else out.probeFailed = e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';
  } finally {
    h.clear();
  }
  return out;
}
