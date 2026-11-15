import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import type { RereadClock } from '../../../src/views/Dates/DatesView.js';
import {
  at,
  type DatesOptions,
  figurePairing,
  pairingFig,
  priced,
  pricedPair,
  runSummary,
} from '../../fixtures.dates.js';
import { API, execution } from '../../fixtures.js';
import { searchCard } from '../../fixtures.searches.js';
import { type Requests, serveDatesBy } from '../../msw/datesHandlers.js';
import { type CardRequests, serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { calendarRows, findLower, findTrips, renderDates, rowText, tripRows } from './render.js';

// Spec §11 "Run landing", design 2026-11-08 Ruling 17 and Review Focus 2: while a search runs, the page re-reads its
// dates at most once every 30 s with a trailing read, and at once when the run ends; each read shows as it lands (no
// hold, no transition, no "Update board"); the rows keep their labels and ages, and a trip an earlier search read says
// so. Every clock read and timer is injected.

const S = 1_000;
const R = COPY.searchesView;

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
/** A trip the previous search read, £480, read 26 h ago. */
const earlier = pairingFig({
  pairing: figurePairing({ pricePence: 48_000, fromPence: 48_000, ageHours: 26 }),
  price: { ...pairingFig().price, pricePence: 48_000, ageHours: 26 },
  fromEarlierSearch: true,
});
/** The first read: the earlier trip and three calendar prices at £300–£320. */
const first: DatesOptions = {
  executions: RUN,
  pairs: {
    [at('2027-03-14', 10)]: pricedPair(earlier),
    [at('2027-03-15', 10)]: pricedPair(priced(30_000)),
    [at('2027-03-16', 10)]: pricedPair(priced(31_000)),
    [at('2027-03-17', 10)]: pricedPair(priced(32_000)),
  },
};
/** The second read: 15 Mar repriced to £315, so it moves below 16 Mar. */
const second: DatesOptions = {
  ...first,
  pairs: { ...first.pairs, [at('2027-03-15', 10)]: pricedPair(priced(31_500)) },
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
});

async function start(reads: DatesOptions[]) {
  const requests = serveReads(...reads);
  const time = fakeClock();
  const r = renderDates({ props: { clock: time.clock } });
  await findTrips();
  // the run's own poll has answered: its first answer is the run as the read saw it
  await waitFor(() => expect(r.client.getQueryData(['execution', 'exec-0001'])).toBeDefined());
  const progressTo = (n: number, status: 'running' | 'completed' = 'running') =>
    act(async () => {
      r.client.setQueryData(['execution', 'exec-0001'], execution({ status, progress: progress(n) }));
    });
  return { ...r, requests, time, progressTo };
}
const lowerPrices = async () =>
  calendarRows(await findLower()).map((row) => within(row).getByTestId('price-cell').textContent);

describe('the 30 s re-read during a run', () => {
  it('a progress change 10 s after a read is read at 30 s, once', async () => {
    const { requests, time, progressTo } = await start([first, second]);
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
    // the read lands inside the test: the repriced date moves below 16 Mar at once, nothing held
    await waitFor(async () => expect(await lowerPrices()).toEqual(['£310', '£315', '£320']));
  });

  it('the run leaving pending or running is read at once, even 5 s after a read', async () => {
    const { requests, time, progressTo } = await start([first, second]);
    await act(async () => time.advance(5 * S));
    await progressTo(1, 'completed');
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(async () => expect(await lowerPrices()).toEqual(['£310', '£315', '£320']));
  });
});

// final review M5: the run line's whole-space counts come from the card, which the page re-reads itself at the run's
// end (without a top bar mounted, whose own cards poll would otherwise be the only one to refresh it)
describe('the run’s end re-reads the card too', () => {
  it('the cards are read again at once when the run leaves running, and not on a progress change', async () => {
    const cards: CardRequests = [];
    server.use(serveCards([searchCard({ id: 'def-0001' })], cards));
    const { time, progressTo } = await start([first, second]);
    await waitFor(() => expect(cards.length).toBeGreaterThan(0));
    const before = cards.length;
    await act(async () => time.advance(40 * S));
    await progressTo(2);
    await act(async () => time.advance(40 * S));
    expect(cards).toHaveLength(before);
    await progressTo(2, 'completed');
    await waitFor(() => expect(cards).toHaveLength(before + 1));
  });
});

describe('re-reads during a run keep the rows with their ages (Ruling 17, Review Focus 2)', () => {
  it('a re-read applies while the pointer and the focus are in a section: no "Update board", no hold', async () => {
    const { requests, time, progressTo } = await start([first, second]);
    const lower = await findLower();
    // the operator is in the section: the pointer over it, the focus on a row's label
    fireEvent.pointerEnter(lower);
    // why: CodeRabbit CR30: the label's summary takes the focus (its details element cannot), and the test checks
    // that it did, so the re-read is shown to apply with the focus in the section
    const label = within(calendarRows(lower)[0] ?? lower)
      .getAllByRole('group')[0]
      ?.querySelector('summary');
    if (label === null || label === undefined) throw new Error('the row has a label');
    label.focus();
    expect(label).toHaveFocus();
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await waitFor(() => expect(requests).toHaveLength(2));
    await waitFor(async () => expect(await lowerPrices()).toEqual(['£310', '£315', '£320']));
    expect(screen.queryByRole('button', { name: /Update board/ })).toBeNull();
    expect(screen.queryByText(/Best dates updated|changes? to Best dates/)).toBeNull();
  });

  it('the earlier trip keeps its age and says the previous search read it, before and after the re-read', async () => {
    const { requests, time, progressTo } = await start([first, second]);
    const check = async () => {
      const [row] = tripRows(await findTrips());
      if (row === undefined) throw new Error('the earlier trip is shown');
      expect(row).toHaveAttribute('data-earlier', 'true');
      // its label keeps its age (26h) and its detail names the previous search, while one runs
      expect(within(row).getByTestId('price-label')).toHaveTextContent(/^Seller · 26h/);
      expect(rowText(row)).toContain(R.previousSearchReplaced);
    };
    await check();
    await act(async () => time.advance(31 * S));
    await progressTo(2);
    await waitFor(() => expect(requests).toHaveLength(2));
    // why: CodeRabbit CR29: the second read has drawn (its repriced date moved) before the trip is checked again
    await waitFor(async () => expect(await lowerPrices()).toEqual(['£310', '£315', '£320']));
    await check();
  });
});
