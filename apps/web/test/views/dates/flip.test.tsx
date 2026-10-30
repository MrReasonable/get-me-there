import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { STEP_MS } from '../../../src/flaps/engine.js';
import { Flaps } from '../../../src/flaps/Flaps.js';
import { type Animate, useFlip } from '../../../src/views/Dates/flip.js';

// The departure board (Ian, 2026-10-26/27): a new read flips the board's rows in place. Each row position is a slot;
// its flap groups turn from what that position showed to what it shows now. WP19 Task 19.9: only a new read is looked
// at (a hover, a stay filter change or "Show 10 more" flips nothing), and only text is read, never layout.

function Rows({
  pairs,
  token,
  animate,
  reduced = false,
}: {
  pairs: string[];
  token: number;
  animate: Animate;
  reduced?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  useFlip(root, token, animate, reduced);
  return (
    <div ref={root}>
      {pairs.map((p) => (
        <div key={p} data-pair={p}>
          <Flaps text={p} slot="dep" />
        </div>
      ))}
    </div>
  );
}

/** A spy that notes the row each half-cell sits in when it is animated (a half-cell goes when its flip ends). */
function spy() {
  const rows: Array<string | null> = [];
  const animate = vi.fn<Animate>((el) => {
    rows.push(el.closest('[data-pair]')?.getAttribute('data-pair') ?? null);
    return undefined;
  });
  return { animate, rows };
}

describe('useFlip flips a new read in place', () => {
  it('a commit with the same token flips nothing; a new token flips each changed cell of each position, once', async () => {
    const { animate, rows } = spy();
    const r = render(<Rows pairs={['AB', 'CD', 'EF']} token={0} animate={animate} />);
    // a commit that is not a new read: a hover, a stay filter change, "Show 10 more"
    r.rerender(<Rows pairs={['AB', 'CD', 'EF', 'GH']} token={0} animate={animate} />);
    // why: nothing is even scheduled for a commit without a new read, so there is nothing to wait for
    expect(animate).not.toHaveBeenCalled();
    // a new read swaps the first two rows: positions 0 and 1 change, each in both of its cells
    r.rerender(<Rows pairs={['CD', 'AB', 'EF', 'GH']} token={1} animate={animate} />);
    // the words are current at once: each group already holds its new text before any motion
    const groups = [...r.container.querySelectorAll<HTMLElement>('[data-slot]')].map((g) => g.dataset.flaps);
    expect(groups).toEqual(['CD', 'AB', 'EF', 'GH']);
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(4));
    expect(new Set(rows)).toEqual(new Set(['CD', 'AB']));
    for (const [, frames, options] of animate.mock.calls) {
      expect(frames).toHaveLength(2);
      expect(Number(options.duration)).toBeLessThanOrEqual(STEP_MS);
    }
  });

  it('flips nothing under prefers-reduced-motion: one update, no cascade', () => {
    const { animate } = spy();
    const r = render(<Rows pairs={['AB', 'CD']} token={0} animate={animate} reduced />);
    r.rerender(<Rows pairs={['CD', 'AB']} token={1} animate={animate} reduced />);
    // why: under reduced motion the hook schedules no cascade at all, so nothing can start later
    expect(animate).not.toHaveBeenCalled();
    expect([...r.container.querySelectorAll<HTMLElement>('[data-slot]')].map((g) => g.dataset.flaps)).toEqual(
      ['CD', 'AB'],
    );
  });
});
