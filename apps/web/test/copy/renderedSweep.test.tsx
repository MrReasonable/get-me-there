import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { VIEWS } from '../../src/state/view.js';
import {
  API,
  calendarGap,
  calendarRow,
  execution,
  failedRow,
  partialRow,
  providersResponse,
  resultsResponse,
  verifiedRow,
} from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

/** Every visible string plus the attributes a screen reader or tooltip shows. */
function renderedCopy(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')].flatMap(
    (el) => ['title', 'aria-label', 'placeholder', 'alt'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

/**
 * Every "£" in the DOM sits inside a PriceCell (a fare, with provenance), a [data-cost] element (a cost
 * or a cap) or a form label ("Max price (£)"), on every view (reviews tsr-003, prov-r2-007).
 */
function poundsOutsidePrices(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const outside: string[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const host = n.parentElement;
    if (
      n.textContent?.includes('£') &&
      host?.closest('[data-testid="price-cell"], [data-cost], label') === null
    ) {
      outside.push(n.textContent);
    }
  }
  return outside;
}

describe('rendered views contain no banned word, and no "£" outside a price or a cost (spec §11, §9 item 6)', () => {
  for (const view of VIEWS) {
    it(`view=${view}`, async () => {
      server.use(
        http.get(`${API}/providers`, () => HttpResponse.json(providersResponse({ synthetic: true }))),
        http.get(`${API}/executions/:id`, () =>
          HttpResponse.json(
            execution({ status: 'paused_budget', reason: 'searchapi provider-month cap reached' }),
          ),
        ),
        http.get(`${API}/definitions/:id/results`, () =>
          HttpResponse.json(
            resultsResponse({
              rows: [verifiedRow(), partialRow(), failedRow(), calendarRow({ truncated: true })],
              truncated: true,
              total: 4210,
            }),
          ),
        ),
        http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(calendarGap())),
      );
      // why: core's filterRows hides failed rows by default (spec §6.9); every class is in the URL so every row's copy is swept.
      const classes = 'f.class=verified,partially-verified,failed,unchecked';
      const { user } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001&${classes}` });
      await screen.findByRole('navigation', { name: 'Views' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      if (view === 'results') {
        await screen.findByRole('table', { name: 'Round trips found' });
        for (const b of screen.getAllByRole('button', { name: /Show details/ })) await user.click(b);
        expect(screen.getAllByRole('button', { name: /Hide details/ })).toHaveLength(4);
      }
      if (view === 'definitions')
        await user.click(await screen.findByText('Advanced: constraints and policy'));
      const hits = findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST);
      expect(hits.map((h) => h.word)).toEqual([]);
      expect(poundsOutsidePrices()).toEqual([]);
    });
  }
});
