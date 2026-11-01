import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { API, definition as definitionFixture } from '../../fixtures.js';
import { calendarCheapest, cheapest, latestRun, searchCard } from '../../fixtures.searches.js';
import { type CardRequests, serveCards, serveCardsBy } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { controllableViewport } from '../../viewport.js';
import { airportRows, renderInShell } from './support.js';

// Spec rev 55 §11 "Searches" (WP20 Task 20.3): the cards in the served order, their words, the cheapest through
// PriceCell's compact face, the actions, the side column and the poll.

afterEach(() => vi.useRealTimers());

const S = COPY.searchesView;
const list = () => screen.findByRole('list', { name: S.listLabel });
const cardOf = async (name: string) => {
  const heading = await screen.findByRole('heading', { level: 3, name });
  const card = heading.closest('li');
  if (card === null) throw new Error(`no card around ${name}`);
  return card;
};

describe('the cards list (spec rev 55 §11)', () => {
  it('lists one card per search in the served order, the api owning the order', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'd2', name: 'Second' }),
        searchCard({ id: 'd1', name: 'First' }),
        searchCard({ id: 'd3', name: 'Third', latestRun: null, cheapest: null }),
      ]),
    );
    renderInShell(<SearchesView />);
    const cards = within(await list()).getAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual(['Second', 'First', 'Third']);
  });

  it('keeps the served order while a mutation of the view is pending, and changes it on the next settled read', async () => {
    let order = ['a', 'b'];
    const names: Record<string, string> = { a: 'Alpha', b: 'Bravo' };
    server.use(serveCardsBy(() => order.map((id) => searchCard({ id, name: names[id] ?? id }))));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`${API}/definitions/:id/executions`, async () => {
        await gate;
        return HttpResponse.json({ executionId: 'exec-9' }, { status: 202 });
      }),
      http.get(`${API}/definitions`, () =>
        HttpResponse.json([{ ...definitionOf('a', 'Alpha') }, { ...definitionOf('b', 'Bravo') }]),
      ),
    );
    const { user, client } = renderInShell(<SearchesView />);
    const names0 = () =>
      within(screen.getByRole('list', { name: S.listLabel }))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent);
    await list();
    await waitFor(() => expect(names0()).toEqual(['Alpha', 'Bravo']));
    const alpha = await cardOf('Alpha');
    const again = within(alpha).getByRole('button', { name: /^Search again/ });
    await waitFor(() => expect(again).toBeEnabled());
    await user.click(again);
    await within(alpha).findByRole('button', { name: COPY.searchAgain.working });
    expect(within(alpha).getByRole('button', { name: COPY.searchAgain.working })).toBeDisabled();
    // a re-read lands with the order changed while the start is pending: the order is held
    order = ['b', 'a'];
    await act(() => client.refetchQueries({ queryKey: ['cards'] }));
    expect(names0()).toEqual(['Alpha', 'Bravo']);
    release();
    await waitFor(() => expect(names0()).toEqual(['Bravo', 'Alpha']));
  });

  it('says "No searches yet" when there is none', async () => {
    server.use(serveCards([]));
    renderInShell(<SearchesView />);
    expect(await screen.findByText('No searches yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: S.listLabel })).toBeNull();
  });
});

describe('what a card shows', () => {
  it('the route from the airports’ cities with the codes beside it, the window, the stay and the schedule', async () => {
    server.use(serveCards([searchCard()]), airportRows());
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    await waitFor(() =>
      expect(card.querySelector('.search-card-route')).toHaveTextContent(
        'Birmingham → Frankfurt (BHX → FRA)',
      ),
    );
    expect(card).toHaveTextContent('10 Jan – 31 Mar · 10–14 nights · repeats Mondays 05:00');
  });

  it('shows the codes alone until the cities are known, never a blank route', async () => {
    server.use(serveCards([searchCard({ name: 'Mine' })]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Mine');
    expect(card.querySelector('.search-card-route')).toHaveTextContent('BHX → FRA (BHX → FRA)');
  });

  it('a window that crosses a year names both years; a rolling window reads as its offsets', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'x',
          name: 'Crossing',
          window: {
            kind: 'absolute',
            departureFrom: '2026-12-10',
            departureTo: '2027-03-31',
            startOffsetDays: null,
            lengthDays: null,
          },
        }),
        searchCard({
          id: 'y',
          name: 'Rolling',
          window: {
            kind: 'relative',
            departureFrom: '2026-10-21',
            departureTo: '2027-04-21',
            startOffsetDays: 7,
            lengthDays: 182,
          },
          minNights: 14,
          maxNights: 14,
          schedule: null,
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(await cardOf('Crossing')).toHaveTextContent('10 Dec 2026 – 31 Mar 2027');
    const rolling = await cardOf('Rolling');
    expect(rolling).toHaveTextContent('rolling: 182 days from 7 days ahead · 14 nights');
    // "repeats …" only with a schedule
    expect(rolling).not.toHaveTextContent('repeats');
  });

  it.each<[string, Parameters<typeof searchCard>[0], string]>([
    [
      'searching, with the time left',
      {
        latestRun: latestRun({
          status: 'running',
          finishedAt: null,
          datePairsSearched: 120,
          estimatedFinishAt: '2026-10-14T16:40:00.000Z',
          stop: null,
        }),
      },
      'Searching · 120 of 405 date pairs · about 1h 40m left',
    ],
    [
      'searching, with no estimate: no "left" clause',
      {
        latestRun: latestRun({
          status: 'running',
          finishedAt: null,
          datePairsSearched: 120,
          estimatedFinishAt: null,
        }),
      },
      'Searching · 120 of 405 date pairs',
    ],
    [
      'reading flights',
      {
        latestRun: latestRun({
          status: 'running',
          finishedAt: null,
          flights: { planned: 10, read: 3, reused: 0, failed: 0, ended: null },
          estimatedFinishAt: '2026-10-14T15:08:00.000Z',
        }),
      },
      'Reading flights · 3 of 10',
    ],
    ['searched', {}, 'Searched 2h ago'],
    [
      // ruling R-changed: the card has no count over the current space, so the line states none
      'dates changed',
      {
        spaceChangedSince: true,
        latestRun: latestRun({ datePairsSearched: 381, datePairsNeverSearched: 0 }),
      },
      'Dates changed since this was last searched',
    ],
    ['not searched yet', { latestRun: null, cheapest: null }, 'Not searched yet'],
  ])('the state line, %s', async (_name, over, line) => {
    server.use(serveCards([searchCard(over)]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(within(card).getByTestId('card-state')).toHaveTextContent(line);
  });

  it('a stopped search prints its stop’s sentence as-is with its fix, and a row with no cause reads NO_STOP_CAUSE_TEXT', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'a',
          name: 'Stopped',
          latestRun: latestRun({
            status: 'paused_budget',
            finishedAt: null,
            stop: {
              sentence: 'Stopped at 14 Oct 15:00: its spending limit of £5 was reached.',
              fix: { text: 'Raise the limit in Edit, then Resume', command: null },
            },
          }),
        }),
        searchCard({
          id: 'b',
          name: 'Old',
          latestRun: latestRun({ status: 'paused_error', finishedAt: null, stop: null }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const stopped = within(await cardOf('Stopped')).getByTestId('card-state');
    expect(stopped).toHaveTextContent(
      'Stopped at 14 Oct 15:00: its spending limit of £5 was reached.Raise the limit in Edit, then Resume',
    );
    expect(within(stopped).getByTestId('stop-sentence')).toHaveTextContent(/^Stopped at 14 Oct 15:00/);
    const old = within(await cardOf('Old')).getByTestId('card-state');
    expect(old).toHaveTextContent('No reason was recorded for this run.');
    expect(old.textContent).not.toContain('paused: error');
  });

  it('"85 of 405 date pairs never searched" whenever that count is not zero', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'a', name: 'Some' }),
        searchCard({
          id: 'b',
          name: 'None',
          latestRun: latestRun({ datePairsSearched: 405, datePairsNeverSearched: 0 }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(await cardOf('Some')).toHaveTextContent('85 of 405 date pairs never searched');
    expect(await cardOf('None')).not.toHaveTextContent('never searched');
  });
});

describe('the cheapest, always through PriceCell’s compact face', () => {
  it('shows "£86 · 12 → 23 Jan" with its source mark and short age; nothing when there is none', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'a', name: 'Priced' }),
        searchCard({ id: 'b', name: 'Bare', cheapest: null }),
      ]),
    );
    renderInShell(<SearchesView />);
    const priced = await cardOf('Priced');
    const cell = within(priced).getByTestId('price-cell');
    expect(cell).toHaveTextContent('£86');
    expect(within(cell).getByText(COPY.providerShort.searchapi)).toBeInTheDocument();
    expect(within(cell).getByTestId('face-age')).toHaveTextContent('fetched 5h ago');
    expect(priced.querySelector('.search-card-cheapest')).toHaveTextContent('£86');
    expect(priced.querySelector('.search-card-cheapest')).toHaveTextContent('12 → 23 Jan');
    expect(priced).not.toHaveTextContent(S.cheapestSoFar);
    expect(within(await cardOf('Bare')).queryByTestId('price-cell')).toBeNull();
  });

  it('a calendar price says "not checked"; a stale one carries the stale mark', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'a', name: 'Calendar', cheapest: calendarCheapest() }),
        searchCard({ id: 'b', name: 'Old', cheapest: cheapest({ stale: 'setting' }) }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(
      within(within(await cardOf('Calendar')).getByTestId('price-cell')).getByTestId('face-age'),
    ).toHaveTextContent(COPY.notChecked);
    // the stale mark's words (spec rev 55 §3): a price on the verified basis
    expect(within(await cardOf('Old')).getByText('older than your stale setting')).toBeInTheDocument();
  });

  // why: decision 36 — a cheapest read from a truncated tile is a partial minimum, and the card says so as the board does
  it('a calendar cheapest from a truncated tile carries the truncated note; a complete one does not', async () => {
    server.use(
      serveCards([
        searchCard({ id: 'a', name: 'Cut short', cheapest: calendarCheapest({ truncated: true }) }),
        searchCard({ id: 'b', name: 'Whole', cheapest: calendarCheapest() }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(within(await cardOf('Cut short')).getByTestId('price-cell')).toHaveTextContent(COPY.truncatedNote);
    expect(within(await cardOf('Whole')).getByTestId('price-cell')).not.toHaveTextContent(COPY.truncatedNote);
  });

  it('says "cheapest so far" while the search is running', async () => {
    server.use(
      serveCards([
        searchCard({
          latestRun: latestRun({ status: 'running', finishedAt: null, estimatedFinishAt: null }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(await cardOf('Birmingham → Frankfurt')).toHaveTextContent(S.cheapestSoFar);
  });

  it('shows the red synthetic banner when any card’s cheapest is the fixture provider’s', async () => {
    const synthetic = cheapest(
      {},
      {
        providerId: 'fixture',
        sourceKind: 'synthetic',
        fetchedAt: '2026-10-14T13:00:00.000Z',
        maxAgeHours: 0,
        fx: { converted: false },
        pointOfSale: 'unknown',
        cabin: 'economy',
      },
    );
    server.use(serveCards([searchCard({ id: 'a', name: 'Fake', cheapest: synthetic })]));
    renderInShell(<SearchesView />);
    await cardOf('Fake');
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('shows no banner for real prices', async () => {
    server.use(serveCards([searchCard()]));
    renderInShell(<SearchesView />);
    await cardOf('Birmingham → Frankfurt');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
  });
});

describe('the actions', () => {
  it('See dates opens the search’s page and remembers it; Edit opens the Edit page; Search again and Remove are there', async () => {
    server.use(serveCards([searchCard()]));
    const { user } = renderInShell(<SearchesView />, { search: '?view=searches' });
    const card = await cardOf('Birmingham → Frankfurt');
    const see = within(card).getByRole('link', { name: 'See dates for Birmingham → Frankfurt' });
    expect(see).toHaveAttribute('href', '/?view=dates&def=def-0001');
    expect(within(card).getByRole('link', { name: 'Edit Birmingham → Frankfurt' })).toHaveAttribute(
      'href',
      '/?view=definitions&edit=def-0001',
    );
    expect(within(card).getByRole('button', { name: /^Search again/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /^Remove / })).toBeInTheDocument();
    await user.click(see);
    expect(window.localStorage.getItem('gmt.lastSearch')).toBe('def-0001');
    expect(window.location.search).toBe('?view=dates&def=def-0001');
  });

  it('Remove sits apart from Search again, in its own group at the far end', async () => {
    server.use(serveCards([searchCard()]));
    renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    const again = within(card).getByRole('button', { name: /^Search again/ });
    const remove = within(card).getByRole('button', { name: /^Remove / });
    expect(again.closest('.search-card-main-actions')).not.toBeNull();
    expect(remove.closest('.search-card-main-actions')).toBeNull();
    expect(remove.closest('.search-remove')).not.toBeNull();
  });
});

describe('the side column (ruling A18)', () => {
  it('mounts the new-search form, with Search now, first in the DOM, as a phone shows it (ruling A18)', async () => {
    server.use(serveCards([searchCard()]));
    renderInShell(<SearchesView />);
    const side = await screen.findByRole('region', { name: S.sideHeading });
    const main = screen.getByRole('region', { name: S.listLabel });
    expect(await within(side).findByRole('button', { name: COPY.searchAgain.searchNow })).toBeInTheDocument();
    expect(within(side).queryByRole('button', { name: 'Show estimate' })).toBeNull();
    // why: DOM order follows the phone's visual order (WCAG 2.4.3): the form first; CSS grid puts it on the right
    expect(side.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // no link out to the Edit page's form: the form is here (ruling A18)
    expect(within(side).queryByRole('link', { name: /New search/ })).toBeNull();
  });

  it('the stylesheet places the form in the right column from 900 px and in the single column below, with one DOM order', () => {
    const css = readFileSync(join(process.cwd(), 'src/views/Searches/searches.css'), 'utf8');
    expect(css).toMatch(/\.searches-side\s*\{\s*grid-column: 2;\s*grid-row: 1;/);
    expect(css).toMatch(/\.searches-main\s*\{\s*grid-column: 1;\s*grid-row: 1;/);
    expect(css).toMatch(
      /@media \(max-width: 899px\)[\s\S]*\.searches-side,\s*\.searches-main\s*\{\s*grid-column: 1;\s*grid-row: auto;/,
    );
  });

  it('crossing 900 px keeps the form’s draft: the same field node, the same typed text', async () => {
    const viewport = controllableViewport(1280);
    server.use(serveCards([searchCard()]));
    const { user } = renderInShell(<SearchesView />);
    const side = await screen.findByRole('region', { name: S.sideHeading });
    const field = await within(side).findByLabelText(PLAN_COPY.from);
    await user.type(field, 'Birm');
    expect(field).toHaveValue('Birm');
    await act(async () => viewport.set(375));
    await act(async () => viewport.set(1280));
    const after = within(screen.getByRole('region', { name: S.sideHeading })).getByLabelText(PLAN_COPY.from);
    expect(after).toBe(field);
    expect(after).toHaveValue('Birm');
  });
});

describe('the poll', () => {
  // why: only the interval is faked and the clock does not advance by itself, so "POLL_MS − 1 makes no request" is exact;
  // Testing Library's waits then run on the DOM's mutation events
  const fakeClock = () =>
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'], shouldAdvanceTime: false });

  it('re-reads at POLL_MS only while a card is pending or running', async () => {
    fakeClock();
    const requests: CardRequests = [];
    server.use(
      serveCards(
        [
          searchCard({
            latestRun: latestRun({ status: 'running', finishedAt: null, estimatedFinishAt: null }),
          }),
        ],
        requests,
      ),
    );
    renderInShell(<SearchesView />);
    await cardOf('Birmingham → Frankfurt');
    expect(requests).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS - 1));
    expect(requests).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await waitFor(() => expect(requests).toHaveLength(2));
  });

  it('does not poll when every card has stopped or finished', async () => {
    fakeClock();
    const requests: CardRequests = [];
    server.use(serveCards([searchCard()], requests));
    renderInShell(<SearchesView />);
    await cardOf('Birmingham → Frankfurt');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(requests).toHaveLength(1);
  });
});

/** A definition body for the default definitions read, as the Search again button looks it up by id. */
function definitionOf(id: string, name: string) {
  return definitionFixture({ id, name });
}

describe('the schedule in words', () => {
  it.each<[string, string, string]>([
    ['every day', '30 6 * * *', 'repeats every day 06:30'],
    ['several days', '0 5 * * 1,4', 'repeats Mondays and Thursdays 05:00'],
    ['all seven days', '0 5 * * 0,1,2,3,4,5,6', 'repeats every day 05:00'],
    ['a schedule the picker cannot read back', '0 5 1 * *', 'repeats on a set schedule'],
  ])('%s', async (_name, cron, words) => {
    server.use(serveCards([searchCard({ schedule: { cron, tz: 'Europe/London' } })]));
    renderInShell(<SearchesView />);
    expect(await cardOf('Birmingham → Frankfurt')).toHaveTextContent(words);
  });

  it('a trip across two months names both', async () => {
    server.use(
      serveCards([
        searchCard({ cheapest: cheapest({ departureDate: '2027-01-28', returnDate: '2027-02-08' }) }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(await cardOf('Birmingham → Frankfurt')).toHaveTextContent('28 Jan → 8 Feb');
  });

  it('a finished run with no recorded time reads "Not searched yet", never "Searched"', async () => {
    server.use(serveCards([searchCard({ latestRun: latestRun({ finishedAt: null, startedAt: null }) })]));
    renderInShell(<SearchesView />);
    expect(within(await cardOf('Birmingham → Frankfurt')).getByRole('status')).toHaveTextContent(
      'Not searched yet',
    );
  });
});

describe('what a card announces (review finding 16)', () => {
  const live = (card: HTMLElement) => within(card).getByRole('status');

  it('the polite line carries the kind of state, not the counts, so a poll that moves a count announces nothing', async () => {
    let searched = 120;
    server.use(
      serveCardsBy(() => [
        searchCard({
          latestRun: latestRun({
            status: 'running',
            finishedAt: null,
            datePairsSearched: searched,
            estimatedFinishAt: null,
          }),
        }),
      ]),
    );
    const { client } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(live(card)).toHaveTextContent(/^Searching$/);
    expect(live(card)).toHaveClass('sr-only');
    expect(within(card).getByTestId('card-state')).toHaveTextContent('120 of 405');
    const spoken = live(card).firstChild;
    searched = 200;
    await act(() => client.refetchQueries({ queryKey: ['cards'] }));
    await waitFor(() => expect(within(card).getByTestId('card-state')).toHaveTextContent('200 of 405'));
    // the same text node: nothing changed in the live region
    expect(live(card).firstChild).toBe(spoken);
    expect(live(card)).toHaveTextContent(/^Searching$/);
    // the visible line is not itself a live region
    expect(within(card).getByTestId('card-state').closest('[role="status"], [aria-live]')).toBeNull();
  });

  it('a change of kind is announced: running becomes searched', async () => {
    let status: 'running' | 'completed' = 'running';
    server.use(
      serveCardsBy(() => [
        searchCard({
          latestRun: latestRun({
            status,
            finishedAt: status === 'running' ? null : '2026-10-14T14:00:00.000Z',
          }),
        }),
      ]),
    );
    const { client } = renderInShell(<SearchesView />);
    const card = await cardOf('Birmingham → Frankfurt');
    expect(live(card)).toHaveTextContent(/^Searching$/);
    status = 'completed';
    await act(() => client.refetchQueries({ queryKey: ['cards'] }));
    await waitFor(() => expect(live(card)).toHaveTextContent(/^Searched$/));
  });

  it('a stop is announced as its sentence', async () => {
    server.use(
      serveCards([
        searchCard({
          latestRun: latestRun({
            status: 'paused_error',
            finishedAt: null,
            stop: { sentence: 'The source asked the app to slow down.', fix: null },
          }),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    expect(live(await cardOf('Birmingham → Frankfurt'))).toHaveTextContent(
      'The source asked the app to slow down.',
    );
  });
});

describe('the cheapest names its airport (review finding 9)', () => {
  it('the compact face carries the destination code the card serves', async () => {
    server.use(serveCards([searchCard({ cheapest: cheapest({ destination: 'FRA' }) })]));
    renderInShell(<SearchesView />);
    const cell = within(await cardOf('Birmingham → Frankfurt')).getByTestId('price-cell');
    expect(cell).toHaveTextContent('FRA');
  });
});
