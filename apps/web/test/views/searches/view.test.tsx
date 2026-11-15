import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { API, definition as definitionFixture, provSynthetic } from '../../fixtures.js';
import {
  calendarOnly,
  cardTrip,
  latestRun,
  lowerOnCalendar,
  noPrices,
  searchCard,
} from '../../fixtures.searches.js';
import { type CardRequests, serveCards, serveCardsBy } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { controllableViewport } from '../../viewport.js';
import { renderInShell } from './support.js';

// Spec rev 55 §11 "Searches" (WP20 Task 20.3): the cards in the served order, their words, the cheapest through
// PriceCell's compact face, the actions, the side column and the poll.

afterEach(() => vi.useRealTimers());

const S = COPY.searchesView;
const list = () => screen.findByRole('list', { name: S.listLabel });
const cardOf = async (name: string) => {
  const heading = await screen.findByRole('heading', { level: 2, name });
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
        searchCard({ id: 'd3', name: 'Third', latestRun: null, ...noPrices }),
      ]),
    );
    renderInShell(<SearchesView />);
    const cards = within(await list()).getAllByRole('heading', { level: 2 });
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
        .getAllByRole('heading', { level: 2 })
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

describe('the synthetic banner (Ruling 7)', () => {
  it('shows the red synthetic banner when any card’s trip is the fixture provider’s', async () => {
    server.use(serveCards([searchCard({ id: 'a', name: 'Fake', trips: [cardTrip({}, provSynthetic)] })]));
    renderInShell(<SearchesView />);
    await cardOf('Fake');
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  // why: Ruling 7 (a page's synthetic check covers every price it carries): the lower-on-calendar price counts too
  it('shows the banner when a card’s lower-on-calendar price is synthetic, beside a real trip', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'a',
          name: 'Fake below',
          lowerOnCalendar: lowerOnCalendar({ pricePence: 5000 }, provSynthetic),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    await cardOf('Fake below');
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('shows the banner when only a later trip is synthetic', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'a',
          name: 'Fake second',
          trips: [cardTrip(), cardTrip({ pricePence: 9000, departureDate: '2027-01-13' }, provSynthetic)],
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    await cardOf('Fake second');
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('shows the banner on a card with no trip whose lower-on-calendar price is synthetic', async () => {
    server.use(serveCards([searchCard({ id: 'a', name: 'Fake only', ...calendarOnly({}, provSynthetic) })]));
    renderInShell(<SearchesView />);
    await cardOf('Fake only');
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('shows no banner for real prices', async () => {
    server.use(serveCards([searchCard()]));
    renderInShell(<SearchesView />);
    await cardOf('Birmingham → Frankfurt');
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
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
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../src/views/Searches/searches.css'),
      'utf8',
    );
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
});
