import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RereadClock } from '../../../src/views/Dates/DatesView.js';
import { at, type DatesOptions, priced, pricedPair, runSummary } from '../../fixtures.dates.js';
import { API, execution } from '../../fixtures.js';
import { type Requests, serveDatesBy } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { settled } from '../../render.js';
import { boardRows, findBoard, renderDates } from './render.js';

// Spec §11 "Run landing and re-ranking" and revision 50 (Ian ruled): the 30 s re-read with its trailing and terminal
// reads, the one transition of at most 200 ms (none under reduced motion), focus kept, one polite announcement per
// read, and a read held while the pointer or the focus is in the board. Every clock read and timer is injected.

const S = 1_000;

/** A clock the test moves by hand, firing each timer when its time comes. */
function fakeClock() {
  let t = 0;
  let timers: Array<{ at: number; fn: () => void }> = [];
  const clock: RereadClock = {
    now: () => t,
    setTimer: (fn, ms) => {
      const entry = { at: t + ms, fn };
      timers.push(entry);
      return () => {
        timers = timers.filter((x) => x !== entry);
      };
    },
  };
  return {
    clock,
    advance(ms: number) {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      for (const x of due) x.fn();
    },
  };
}

const RUN = [runSummary({ status: 'running', finishedAt: null })];
/** Four date pairs at £300–£330; the second read reprices the first to £315, so it swaps with the second. */
const first: DatesOptions = {
  executions: RUN,
  pairs: {
    [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
    [at('2027-03-15', 10)]: pricedPair(priced(31_000)),
    [at('2027-03-16', 10)]: pricedPair(priced(32_000)),
    [at('2027-03-17', 10)]: pricedPair(priced(33_000)),
  },
};
const swapped: DatesOptions = {
  ...first,
  pairs: { ...first.pairs, [at('2027-03-14', 10)]: pricedPair(priced(31_500)) },
};
/** 16 Mar becomes its week's cheapest, so under the week switch 15 Mar leaves the board. */
const leaving: DatesOptions = {
  ...first,
  pairs: { ...first.pairs, [at('2027-03-16', 10)]: pricedPair(priced(30_500)) },
};

/** Serves `reads` in turn (the last one again after that), recording each request. */
function serveReads(...reads: DatesOptions[]) {
  const requests: Requests = [];
  server.use(serveDatesBy(() => reads[Math.min(requests.length - 1, reads.length - 1)] ?? first, requests));
  return requests;
}

const progress = (priced: number) => [
  {
    stage: 'discovery' as const,
    providerId: 'travelpayouts' as const,
    buckets: { priced, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 126 - priced, reused: 0 },
    total: 126,
  },
];

beforeEach(() => {
  server.use(
    http.get(`${API}/executions/:id`, () =>
      HttpResponse.json(execution({ status: 'running', progress: progress(1) })),
    ),
  );
  // why: jsdom has no layout; each board row's top is its place among the rows, so a moved row has a real delta (on
  // HTMLElement.prototype, where test/setup-charts.ts gives every element its box)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rows = this.parentElement === null ? [] : [...this.parentElement.children];
    const top = this.hasAttribute('data-pair') ? rows.indexOf(this) * 40 : 0;
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 0,
      width: 0,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

async function start(reads: DatesOptions[], search = '?view=dates&def=def-0001') {
  const requests = serveReads(...reads);
  const time = fakeClock();
  const rows: Array<string | null> = [];
  const animate = vi.fn((el: Element, _frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    rows.push(el.closest('[data-pair]')?.getAttribute('data-pair') ?? null);
    return undefined;
  });
  flipped.set(animate, rows);
  const r = renderDates({ props: { clock: time.clock, animate }, search });
  const table = await findBoard();
  // the status bar's execution query has answered: its first answer is the run as the read saw it
  await waitFor(() => expect(r.client.getQueryData(['execution', 'exec-0001'])).toBeDefined());
  const progressTo = (n: number, status: 'running' | 'completed' = 'running') =>
    act(async () => {
      r.client.setQueryData(['execution', 'exec-0001'], execution({ status, progress: progress(n) }));
    });
  return { ...r, requests, time, animate, table, progressTo };
}
/** The board rows the flip's half-cells were laid over, noted as each is animated (a half-cell goes when it ends). */
const flipped = new WeakMap<object, Array<string | null>>();
const flippedRows = (animate: object) => flipped.get(animate) ?? [];
const order = (table: HTMLElement) =>
  boardRows(table).map((row) => row.querySelectorAll('td')[1]?.textContent);

describe('the 30 s re-read during a run', () => {
  it('a progress change 10 s after a read is read at 30 s, once', async () => {
    const { requests, time, progressTo } = await start([first, swapped]);
    expect(requests).toHaveLength(1);
    await act(async () => time.advance(10 * S));
    await progressTo(2);
    await act(async () => time.advance(5 * S));
    await progressTo(3);
    expect(requests).toHaveLength(1);
    await act(async () => time.advance(14 * S));
    expect(requests).toHaveLength(1);
    await act(async () => time.advance(1 * S));
    await waitFor(() => expect(requests).toHaveLength(2));
    // the read lands inside the test (the second body reprices 14 Mar)
    expect(await screen.findByText('£315')).toBeInTheDocument();
  });

  it('the run leaving pending or running is read at once, even 5 s after a read', async () => {
    const { requests, time, progressTo } = await start([first, swapped]);
    await act(async () => time.advance(5 * S));
    await progressTo(1, 'completed');
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(await screen.findByText('£315')).toBeInTheDocument();
  });
});

describe('a read that changes the order, not held', () => {
  it('flips the rows in place: only the cells of the positions that changed, each flap at most 200 ms, and says "Best dates updated" once', async () => {
    const { table, time, progressTo, animate } = await start([first, swapped]);
    expect(order(table)).toEqual(['14 Mar 2027', '15 Mar 2027', '16 Mar 2027', '17 Mar 2027']);
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await waitFor(() =>
      expect(order(table)).toEqual(['15 Mar 2027', '14 Mar 2027', '16 Mar 2027', '17 Mar 2027']),
    );
    await waitFor(() => expect(animate).toHaveBeenCalled());
    for (const [, frames, options] of animate.mock.calls) {
      expect(frames).toHaveLength(2);
      expect(options.duration).toBeLessThanOrEqual(200);
    }
    // the half-cells laid over the cells of the two rows that swapped places, and no other row's
    expect(new Set(flippedRows(animate))).toEqual(new Set(['0', '3']));
    expect(screen.getAllByRole('status').filter((s) => s.textContent === 'Best dates updated')).toHaveLength(
      1,
    );
  });

  it('no transition under prefers-reduced-motion: reduce', async () => {
    const matchMedia = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => {
      const m = matchMedia(q);
      return q.includes('prefers-reduced-motion') ? { ...m, matches: true } : m;
    });
    const { table, time, progressTo, animate } = await start([first, swapped]);
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await waitFor(() => expect(order(table)[0]).toBe('15 Mar 2027'));
    expect(animate).not.toHaveBeenCalled();
  });

  it('focus stays on the same date pair’s row when it is still shown', async () => {
    const { table, time, progressTo } = await start([first, swapped]);
    const link = within(boardRows(table)[2] ?? table).getByRole('link');
    link.focus();
    await act(async () => time.advance(31 * S));
    // the run ends: a terminal read is never held, focus or not
    await progressTo(2, 'completed');
    await waitFor(() => expect(order(table)[0]).toBe('15 Mar 2027'));
    expect(document.activeElement).toBe(link);
  });

  it('focus moves to the caption when its row leaves the shown rows', async () => {
    const { table, time, progressTo } = await start([first, leaving], '?view=dates&def=def-0001&d.week=best');
    expect(order(table)).toEqual(['14 Mar 2027', '15 Mar 2027']);
    within(boardRows(table)[1] ?? table)
      .getByRole('link')
      .focus();
    await act(async () => time.advance(31 * S));
    await progressTo(2, 'completed');
    await waitFor(() => expect(order(table)).toEqual(['14 Mar 2027', '16 Mar 2027']));
    expect(document.activeElement?.textContent).toMatch(/^Best dates/);
  });
});

describe('a read held while the operator is in the board (revision 50, Ian ruled)', () => {
  it('keeps the shown read, offers "N changes · Update board" reachable by Tab, says so once, and applies it with the transition', async () => {
    const { table, time, progressTo, animate, user } = await start([first, swapped]);
    fireEvent.pointerEnter(table.parentElement ?? table);
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    const button = await screen.findByRole('button', { name: '2 changes · Update board' });
    expect(order(table)).toEqual(['14 Mar 2027', '15 Mar 2027', '16 Mar 2027', '17 Mar 2027']);
    expect(table).toHaveTextContent('£300');
    expect(
      screen
        .getAllByRole('status')
        .filter((s) => s.textContent === '2 changes to Best dates; Update board to see them'),
    ).toHaveLength(1);
    // reachable by Tab from the board's last link
    within(boardRows(table)[3] ?? table)
      .getByRole('link')
      .focus();
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(order(table)).toEqual(['15 Mar 2027', '14 Mar 2027', '16 Mar 2027', '17 Mar 2027']);
    expect(document.activeElement?.textContent).toMatch(/^Best dates/);
    await waitFor(() => expect(new Set(flippedRows(animate))).toEqual(new Set(['0', '3'])));
    expect(screen.queryByRole('button', { name: /Update board/ })).toBeNull();
  });

  it('once the pointer has left the board and focus is outside it, the pending read applies in place', async () => {
    const { table, time, progressTo } = await start([first, swapped]);
    const region = table.parentElement ?? table;
    fireEvent.pointerEnter(region);
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await screen.findByRole('button', { name: '2 changes · Update board' });
    fireEvent.pointerLeave(region);
    await waitFor(() => expect(order(table)[0]).toBe('15 Mar 2027'));
    expect(screen.queryByRole('button', { name: /Update board/ })).toBeNull();
  });

  it('a read that changes nothing on the board is never held', async () => {
    const { table, time, progressTo, requests, client } = await start([first, first]);
    fireEvent.pointerEnter(table.parentElement ?? table);
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await waitFor(() => expect(requests).toHaveLength(2));
    await settled(client);
    expect(screen.queryByRole('button', { name: /Update board/ })).toBeNull();
  });
});
