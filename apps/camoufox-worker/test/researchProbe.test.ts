// The recorder's probe of the outbound's link before its click (WP21 Task 21.0, after recording 1): how many links
// match, the box's size, whether Playwright sees it visible and enabled, and what the page's hit test finds at its
// centre (a tag, a role token and the relation to the target; never text).
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
          hit: { tag: 'div', role: null, relation: 'other', inViewport: false },
        }),
      ]),
    ).toEqual({
      matches: 1,
      box: { width: 640, height: 0 },
      visible: false,
      enabled: false,
      hit: { tag: 'div', role: null, relation: 'other', inViewport: false },
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
          hit: { tag: 'DIV class', role: 'link button!', relation: 'self', inViewport: true },
        }),
      ]),
    ).toMatchObject({ hit: { tag: 'other', role: 'other', relation: 'self' } });
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
  const el = (o: { tag?: string; role?: string | null; kids?: HitElement[] } = {}): HitElement => {
    const self: HitElement = {
      tagName: o.tag ?? 'DIV',
      getAttribute: (a) => (a === 'role' ? (o.role ?? null) : null),
      contains: (x) => x === self || (o.kids ?? []).includes(x),
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 40 }),
    };
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
    Reflect.set(globalThis, 'innerWidth', 1280);
    Reflect.set(globalThis, 'innerHeight', 800);
  });
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'innerWidth');
    Reflect.deleteProperty(globalThis, 'innerHeight');
  });
  it('asks at the centre and names the relation: self, descendant, ancestor, other, none', () => {
    const child = el({ tag: 'SPAN' });
    const target = el({ tag: 'A', role: 'link', kids: [child] });
    at = target;
    expect(hitTestOf(target)).toEqual({ tag: 'a', role: 'link', relation: 'self', inViewport: true });
    expect(asked).toEqual([[60, 40]]);
    at = child;
    expect(hitTestOf(target).relation).toBe('descendant');
    const parent = el({ tag: 'LI', role: 'listitem', kids: [target] });
    at = parent;
    expect(hitTestOf(target)).toMatchObject({ tag: 'li', relation: 'ancestor' });
    at = el({ tag: 'DIV', role: 'dialog' });
    expect(hitTestOf(target)).toMatchObject({ role: 'dialog', relation: 'other' });
    at = null;
    expect(hitTestOf(target)).toEqual({ tag: null, role: null, relation: 'none', inViewport: true });
  });
  it('a centre outside the window is not in the viewport', () => {
    Reflect.set(globalThis, 'innerHeight', 30);
    at = null;
    expect(hitTestOf(el()).inViewport).toBe(false);
  });
});
