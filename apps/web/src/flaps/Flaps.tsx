import { useLayoutEffect, useRef } from 'react';
import { afterPaint, browserAnimate, flipGroup, motionReduced, padFlaps } from './engine.js';

export interface FlapsProps {
  /** What the cells show; upper-cased. The words a reader hears are always beside the cells, never in them. */
  text: string;
  /** The fixed number of cells; text longer than this gets as many cells as it needs. */
  cells?: number;
  align?: 'left' | 'right';
  /**
   * The board's slot name for this group (BoardTable): the board flips its rows by slot, so a group with a slot never
   * flips itself. Without one, the group flips its own changed cells whenever its text changes.
   */
  slot?: string | undefined;
  className?: string;
}

/** The arrow cell's glyph, drawn: the font's own arrow reads thin at flap size (Ian, 2026-10-27). */
function Arrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="13 6 19 12 13 18" />
    </svg>
  );
}

/**
 * A group of split-flap cells (the departure board's own type). Decorative: hidden from assistive technology, and its
 * cells hold no text nodes (each glyph is drawn from `data-ch`), so the text beside it stays the one source of words
 * for readers, tests and find-in-page alike.
 */
export function Flaps({ text, cells = 0, align = 'left', slot, className }: FlapsProps) {
  const shown = padFlaps(text, cells, align);
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(shown);
  useLayoutEffect(() => {
    const from = last.current;
    last.current = shown;
    const el = ref.current;
    if (slot !== undefined || from === shown || el === null || motionReduced()) return;
    afterPaint(() => flipGroup(el, from, 0, browserAnimate));
  }, [shown, slot]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={className === undefined ? 'flaps' : `flaps ${className}`}
      data-flaps={shown}
      data-align={align}
      data-slot={slot}
    >
      {[...shown].map((ch, i) => (
        // why: a cell is its position: the same element shows each character that position takes, so it can flip
        <span key={i} className="f" data-ch={ch}>
          {ch === '→' ? <Arrow /> : null}
        </span>
      ))}
    </span>
  );
}
