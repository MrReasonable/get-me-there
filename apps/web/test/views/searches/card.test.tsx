import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { SearchesView } from '../../../src/views/Searches/SearchesView.js';
import { cheapest, flightListProvenance, searchCard } from '../../fixtures.searches.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { renderInShell } from './support.js';

// Spec rev 56 §11 "Searches", §6.9 (prov-006; arch-r3-003): a card whose cheapest is a pairing figure. The card carries
// no seller, offer count or grid price, so it words the figure "cheapest of the sellers read, not checked with the
// airline", calendar-styled (the dashed outline, "not checked" on its face), never "verified".

describe('a card whose cheapest is a pairing figure (spec rev 56 §11; prov-006)', () => {
  // why: design 2026-11-08 §5.6: the card carries the price kind and words it, never a Google price as a seller's
  it.each([
    ['seller', 'cheapest of the sellers read, not checked with the airline'],
    ['google-unread', "Google's price, sellers not read, not checked with the airline"],
    ['google-incomplete', "Google's price, not every seller read, not checked with the airline"],
  ] as const)('words a %s price', async (priceKind, words) => {
    server.use(
      serveCards([
        searchCard({
          id: 'k',
          name: 'Kind',
          cheapest: cheapest(
            { basis: 'pairing', priceKind, pricePence: 118_000 },
            flightListProvenance('2026-10-14T10:44:00.000Z'),
          ),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Kind' });
    expect(within(heading.closest('li') ?? document.body).getByTestId('card-price-kind')).toHaveTextContent(
      words,
    );
  });

  it('renders calendar-styled with "not checked" and the pairing basis words', async () => {
    server.use(
      serveCards([
        searchCard({
          id: 'p',
          name: 'Pairing',
          origins: ['LHR'],
          destinations: ['JFK'],
          cheapest: cheapest(
            {
              basis: 'pairing',
              priceKind: 'seller',
              pricePence: 118_000,
              origin: 'LHR',
              destination: 'JFK',
              departureDate: '2027-03-14',
              returnDate: '2027-03-24',
            },
            flightListProvenance('2026-10-14T10:44:00.000Z'),
          ),
        }),
      ]),
    );
    renderInShell(<SearchesView />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Pairing' });
    const card = heading.closest('li');
    if (card === null) throw new Error('no card');
    const cell = within(card).getByTestId('price-cell');
    expect(cell).toHaveTextContent('£1,180');
    expect(within(cell).getByTestId('face-age')).toHaveTextContent(COPY.notChecked);
    expect(cell.className).toMatch(/border-dashed/);
    const cheapestLine = card.querySelector('.search-card-cheapest');
    expect(cheapestLine).toHaveTextContent('cheapest of the sellers read, not checked with the airline');
    expect(card).not.toHaveTextContent(/verified/i);
  });

  it('a calendar or verified cheapest carries no pairing words', async () => {
    server.use(serveCards([searchCard({ id: 'v', name: 'Verified' })]));
    renderInShell(<SearchesView />);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Verified' });
    expect(heading.closest('li')?.querySelector('[data-testid="card-price-kind"]')).toBeNull();
  });
});
