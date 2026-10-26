import { type RefObject, useLayoutEffect, useRef } from 'react';

// Spec §11 Run landing: when a read changes the order, rows move to their new places in one transition of at most
// 200 ms, and with none under `prefers-reduced-motion: reduce`. FLIP: each row's top is measured after every commit;
// on the commit that applies a new read, a row whose top moved is animated from its old place to its new one. The Web
// Animations call is injected so jsdom tests (no layout, no `animate`) can spy on it (WP19 §6).

/** The one transition's length (spec §11: at most 200 ms; a starting default the build may tune). */
export const TRANSITION_MS = 200;

export type Animate = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => void;

/** The browser's own Web Animations API; a browser without it simply moves the rows. */
export const browserAnimate: Animate = (el, keyframes, options) => {
  if (typeof el.animate === 'function') el.animate(keyframes, options);
};

/**
 * Measures the rows (`[data-pair]` under `container`) after every commit, and when `token` changes since the last
 * commit, animates each row whose top moved by the difference, unless motion is reduced. Rows are keyed by their date
 * pair, so a row that moves is the same element before and after.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  token: number,
  animate: Animate,
  reduced: boolean,
): void {
  const tops = useRef(new Map<string, number>());
  const lastToken = useRef(token);
  useLayoutEffect(() => {
    const root = container.current;
    if (root === null) return;
    const next = new Map<string, number>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-pair]')) {
      next.set(el.dataset.pair ?? '', el.getBoundingClientRect().top);
    }
    if (token !== lastToken.current && !reduced) {
      for (const el of root.querySelectorAll<HTMLElement>('[data-pair]')) {
        const key = el.dataset.pair ?? '';
        const before = tops.current.get(key);
        const after = next.get(key);
        if (before === undefined || after === undefined || before === after) continue;
        animate(el, [{ transform: `translateY(${before - after}px)` }, { transform: 'none' }], {
          duration: TRANSITION_MS,
          easing: 'ease-out',
        });
      }
    }
    lastToken.current = token;
    tops.current = next;
  });
}
