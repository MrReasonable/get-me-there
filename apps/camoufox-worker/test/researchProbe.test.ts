// The recorder's probe of the outbound's link before its click (WP21 Task 21.0, after recording 1): how many links
// match, the box's size, whether Playwright sees it visible and enabled, and what the page's hit test finds at its
// centre (a tag, a role token and the relation to the target; never text).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type HitElement, hitTestOf, probeTarget } from '../src/researchProbe.js';
import { FakePage, n, optionName, RESULTS_URL } from './support/fakePage.js';
import { fakeTimers } from './support/timers.js';

const NAME = optionName(451);
const run = (links: ReturnType<typeof n>[]) => {
  const page = new FakePage(null);
  page.setUrl(RESULTS_URL);
  page.setTrees([n('document', '', [n('main', '', links)])]);
  return probeTarget(page, NAME, fakeTimers());
};

beforeEach(() => {
  expect.hasAssertions();
});

describe('probeTarget', () => {
  it('reads the matches, the box’s size, visibility, enablement and the hit test, without text', async () => {
    expect(
      await run([
        n('link', NAME, [], {
          box: { x: 10, y: 900, width: 640, height: 0 },
          hidden: true,
          disabled: true,
          hit: {
            tag: 'div',
            role: null,
            relation: 'other',
            inViewport: false,
            sameRow: false,
            coversTarget: true,
            pointerEvents: 'auto',
            position: 'absolute',
          },
        }),
      ]),
    ).toEqual({
      matches: 1,
      box: { width: 640, height: 0 },
      visible: false,
      enabled: false,
      hit: {
        tag: 'div',
        role: null,
        relation: 'other',
        inViewport: false,
        sameRow: false,
        coversTarget: true,
        pointerEvents: 'auto',
        position: 'absolute',
      },
      probeOverran: false,
    });
  });
  it('no match is just the count; two read the first; an unrendered box is null', async () => {
    expect(await run([])).toEqual({
      matches: 0,
      box: null,
      visible: null,
      enabled: null,
      hit: null,
      probeOverran: false,
    });
    expect(await run([n('link', NAME, [], { box: null }), n('link', NAME)])).toMatchObject({
      matches: 2,
      box: null,
    });
  });
  it('a tag or role that is not a plain token is reported as other (never page text)', async () => {
    expect(
      await run([
        n('link', NAME, [], {
          hit: {
            tag: 'DIV class',
            role: 'link button!',
            relation: 'self',
            inViewport: true,
            sameRow: true,
            coversTarget: false,
            pointerEvents: 'auto none',
            position: 'Sticky',
          },
        }),
      ]),
    ).toMatchObject({
      hit: { tag: 'other', role: 'other', relation: 'self', pointerEvents: 'other', position: 'other' },
    });
  });
  it('a read that never answers is probeOverran with what was read', async () => {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    page.setTrees([n('document', '', [n('main', '', [n('link', NAME, [], { hang: true })])])]);
    const timers = fakeTimers();
    const p = probeTarget(page, NAME, timers);
    // why: the box read hangs; the probe's own bound is the earliest deadline, run out once the read is waiting
    await Promise.resolve();
    timers.runOut();
    expect(await p).toMatchObject({ matches: 1, box: null, probeOverran: true });
  });
});

describe('hitTestOf (the page script, over a synthetic document)', () => {
  interface Opts {
    tag?: string;
    role?: string | null;
    kids?: HitElement[];
    row?: HitElement | null;
    rect?: { left: number; top: number; width: number; height: number };
    style?: { pointerEvents: string; position: string };
  }
  const styles = new Map<HitElement, { pointerEvents: string; position: string }>();
  const el = (o: Opts = {}): HitElement => {
    const self: HitElement = {
      tagName: o.tag ?? 'DIV',
      getAttribute: (a) => (a === 'role' ? (o.role ?? null) : null),
      contains: (x) => x === self || (o.kids ?? []).includes(x),
      closest: () => (o.row === undefined ? null : o.row),
      getBoundingClientRect: () => o.rect ?? { left: 10, top: 20, width: 100, height: 40 },
    };
    styles.set(self, o.style ?? { pointerEvents: 'auto', position: 'static' });
    return self;
  };
  let at: HitElement | null = null;
  let asked: Array<[number, number]> = [];
  beforeEach(() => {
    asked = [];
    Reflect.set(globalThis, 'document', {
      elementFromPoint: (x: number, y: number) => {
        asked.push([x, y]);
        return at;
      },
    });
    Reflect.set(globalThis, 'getComputedStyle', (e: HitElement) => styles.get(e));
    Reflect.set(globalThis, 'innerWidth', 1280);
    Reflect.set(globalThis, 'innerHeight', 800);
  });
  afterEach(() => {
    for (const k of ['document', 'getComputedStyle', 'innerWidth', 'innerHeight'])
      Reflect.deleteProperty(globalThis, k);
  });
  it('asks at the centre and names the relation: self, descendant, ancestor, other, none', () => {
    const row = el({ tag: 'LI' });
    const child = el({ tag: 'SPAN', row });
    const target = el({ tag: 'A', role: 'link', kids: [child], row });
    at = target;
    expect(hitTestOf(target)).toEqual({
      tag: 'a',
      role: 'link',
      relation: 'self',
      inViewport: true,
      sameRow: true,
      coversTarget: true,
      pointerEvents: 'auto',
      position: 'static',
    });
    expect(asked).toEqual([[60, 40]]);
    at = child;
    expect(hitTestOf(target).relation).toBe('descendant');
    const parent = el({
      tag: 'LI',
      role: 'listitem',
      kids: [target],
      rect: { left: 0, top: 0, width: 400, height: 200 },
    });
    at = parent;
    expect(hitTestOf(target)).toMatchObject({ tag: 'li', relation: 'ancestor', coversTarget: true });
    at = el({ tag: 'DIV', role: 'dialog' });
    expect(hitTestOf(target)).toMatchObject({ role: 'dialog', relation: 'other', sameRow: false });
    at = null;
    expect(hitTestOf(target)).toEqual({
      tag: null,
      role: null,
      relation: 'none',
      inViewport: true,
      sameRow: null,
      coversTarget: null,
      pointerEvents: null,
      position: null,
    });
  });
  it('a covering sibling in the same row: sameRow, coversTarget within 4 px, its pointer-events and position', () => {
    const row = el({ tag: 'LI' });
    const target = el({ tag: 'DIV', role: 'link', row, rect: { left: 10, top: 20, width: 100, height: 40 } });
    at = el({
      tag: 'DIV',
      row,
      rect: { left: 13, top: 23, width: 94, height: 34 },
      style: { pointerEvents: 'auto', position: 'absolute' },
    });
    expect(hitTestOf(target)).toMatchObject({
      relation: 'other',
      sameRow: true,
      coversTarget: true,
      pointerEvents: 'auto',
      position: 'absolute',
    });
    // why: 5 px short on a side is not covering
    at = el({ tag: 'DIV', row, rect: { left: 15, top: 20, width: 95, height: 40 } });
    expect(hitTestOf(target).coversTarget).toBe(false);
  });
  it('a target in no row has sameRow null', () => {
    const target = el({ row: null });
    at = el({ row: el() });
    expect(hitTestOf(target).sameRow).toBeNull();
  });
  it('a centre outside the window is not in the viewport', () => {
    Reflect.set(globalThis, 'innerHeight', 30);
    at = null;
    expect(hitTestOf(el()).inViewport).toBe(false);
  });
});

// why: recordings 3 and 4 (2026-11-01) read `probeFailed: 'Error'` for every target: the page function then held an
// arrow function of its own, which the runtime's transform wraps in a helper that does not exist in the page. The
// function Playwright serialises must define no function inside it
describe('hitTestOf is self-contained', () => {
  it('its source defines no function and calls no helper of this module', () => {
    const src = readFileSync(new URL('../src/researchProbe.ts', import.meta.url), 'utf8');
    const start = src.indexOf('export function hitTestOf(');
    const body = src.slice(src.indexOf('{', start), src.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(0);
    expect(body).not.toMatch(/=>|\bfunction\b/);
    expect(body).not.toMatch(/\btoken\(|\bprobeTarget\(/);
    // why: and its runtime source holds no transform helper either
    expect(hitTestOf.toString()).not.toMatch(/__name|=>/);
  });
});
