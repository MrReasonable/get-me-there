import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Animate, useFlip } from '../../../src/views/Dates/flip.js';

// WP19 Task 19.9 (the performance test): measuring a row's place forces the browser to lay out the whole page, the
// overview's thousands of cells included, so the board measures its rows only on the commit that applies a new read
// (the one a transition can follow), never on a hover, a stay filter change or a "Show 10 more".

/** jsdom has no layout: a row's top is its place among its siblings, 40 px apart, read from the DOM as it stands. */
const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
afterEach(() => rect.mockClear());
rect.mockImplementation(function (this: HTMLElement) {
  const top = [...(this.parentElement?.children ?? [])].indexOf(this) * 40;
  return {
    top,
    bottom: top + 40,
    left: 0,
    right: 100,
    width: 100,
    height: 40,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
});

function Rows({ pairs, token, animate }: { pairs: string[]; token: number; animate: Animate }) {
  const root = useRef<HTMLDivElement>(null);
  useFlip(root, token, animate, false);
  return (
    <div ref={root}>
      {pairs.map((p) => (
        <div key={p} data-pair={p} />
      ))}
    </div>
  );
}

describe('useFlip measures only for a new read (WP19 Task 19.9)', () => {
  it('a commit with the same token measures nothing; a new token animates each row that moved, once', () => {
    const animate = vi.fn<Animate>();
    const r = render(<Rows pairs={['1', '2', '3']} token={0} animate={animate} />);
    // a commit that is not a new read: a hover, a stay filter change, "Show 10 more"
    r.rerender(<Rows pairs={['1', '2', '3', '4']} token={0} animate={animate} />);
    expect(rect).not.toHaveBeenCalled();
    // a new read swaps the first two rows
    r.rerender(<Rows pairs={['2', '1', '3', '4']} token={1} animate={animate} />);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls.map(([el]) => (el instanceof HTMLElement ? el.dataset.pair : null))).toEqual([
      '2',
      '1',
    ]);
    expect(animate.mock.calls.map(([, frames]) => frames[0]?.transform)).toEqual([
      'translateY(40px)',
      'translateY(-40px)',
    ]);
    // the next commit without a new read measures nothing again
    rect.mockClear();
    r.rerender(<Rows pairs={['2', '1', '3', '4']} token={1} animate={animate} />);
    expect(rect).not.toHaveBeenCalled();
  });
});
