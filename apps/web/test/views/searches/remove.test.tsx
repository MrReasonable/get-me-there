import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLL_MS } from '../../../src/api/queries.js';
import type { SearchCard } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { SearchesView, UNDO_MS } from '../../../src/views/Searches/SearchesView.js';
import { API, definition } from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { serveCardsBy } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderInShell } from './support.js';

// Spec rev 55 §11 "Searches", Remove: inline, no modal, "Cancel and remove" for a running search, the "Removed … Undo"
// line for 30 s through any re-read, and Undo putting the card back in its place with focus on its heading.

afterEach(() => vi.useRealTimers());

const S = COPY.searchesView;
const NAME = 'Birmingham → Frankfurt';
const cardOf = async (name: string) => {
  const heading = await screen.findByRole('heading', { level: 3, name });
  const card = heading.closest('li');
  if (card === null) throw new Error(`no card around ${name}`);
  return card;
};

/** A server with three searches: the middle one is the subject; the last is running (so the view polls). */
function serveThree(gates: Record<string, Promise<void>> = {}) {
  const original: SearchCard[] = [
    searchCard({ id: 'a', name: 'Alpha' }),
    searchCard({ id: 'b', name: NAME }),
    searchCard({
      id: 'c',
      name: 'Charlie',
      latestRun: latestRun({ status: 'running', finishedAt: null, estimatedFinishAt: null }),
    }),
  ];
  let live = [...original];
  const deleted: string[] = [];
  const restored: string[] = [];
  const calls = { deleted, restored };
  server.use(
    serveCardsBy(() => live),
    http.get(`${API}/definitions`, () =>
      HttpResponse.json(original.map((c) => definition({ id: c.id, name: c.name }))),
    ),
    http.delete(`${API}/definitions/:id`, async ({ params }) => {
      const id = String(params.id);
      calls.deleted.push(id);
      await gates[id];
      live = live.filter((c) => c.id !== id);
      return HttpResponse.json({ id, deletedAt: '2026-10-14T15:00:00.000Z' });
    }),
    http.post(`${API}/definitions/:id/restore`, async ({ params }) => {
      const id = String(params.id);
      calls.restored.push(id);
      await gates[`restore-${id}`];
      live = original.filter((c) => live.some((l) => l.id === c.id) || c.id === id);
      return HttpResponse.json(definition({ id }));
    }),
  );
  return calls;
}

describe('Remove asks inline (spec rev 55 §11)', () => {
  it('asks "Remove <name>? Remove · Keep" in place, with no dialog and focus on Remove', async () => {
    serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    expect(within(card).getByText(`Remove ${NAME}?`)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Remove' })).toHaveFocus();
    expect(within(card).getByRole('button', { name: 'Keep' })).toBeInTheDocument();
  });

  it('on a pending or running search it reads "Cancel and remove <name>?"', async () => {
    serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf('Charlie');
    await user.click(within(card).getByRole('button', { name: 'Remove Charlie' }));
    expect(within(card).getByText('Cancel and remove Charlie?')).toBeInTheDocument();
  });

  it('Keep restores the actions and puts focus back on the Remove button, and nothing is sent', async () => {
    const calls = serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Keep' }));
    expect(within(card).queryByText(`Remove ${NAME}?`)).toBeNull();
    const again = within(card).getByRole('button', { name: `Remove ${NAME}` });
    expect(again).toHaveFocus();
    expect(within(card).getByRole('button', { name: /^Search again/ })).toBeInTheDocument();
    expect(calls.deleted).toEqual([]);
  });
});

describe('Remove, the undo line and Undo', () => {
  const fakeClock = () =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
      shouldAdvanceTime: true,
    });

  it('DELETEs the search, replaces the card in its place with "Removed <name>. Undo" and puts focus on Undo', async () => {
    const calls = serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    const undo = await screen.findByRole('button', { name: `Undo removing ${NAME}` });
    expect(calls.deleted).toEqual(['b']);
    expect(undo).toHaveTextContent('Undo');
    expect(undo.closest('[role="status"]')).toHaveTextContent(`Removed ${NAME}.Undo`);
    expect(undo).toHaveFocus();
    // in its place: between the two other cards, which have not moved
    const items = within(screen.getByRole('list', { name: S.listLabel })).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('h3')?.textContent ?? 'removed')).toEqual([
      'Alpha',
      'removed',
      'Charlie',
    ]);
    expect(screen.queryByRole('heading', { level: 3, name: NAME })).toBeNull();
  });

  it('keeps the line for UNDO_MS through a re-read of the cards, then it is gone', async () => {
    fakeClock();
    serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    await screen.findByRole('button', { name: `Undo removing ${NAME}` });
    expect(UNDO_MS).toBe(30_000);
    // a re-read lands (the running card polls): the line stays
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByRole('button', { name: `Undo removing ${NAME}` })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS - 2 * POLL_MS - 1_000));
    expect(screen.getByRole('button', { name: `Undo removing ${NAME}` })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.queryByRole('button', { name: `Undo removing ${NAME}` })).toBeNull();
    expect(screen.queryByText(`Removed ${NAME}.`)).toBeNull();
    expect(screen.queryByRole('heading', { level: 3, name: NAME })).toBeNull();
  });

  it('Undo restores the search, the card returns to its place with its schedule, and focus moves to its heading', async () => {
    const calls = serveThree();
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: `Undo removing ${NAME}` }));
    const heading = await screen.findByRole('heading', { level: 3, name: NAME });
    expect(calls.restored).toEqual(['b']);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading.closest('li')).toHaveTextContent('repeats Mondays 05:00');
    expect(screen.queryByText(`Removed ${NAME}.`)).toBeNull();
    const names = within(screen.getByRole('list', { name: S.listLabel }))
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(names).toEqual(['Alpha', NAME, 'Charlie']);
  });
});

/** A promise and the function that settles it, so a test holds a request open and releases it on an event. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('back-to-back Remove and Undo each keep their own outcome (review finding 5)', () => {
  const confirmRemove = async (user: ReturnType<typeof renderInShell>['user'], name: string) => {
    const card = await cardOf(name);
    await user.click(within(card).getByRole('button', { name: `Remove ${name}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
  };

  it('removing two cards while the first DELETE is still open leaves a "Removed" line for each', async () => {
    const first = gate();
    const calls = serveThree({ a: first.promise });
    const { user } = renderInShell(<SearchesView />);
    await confirmRemove(user, 'Alpha');
    await waitFor(() => expect(calls.deleted).toEqual(['a']));
    await confirmRemove(user, NAME);
    expect(await screen.findByRole('button', { name: `Undo removing ${NAME}` })).toBeInTheDocument();
    first.release();
    expect(await screen.findByRole('button', { name: 'Undo removing Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Undo removing ${NAME}` })).toBeInTheDocument();
    expect(calls.deleted).toEqual(['a', 'b']);
  });

  it('undoing two removed cards quickly puts both back', async () => {
    const hold = gate();
    const calls = serveThree({ 'restore-a': hold.promise });
    const { user } = renderInShell(<SearchesView />);
    await confirmRemove(user, 'Alpha');
    await screen.findByRole('button', { name: 'Undo removing Alpha' });
    await confirmRemove(user, NAME);
    await screen.findByRole('button', { name: `Undo removing ${NAME}` });
    await user.click(screen.getByRole('button', { name: 'Undo removing Alpha' }));
    await waitFor(() => expect(calls.restored).toEqual(['a']));
    await user.click(screen.getByRole('button', { name: `Undo removing ${NAME}` }));
    hold.release();
    expect(await screen.findByRole('heading', { level: 3, name: 'Alpha' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: NAME })).toBeInTheDocument();
    expect(screen.queryByText(/^Removed /)).toBeNull();
  });
});

describe('focus around Remove (review finding 7)', () => {
  it('rests on the card’s Remove group while the request is open, never on the page', async () => {
    const open = gate();
    serveThree({ b: open.promise });
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    expect(document.activeElement).not.toBe(document.body);
    expect(card.contains(document.activeElement)).toBe(true);
    open.release();
    await screen.findByRole('button', { name: `Undo removing ${NAME}` });
  });

  it('returns to the Remove button after a failed remove', async () => {
    serveThree();
    server.use(
      http.delete(`${API}/definitions/:id`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf(NAME);
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    await within(card).findByRole('alert');
    await waitFor(() => expect(within(card).getByRole('button', { name: `Remove ${NAME}` })).toHaveFocus());
  });
});
