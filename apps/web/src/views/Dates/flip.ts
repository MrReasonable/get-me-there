import { type RefObject, useLayoutEffect, useRef } from 'react';

// Spec §11 Run landing: when a read changes the order, rows move to their new places in one transition of at most
// 200 ms, and with none under `prefers-reduced-motion: reduce`. FLIP: on the commit that applies a new read, each
// row's top is read before and after, and a row whose top moved is animated from its old place to its new one. The Web
// Animations call is injected so jsdom tests (no layout, no `animate`) can spy on it (WP19 §6).

/** The one transition's length (spec §11: at most 200 ms; a starting default the build may tune). */
export const TRANSITION_MS = 200;

export type Animate = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;

/** The browser's own Web Animations API; a browser without it simply moves the rows. */
export const browserAnimate: Animate = (el, keyframes, options) => {
  if (typeof el.animate === 'function') el.animate(keyframes, options);
};

/** Each row's top under `root`, keyed by its date pair. */
function topsOf(root: HTMLElement): Map<string, number> {
  const tops = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-pair]'))
    tops.set(el.dataset.pair ?? '', el.getBoundingClientRect().top);
  return tops;
}

/**
 * When `token` changes (a new read is applied), animates each row (`[data-pair]` under `container`) whose top moved,
 * from its old place to its new one, unless motion is reduced. Rows are keyed by their date pair, so a row that moves
 * is the same element before and after. why: WP19 Task 19.9: reading a place forces the browser to lay out the whole
 * page, the overview's thousands of cells included, so the rows are measured only for a new read: the old places in
 * the render that applies it (the DOM still shows the previous read, as `getSnapshotBeforeUpdate` would read it), the
 * new ones in the layout effect after its commit. A hover, a stay filter change or "Show 10 more" measures nothing.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  token: number,
  animate: Animate,
  reduced: boolean,
): void {
  const lastToken = useRef(token);
  const before = useRef<{ token: number; tops: Map<string, number> } | null>(null);
  const root = container.current;
  if (token !== lastToken.current && !reduced && root !== null && before.current?.token !== token)
    before.current = { token, tops: topsOf(root) };
  useLayoutEffect(() => {
    if (token === lastToken.current) return;
    lastToken.current = token;
    const first = before.current;
    before.current = null;
    const el = container.current;
    if (first === null || first.token !== token || reduced || el === null) return;
    const next = topsOf(el);
    for (const row of el.querySelectorAll<HTMLElement>('[data-pair]')) {
      const key = row.dataset.pair ?? '';
      const from = first.tops.get(key);
      const to = next.get(key);
      if (from === undefined || to === undefined || from === to) continue;
      animate(row, [{ transform: `translateY(${from - to}px)` }, { transform: 'none' }], {
        duration: TRANSITION_MS,
        easing: 'ease-out',
      });
    }
  });
}
