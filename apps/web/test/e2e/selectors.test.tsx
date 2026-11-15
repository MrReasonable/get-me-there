import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SMOKE } from '../../e2e/selectors.js';
import { Nav } from '../../src/components/Nav.js';
import { PLAN_COPY } from '../../src/copy/plan.js';
import { COPY } from '../../src/copy.js';
import { MARK_ORDER } from '../../src/views/Dates/overview.js';
import { SearchesView } from '../../src/views/Searches/SearchesView.js';
import { TripView } from '../../src/views/Trip/TripView.js';
import { workedDates } from '../fixtures.dates.js';
import { API, definition } from '../fixtures.js';
import { flightPair, searchCard } from '../fixtures.searches.js';
import { readTrip, tripBody } from '../fixtures.trip.js';
import { serveCards, serveFlightLists } from '../msw/searchesHandlers.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';
import { findTrips, renderDates } from '../views/dates/render.js';
import { renderInShell } from '../views/searches/support.js';

// The Playwright smoke needs WP8's api and a browser, so `pnpm test` cannot run it; this proves its selectors match
// the markup a search's page, the Trip page and the nav render (review arch2-001, ui-r2-002; WP19 Task 19.9),
// at both widths it checks.

const one = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
};

describe('the Playwright smoke’s Search page selectors match the rendered page', () => {
  it("desktop: the sections, their rows and links, the run line, the filter row, the calendar's one tab stop, rings, legend, readout and the coverage toggle", async () => {
    renderDates({ body: workedDates() });
    const trips = await screen.findByRole('region', { name: SMOKE.cheapestTrips });
    const lower = screen.getByRole('region', { name: SMOKE.lowerOnCalendar });
    // the worked example: one current verified trip; the cheaper calendar prices below it
    expect(trips.querySelectorAll(SMOKE.tripRow)).toHaveLength(1);
    expect(within(trips).getAllByRole('link', { name: SMOKE.detailsLink })).toHaveLength(1);
    expect(lower.querySelectorAll(SMOKE.calendarRow)).toHaveLength(3);
    expect(within(lower).getByRole('link', { name: SMOKE.seeAll })).toHaveAttribute('href', SMOKE.calendar);
    expect(one(SMOKE.calendar)).toContainElement(one(SMOKE.overviewTabStop));
    expect(await waitFor(() => one(SMOKE.runLine))).toHaveTextContent(/^Searched /);
    expect(screen.getByRole('group', { name: SMOKE.filterRow })).toBeInTheDocument();

    expect(document.querySelectorAll(SMOKE.overviewTabStop)).toHaveLength(1);
    expect(one(SMOKE.overviewTabStop).tagName).toBe('BUTTON');
    expect(document.querySelectorAll(SMOKE.overviewCell).length).toBeGreaterThan(10);
    // why: design 2026-11-08 §5.2: only the trips Cheapest trips shows are outlined
    expect(document.querySelectorAll(SMOKE.ringedCell)).toHaveLength(1);
    expect(document.querySelector(SMOKE.litCell)).toBeNull();
    fireEvent.pointerOver(one(SMOKE.ringedCell));
    expect(one(SMOKE.litCell)).toHaveAttribute('data-ringed');
    expect(one(SMOKE.litCell).dataset.cell).toBe('2027-03-14|11');
    // an unpriced cell carries its glyphs
    expect(one(`${SMOKE.overviewCell}[data-marks~="no-price-shown"] ${SMOKE.cellGlyphs}`)).toHaveTextContent(
      COPY.datesView.marks.glyph['no-price-shown'],
    );

    expect(one(SMOKE.legend)).toBeVisible();
    const marks = document.querySelectorAll(SMOKE.legendMark);
    expect([...marks].map((m) => m.getAttribute('data-mark'))).toEqual([...MARK_ORDER]);
    for (const m of marks)
      if (m.getAttribute('data-mark') !== 'priced')
        expect(m.querySelector(SMOKE.legendGlyph)?.textContent, m.getAttribute('data-mark') ?? '').not.toBe(
          '',
        );
    expect(marks[0]?.querySelector(SMOKE.legendGlyph)?.className).toContain('lamp-lit');

    fireEvent.pointerOver(one(SMOKE.overviewTabStop));
    expect(one(SMOKE.readout)).toHaveTextContent('14 Mar 2027');
    expect(screen.getByRole('link', { name: SMOKE.openThese })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SMOKE.coverageToggle })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('phone: the same sections and rows, one month with Previous and Next month, the legend and the readout', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    const trips = await screen.findByRole('region', { name: SMOKE.cheapestTrips });
    expect(trips.querySelectorAll(SMOKE.tripRow)).toHaveLength(1);
    expect(document.querySelectorAll(SMOKE.calendarRow)).toHaveLength(3);
    expect(screen.getByRole('button', { name: SMOKE.previousMonth })).toBeDisabled();
    expect(screen.getByRole('button', { name: SMOKE.nextMonth })).toBeEnabled();
    const dates = new Set(
      [...document.querySelectorAll<HTMLElement>(SMOKE.overviewCell)].map((c) => c.dataset.date?.slice(0, 7)),
    );
    expect([...dates]).toEqual(['2027-03']);
    expect(one(SMOKE.legend)).toBeInTheDocument();
    expect(one(SMOKE.readout)).toBeInTheDocument();
    expect(document.querySelectorAll(SMOKE.overviewTabStop)).toHaveLength(1);
  });
});

describe('the Playwright smoke’s nav and Trip page selectors match the rendered markup', () => {
  it('the nav: two links named Trips and Settings, the current entry with its non-colour cue, 44 px links', () => {
    renderWithProviders(<Nav current="trips" />, { search: '?view=dates&def=def-0001' });
    const nav = screen.getByRole('navigation', { name: SMOKE.nav });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([...SMOKE.navItems]);
    const current = one(SMOKE.navCurrent);
    expect(current).toHaveTextContent('Trips');
    expect(current.className).toContain('border-b-4');
    for (const link of within(nav).getAllByRole('link')) expect(link.className).toContain('min-h-11');
  });

  it('the Trip page: its card, its breadcrumb back to the search, a label and both folds', async () => {
    server.use(http.get(`${API}/definitions/:id/trip`, () => HttpResponse.json(tripBody(readTrip()))));
    renderWithProviders(
      <TripView
        definition={definition()}
        state={{
          departureDate: readTrip().departureDate,
          returnDate: readTrip().returnDate,
          from: [],
          to: [],
          journey: null,
        }}
      />,
      { search: '?view=trip&def=def-0001&depart=2026-11-11&return=2026-11-28' },
    );
    expect(await screen.findByRole('region', { name: SMOKE.tripCard })).toBeInTheDocument();
    expect(one(SMOKE.tripPage)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: SMOKE.crumbs })).toBeInTheDocument();
    expect(one(SMOKE.tripBack)).toHaveAttribute('href', expect.stringContaining('view=dates'));
    expect(one(SMOKE.priceLabel).tagName).toBe('SUMMARY');
    expect(one(SMOKE.aboutPrice).tagName).toBe('SUMMARY');
    expect(one(SMOKE.searchLog).tagName).toBe('SUMMARY');
  });
});

describe('the Playwright smoke’s WP20 selectors match the rendered markup (Task 20.11)', () => {
  it('Searches: the new-search panel holds the form with From and its Search button, after the cards with their actions', async () => {
    server.use(serveCards([searchCard()]));
    renderInShell(<SearchesView />);
    const form = await waitFor(() => one(SMOKE.newSearchForm));
    expect(within(form).getByRole('combobox', { name: PLAN_COPY.from })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: SMOKE.searchNow })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(SMOKE.searchCard)).toHaveLength(1));
    // a card's All trips and dates, Search again, Edit and Remove
    expect(document.querySelectorAll(SMOKE.cardAction).length).toBeGreaterThanOrEqual(4);
    // Ruling 13: the cards come first in the DOM and the panel after them, which is what puts it below them on a phone
    expect(one(SMOKE.newSearchPanel).contains(form)).toBe(true);
    expect(
      one(SMOKE.searchCard).compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('a search’s page: the state line is a status named "Search state", reading "Searched"', async () => {
    renderDates({ body: workedDates() });
    await findTrips();
    // why: the status is empty until the search state is read from the latest run, so the smoke waits on its text
    const status = await screen.findByRole('status', { name: SMOKE.stateLine });
    await waitFor(() => expect(status).toHaveTextContent(COPY.searchPage.stateKind.searched));
  });

  it('flights: the unavailable line under Lower on the calendar where lists cannot be read, and no row offers a read', async () => {
    server.use(
      serveFlightLists((dep, ret) => flightPair(dep, ret, { link: null }), {
        available: false,
        unavailableReason: 'not-configured',
      }),
    );
    renderDates({ body: workedDates() });
    const lower = await screen.findByRole('region', { name: SMOKE.lowerOnCalendar });
    expect(await within(lower).findByTestId('flights-unavailable')).toBe(one(SMOKE.flightsUnavailable));
    expect(screen.queryByRole('button', { name: /^Read flights/ })).toBeNull();
  });
});
