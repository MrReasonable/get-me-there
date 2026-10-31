import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { API, definition } from '../../fixtures.js';
import { searchCard } from '../../fixtures.searches.js';
import { CARDS_URL, serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderInShell } from './support.js';

// Spec rev 55 §11 "Searches": a failed read, remove or start is said in plain words beside its action, with Retry for
// the read.

const NAME = 'Birmingham → Frankfurt';
const cardOf = async () => {
  const heading = await screen.findByRole('heading', { level: 3, name: NAME });
  const card = heading.closest('li');
  if (card === null) throw new Error('no card');
  return card;
};

describe('the Searches view’s states', () => {
  it('while the cards load it says so', async () => {
    server.use(http.get(CARDS_URL, () => new Promise<never>(() => undefined)));
    renderInShell(<SearchesView />);
    expect(await screen.findByText(COPY.loading, { selector: 'p[role="status"]' })).toBeInTheDocument();
    expect(screen.queryByText('No searches yet')).toBeNull();
  });

  it('a failed read is an alert in plain words with Retry, and Retry reads again', async () => {
    let ok = false;
    server.use(
      http.get(CARDS_URL, () =>
        ok
          ? HttpResponse.json({ cards: [] })
          : HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
    );
    const { user } = renderInShell(<SearchesView />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load: db is down');
    expect(screen.queryByText('No searches yet')).toBeNull();
    ok = true;
    await user.click(within(alert).getByRole('button', { name: COPY.retryLoad }));
    expect(await screen.findByText('No searches yet')).toBeInTheDocument();
  });

  it('a 500 from Remove is said beside the action and the card stays', async () => {
    server.use(
      serveCards([searchCard()]),
      http.delete(`${API}/definitions/:id`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf();
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Could not remove: db is down');
    expect(screen.queryByText(`Removed ${NAME}.`)).toBeNull();
    // the action is back, so it can be tried again
    expect(within(card).getByRole('button', { name: `Remove ${NAME}` })).toBeEnabled();
  });

  it('a 500 from Search again is said beside the action', async () => {
    server.use(
      serveCards([searchCard()]),
      http.get(`${API}/definitions`, () => HttpResponse.json([definition()])),
      http.post(`${API}/definitions/:id/executions`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf();
    const again = within(card).getByRole('button', { name: /^Search again/ });
    await waitFor(() => expect(again).toBeEnabled());
    await user.click(again);
    expect(await within(card).findByRole('alert')).toHaveTextContent('That did not work: db is down');
  });

  it('a failed Undo is said beside it, and the line stays', async () => {
    server.use(
      serveCards([searchCard()]),
      http.post(`${API}/definitions/:id/restore`, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'db is down' } }, { status: 500 }),
      ),
    );
    const { user } = renderInShell(<SearchesView />);
    const card = await cardOf();
    await user.click(within(card).getByRole('button', { name: `Remove ${NAME}` }));
    await user.click(within(card).getByRole('button', { name: 'Remove' }));
    await user.click(await screen.findByRole('button', { name: `Undo removing ${NAME}` }));
    expect(await screen.findByText('Could not undo: db is down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Undo removing ${NAME}` })).toBeEnabled();
  });
});
