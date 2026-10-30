import { type RefObject, useLayoutEffect, useRef } from 'react';
import { afterPaint, flipGroup, ROW_STAGGER_MS } from '../../flaps/engine.js';

// Spec §11 Run landing, as the departure board (Ian, 2026-10-26/27): when a read is applied, the board's rows flip in
// place. Each row position is a slot; every flap group in it (`[data-slot]` under a `[data-pair]` row) turns from what
// that position showed before the read to what it shows now, cascading down the board, row by row. The words beside
// the cells change in the same commit, so readers and focus never wait for the motion; under
// `prefers-reduced-motion: reduce` the board changes in one update, with no cascade.

export { type Animate, browserAnimate } from '../../flaps/engine.js';

import type { Animate } from '../../flaps/engine.js';

/** What each row position showed: its slot groups' text, by slot name, in board order. */
function slotsOf(root: HTMLElement): Array<Map<string, string>> {
  return [...root.querySelectorAll<HTMLElement>('[data-pair]')].map((row) => {
    const m = new Map<string, string>();
    for (const g of row.querySelectorAll<HTMLElement>('[data-slot]'))
      m.set(g.dataset.slot ?? '', g.dataset.flaps ?? '');
    return m;
  });
}

/**
 * When `token` changes (a new read is applied), flips each row position's changed cells from the text that position
 * showed to its new text. why: WP19 Task 19.9: only text is read (no layout), and only for a new read: the old slots
 * in the render that applies it (the DOM still shows the previous read), the new ones after its commit. A hover, a stay
 * filter change or "Show 10 more" reads and flips nothing. The cascade starts after the next frame, so it never
 * lengthens the commit the performance test measures.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  token: number,
  animate: Animate,
  reduced: boolean,
): void {
  const lastToken = useRef(token);
  const before = useRef<{ token: number; slots: Array<Map<string, string>> } | null>(null);
  const root = container.current;
  if (token !== lastToken.current && !reduced && root !== null && before.current?.token !== token)
    before.current = { token, slots: slotsOf(root) };
  useLayoutEffect(() => {
    if (token === lastToken.current) return;
    lastToken.current = token;
    const first = before.current;
    before.current = null;
    const el = container.current;
    if (first === null || first.token !== token || reduced || el === null) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-pair]')];
    afterPaint(() =>
      rows.forEach((row, i) => {
        const was = first.slots[i] ?? new Map<string, string>();
        for (const g of row.querySelectorAll<HTMLElement>('[data-slot]')) {
          const from = was.get(g.dataset.slot ?? '') ?? '';
          if (from !== g.dataset.flaps) flipGroup(g, from, i * ROW_STAGGER_MS, animate);
        }
      }),
    );
  });
}
