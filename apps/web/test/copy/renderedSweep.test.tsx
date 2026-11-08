import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { PAIRING_FIXTURE } from '@gmt/core/testing';
import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/App.js';
import { PLAN_COPY } from '../../src/copy/plan.js';
import { COPY } from '../../src/copy.js';
import { VIEWS } from '../../src/state/view.js';
import {
  at,
  calendarFig,
  type DatesOptions,
  figurePairing,
  pairingFig,
  pricedPair,
  provCached,
} from '../fixtures.dates.js';
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
import { flightPair, pairingList } from '../fixtures.searches.js';
import { poundsOutsidePrices, renderedCopy } from '../guards.js';
import { serveDates } from '../msw/datesHandlers.js';
import { serveFlightLists } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { drawn, renderWithProviders } from '../render.js';
import { jargonIn, mainPathWords } from '../views/dates/jargon.js';

/**
 * One landmark per view that exists only once the view's data has rendered, so the sweep cannot pass over a view that
 * showed nothing but an error or a skeleton (neither carries a banned word or a "£").
 */
const CONTENT: Record<(typeof VIEWS)[number], () => Promise<HTMLElement>> = {
  searches: () => screen.findByRole('list', { name: COPY.searchesView.listLabel }),
  dates: () => screen.findByRole('table', { name: /^Best dates/ }),
  results: () => screen.findByRole('table', { name: 'Round trips found' }),
  // why: the chart draws its axes after the figure renders; the sweep reads them, so it waits for the drawn surface
  history: async () => {
    const figure = await screen.findByRole('figure', { name: COPY.historyView.fetchChartTitle });
    await drawn(figure);
    return figure;
  },
  definitions: () => screen.findByRole('button', { name: COPY.editSearch.save }),
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
            execution({
              status: 'paused_budget',
              stop: {
                sentence: 'Stopped at its monthly limit.',
                fix: { text: 'Search again', command: null },
              },
            }),
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
      // why: the Edit page needs `edit=` (spec rev 55 §11 URLs); the first screen's sweep covers the new-search form
      const edit = view === 'definitions' ? '&edit=def-0001' : '';
      const { user } = renderWithProviders(<App />, {
        search: `?view=${view}&def=def-0001&${classes}${pair}${edit}`,
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

describe('the main path in the shell says no set-up term (spec rev 55 §3, §11; WP20 Task 20.6)', () => {
  // why: the first screen, a search's page and the Edit page with its More options, each with the status bar and the
  // nav around it, as the shell draws them; provenance notes (inside a PriceCell) keep their source names
  const MAIN = [
    ['searches', ''],
    ['dates', ''],
    ['definitions', '&edit=def-0001'],
  ] as const;
  for (const [view, extra] of MAIN) {
    it(`view=${view}`, async () => {
      const { user } = renderWithProviders(<App />, { search: `?view=${view}&def=def-0001${extra}` });
      await screen.findByRole('navigation', { name: 'Views' });
      await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
      await CONTENT[view]();
      if (view === 'definitions') await user.click(await screen.findByText(PLAN_COPY.moreOptions));
      // the status bar's run is in on a search's view (on Searches it shows a run only when one is going or stopped)
      if (view !== 'searches') await screen.findByRole('region', { name: COPY.statusBarLabel });
      expect(jargonIn(mainPathWords())).toEqual([]);
    });
  }
});

describe('a search\'s page with the return leg read says no banned word, no set-up term, no "£" outside a price (Task 21.7)', () => {
  it('view=dates: a pairing figure, a calendar figure with its pairing beneath, the pairing section', async () => {
    const board: DatesOptions = {
      discoveryProviders: ['travelpayouts', 'camoufox'],
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(
          pairingFig({
            pairing: figurePairing({ pricePence: 119_500, mismatch: true }),
            price: { ...pairingFig().price, pricePence: 119_500 },
          }),
        ),
        [at('2027-03-15', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 130_000, provenance: provCached() },
            pairingRead: 'offers-incomplete',
            pairing: figurePairing({ complete: false }),
          }),
        ),
        [at('2027-03-16', 10)]: pricedPair(
          calendarFig({
            price: { ...calendarFig().price, pricePence: 131_000, provenance: provCached() },
            pairingRead: 'list-failed',
            listReason: 'network',
          }),
        ),
      },
    };
    server.use(
      serveDates(board),
      serveFlightLists(
        (d, r) =>
          flightPair(
            d,
            r,
            d === '2027-03-14'
              ? {
                  list: pairingList({
                    returns: {
                      ...PAIRING_FIXTURE.returns,
                      booking:
                        PAIRING_FIXTURE.returns.booking === null
                          ? null
                          : {
                              ...PAIRING_FIXTURE.returns.booking,
                              moreControl: true,
                              offers: [{ seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 }],
                            },
                    },
                  }),
                }
              : {},
          ),
        { pagesPlanned: 2 },
      ),
    );
    renderWithProviders(<App />, { search: '?view=dates&def=def-0001' });
    await screen.findByRole('table', { name: /^Best dates/ });
    await waitFor(() => expect(document.querySelector('[data-testid="flights-pairing"]')).not.toBeNull());
    expect(findBannedWords(renderedCopy(), BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(poundsOutsidePrices()).toEqual([]);
    expect(jargonIn(mainPathWords())).toEqual([]);
    // why: design 2026-11-08 §4.1: "not every seller read" is the one allowed use of the phrase (a negation)
    expect(renderedCopy().replace(/not every seller read/gi, '')).not.toMatch(
      /each seller|every seller|verified/i,
    );
  });
});
