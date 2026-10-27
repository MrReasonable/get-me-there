import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { PLAN_COPY } from '../../src/copy/plan.js';
import { COPY } from '../../src/copy.js';
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
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { server } from '../msw/server.js';
import { drawn, renderWithProviders } from '../render.js';

/**
 * One landmark per view that exists only once the view's data has rendered, so the sweep cannot pass over a view that
 * showed nothing but an error or a skeleton (neither carries a banned word or a "£").
 */
const CONTENT: Record<(typeof VIEWS)[number], () => Promise<HTMLElement>> = {
  dates: () => screen.findByRole('table', { name: /^Best dates/ }),
  results: () => screen.findByRole('table', { name: 'Round trips found' }),
  // why: the chart draws its axes after the figure renders; the sweep reads them, so it waits for the drawn surface
  history: async () => {
    const figure = await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle });
    await drawn(figure);
    return figure;
  },
  definitions: () => screen.findByRole('button', { name: COPY.showEstimate }),
  alerts: () => screen.findByRole('heading', { name: COPY.alertsView.heading }),
  providers: () => screen.findByRole('heading', { name: COPY.providersHeading }),
  status: () => screen.findByRole('heading', { name: COPY.statusView.heading }),
};

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
      // why: Results is the date pair detail (WP19 Task 19.6): its URL names the date pair
      const pair = view === 'results' ? '&depart=2027-03-14&return=2027-03-28' : '';
      const { user } = renderWithProviders(<App />, {
        search: `?view=${view}&def=def-0001&${classes}${pair}`,
      });
      await screen.findByRole('navigation', { name: 'Views' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      // why: a failed or empty load would pass the sweep untouched, so the view must have rendered its own content
      await CONTENT[view]();
      expect(screen.queryByText(/^Could not load:/)).toBeNull();
      expect(screen.queryByText(/^Provider status unknown/)).toBeNull();
      if (view === 'results') {
        for (const b of screen.getAllByRole('button', { name: /Show details/ })) await user.click(b);
        expect(screen.getAllByRole('button', { name: /Hide details/ })).toHaveLength(4);
      }
      if (view === 'definitions') await user.click(await screen.findByText(PLAN_COPY.moreOptions));
      const hits = findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST);
      expect(hits.map((h) => h.word)).toEqual([]);
      expect(poundsOutsidePrices()).toEqual([]);
    });
  }
});
