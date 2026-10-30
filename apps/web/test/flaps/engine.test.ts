import { describe, expect, it, vi } from 'vitest';
import {
  type Animate,
  CELL_STAGGER_MS,
  drumPath,
  flipCell,
  flipGroup,
  MAX_STEPS,
  padFlaps,
} from '../../src/flaps/engine.js';

// The split-flap engine: the cells show their new text at once (React sets data-ch); a flip only lays half-cells over a
// changed cell for its length, and takes them away when it ends, is replaced, or cannot run.

/** A cell as Flaps renders it. */
function cell(ch: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'f';
  el.dataset.ch = ch;
  return el;
}

/** An animation whose `finished` the test settles, so each step of a flip runs when the test says. */
function controlled() {
  const pending: Array<() => void> = [];
  const animate = vi.fn<Animate>(() => {
    return { finished: new Promise<void>((resolve) => pending.push(resolve)) };
  });
  const step = async () => {
    const next = pending.shift();
    next?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { animate, step, pending };
}

describe('padFlaps and drumPath', () => {
  it('pads to the cells, upper case, left or right; longer text keeps every character', () => {
    expect(padFlaps('ab', 4, 'left')).toBe('AB  ');
    expect(padFlaps('ab', 4, 'right')).toBe('  AB');
    expect(padFlaps('abcdef', 4, 'left')).toBe('ABCDEF');
  });

  it('walks the drum forward and keeps only its last steps, ending on the character', () => {
    expect(drumPath('A', 'D', MAX_STEPS)).toEqual(['B', 'C', 'D']);
    expect(drumPath('A', 'Z', 2)).toEqual(['Y', 'Z']);
    expect(drumPath('Z', 'A', 3).at(-1)).toBe('A');
    // a character off the drum (an arrow, a bracket) lands in one step
    expect(drumPath('A', '(', 3)).toEqual(['(']);
    expect(drumPath('B', 'B', 3)).toEqual(['B']);
  });
});

describe('flipCell', () => {
  it('lays four half-cells over the cell, runs fall then land per step, and takes them away at the end', async () => {
    const c = cell('C');
    const { animate, step } = controlled();
    const done = flipCell(c, 'A', 'C', 30, animate);
    expect(c.querySelectorAll('.fl')).toHaveLength(4);
    // the first fall waits its turn in the cascade
    expect(animate.mock.calls[0]?.[2].delay).toBe(30);
    // two steps (B, then C), each a fall and a landing
    for (let i = 0; i < 4; i += 1) await step();
    await done;
    expect(animate).toHaveBeenCalledTimes(4);
    expect(animate.mock.calls[1]?.[2].delay).toBeUndefined();
    expect(c.querySelectorAll('.fl')).toHaveLength(0);
  });

  it('without the Web Animations API the cell simply shows its new character', async () => {
    const c = cell('B');
    await flipCell(c, 'A', 'B', 0, () => undefined);
    expect(c.querySelectorAll('.fl')).toHaveLength(0);
    expect(c.dataset.ch).toBe('B');
  });

  it('a new flip on the same cell replaces the running one, never stacking half-cells', async () => {
    const c = cell('C');
    const first = controlled();
    void flipCell(c, 'A', 'B', 0, first.animate);
    const second = controlled();
    const done = flipCell(c, 'B', 'C', 0, second.animate);
    expect(c.querySelectorAll('.fl')).toHaveLength(4);
    // the replaced flip's step ends: it must not take the new flip's half-cells away
    await first.step();
    expect(c.querySelectorAll('.fl')).toHaveLength(4);
    await second.step();
    await second.step();
    await done;
    expect(c.querySelectorAll('.fl')).toHaveLength(0);
  });

  it('a rejected animation (cancelled by the browser) still takes the half-cells away', async () => {
    const c = cell('B');
    const animate = vi.fn<Animate>(() => ({ finished: Promise.reject(new Error('cancelled')) }));
    await flipCell(c, 'A', 'B', 0, animate);
    expect(c.querySelectorAll('.fl')).toHaveLength(0);
  });

  it('draws the arrow’s stand-in, the en dash, in a half-cell', () => {
    const c = cell('→');
    const { animate } = controlled();
    void flipCell(c, 'A', '→', 0, animate);
    expect([...c.querySelectorAll<HTMLElement>('.fl')].map((l) => l.dataset.ch)).toContain('–');
  });
});

describe('flipGroup', () => {
  it('flips only the cells that changed, cascading left to right from its delay', () => {
    const g = document.createElement('span');
    g.dataset.flaps = 'ABZ';
    for (const ch of 'ABZ') g.append(cell(ch));
    const animate = vi.fn<Animate>(() => undefined);
    expect(flipGroup(g, 'ABC', 100, animate)).toBe(1);
    expect(animate.mock.calls[0]?.[2].delay).toBe(100 + 2 * CELL_STAGGER_MS);
  });

  it('pads the old text by the group’s own alignment', () => {
    const g = document.createElement('span');
    g.dataset.flaps = ' 12';
    g.dataset.align = 'right';
    for (const ch of ' 12') g.append(cell(ch));
    const animate = vi.fn<Animate>(() => undefined);
    // " 9" → " 12": the right-aligned old text lines up under the new one
    expect(flipGroup(g, '9', 0, animate)).toBe(2);
  });
});
