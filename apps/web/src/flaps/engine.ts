// The split-flap engine (the departure board, approved 2026-10-26/27). A flap group is a row of fixed character cells
// (components/Flaps.tsx); a cell draws its glyph from `data-ch`, which React sets to the new text at once, so the page
// and its accessible text are current before any motion. A flip only lays three half-cells over a changed cell for its
// length: the old top falls, the old bottom waits, the new bottom lands, then the half-cells go. Under
// `prefers-reduced-motion: reduce` nothing is laid over: the text changes in one update, with no cascade.

/** The Web Animations call, injected so jsdom tests (no `animate`) can spy on it (WP19 §6). */
export type Animate = (
  el: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
) => Animation | undefined;

/** The browser's own Web Animations API; a browser without it simply shows the new text. */
export const browserAnimate: Animate = (el, keyframes, options) =>
  typeof el.animate === 'function' ? el.animate(keyframes, options) : undefined;

/** The drum a flap passes through on its way to its character: a flip shows the last few before it. */
// why: the pound sign by its code point, so this file holds no money literal (the money guard, test/copy/sourceGuard)
const DRUM = ` ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789${String.fromCharCode(0xa3)}.,:-–/·`;

/** One flap's fall and landing, in ms (a step); a flip takes at most `MAX_STEPS` of them. */
export const STEP_MS = 84;
export const MAX_STEPS = 3;
/** The cascade: each cell starts this much after the one to its left, each row after the row above. */
export const CELL_STAGGER_MS = 6;
export const ROW_STAGGER_MS = 34;

const PERSPECTIVE = 'perspective(160px)';

/** A flap group's text, padded to its cells: upper case, aligned left or right. */
export function padFlaps(text: string, cells: number, align: 'left' | 'right'): string {
  const t = text.toUpperCase();
  const n = Math.max(cells, [...t].length);
  return align === 'right' ? t.padStart(n) : t.padEnd(n);
}

/** The characters a flap shows from `a` to `b`: forward through the drum, the last `max` only (always ending on b). */
export function drumPath(a: string, b: string, max: number): string[] {
  const j = DRUM.indexOf(b);
  if (j < 0 || a === b) return [b];
  const i = Math.max(0, DRUM.indexOf(a));
  const out: string[] = [];
  for (let k = i; k !== j; ) {
    k = (k + 1) % DRUM.length;
    out.push(DRUM.charAt(k));
  }
  return out.slice(-max);
}

/** The arrow is drawn, not typed; in a half-cell its stand-in is the en dash (Ian, 2026-10-27). */
const shown = (ch: string) => (ch === '→' ? '–' : ch);

/** The flip running on a cell, so a new one replaces it instead of racing it. */
const running = new WeakMap<Element, { cancelled: boolean; layers: HTMLElement[] }>();

function layer(cell: Element, cls: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `fl ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  cell.append(el);
  return el;
}

function clear(cell: Element): void {
  const r = running.get(cell);
  if (r === undefined) return;
  r.cancelled = true;
  for (const l of r.layers) l.remove();
  running.delete(cell);
}

/**
 * Flips one cell from the character it showed to the one it shows now, after `delay` ms. The cell keeps showing the
 * old character (the half-cells cover it) until its turn in the cascade.
 */
export async function flipCell(
  cell: HTMLElement,
  from: string,
  to: string,
  delay: number,
  animate: Animate,
): Promise<void> {
  clear(cell);
  const steps = drumPath(from, to, MAX_STEPS);
  const under = layer(cell, 'fl-top fl-under');
  const old = layer(cell, 'fl-old');
  const land = layer(cell, 'fl-land');
  const fall = layer(cell, 'fl-top');
  const state = { cancelled: false, layers: [under, old, land, fall] };
  running.set(cell, state);
  try {
    let current = from;
    for (const [i, next] of steps.entries()) {
      under.dataset.ch = shown(next);
      fall.dataset.ch = shown(current);
      old.dataset.ch = shown(current);
      land.dataset.ch = shown(next);
      const dropping = animate(
        fall,
        [{ transform: `${PERSPECTIVE} rotateX(0deg)` }, { transform: `${PERSPECTIVE} rotateX(-90deg)` }],
        {
          duration: STEP_MS / 2,
          delay: i === 0 ? delay : 0,
          easing: 'cubic-bezier(.55,0,1,.45)',
          fill: 'forwards',
        },
      );
      if (dropping === undefined) return;
      await dropping.finished;
      if (state.cancelled) return;
      const landing = animate(
        land,
        [{ transform: `${PERSPECTIVE} rotateX(90deg)` }, { transform: `${PERSPECTIVE} rotateX(0deg)` }],
        { duration: STEP_MS / 2, easing: 'cubic-bezier(.2,.9,.3,1.1)', fill: 'forwards' },
      );
      if (landing === undefined) return;
      await landing.finished;
      if (state.cancelled) return;
      current = next;
    }
  } catch {
    // why: a cancelled animation rejects its `finished`; the cell already shows its new character underneath
  } finally {
    if (!state.cancelled) clear(cell);
  }
}

/**
 * Flips every cell of a flap group whose character differs between `from` (the text the group showed) and its text
 * now, cascading left to right from `delay`. Returns the number of cells flipped.
 */
export function flipGroup(group: HTMLElement, from: string, delay: number, animate: Animate): number {
  const to = group.dataset.flaps ?? '';
  const cells = [...group.querySelectorAll<HTMLElement>(':scope > .f')];
  const before = padFlaps(from, cells.length, group.dataset.align === 'right' ? 'right' : 'left');
  let n = 0;
  cells.forEach((cell, i) => {
    const a = before.charAt(i) || ' ';
    const b = to.charAt(i) || ' ';
    if (a === b) return;
    void flipCell(cell, a, b, delay + i * CELL_STAGGER_MS, animate);
    n += 1;
  });
  return n;
}

/** Runs `fn` after the browser's next frame, so starting a cascade never lengthens the commit that drew the text. */
export function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  else setTimeout(fn, 0);
}

/** Whether motion is reduced right now (read at the moment of a flip, so a change of the setting applies at once). */
export function motionReduced(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
