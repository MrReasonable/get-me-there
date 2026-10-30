import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SMOKE } from '../../e2e/selectors.js';
import { Nav } from '../../src/components/Nav.js';
import { COPY } from '../../src/copy.js';
import { MARK_ORDER } from '../../src/views/Dates/overview.js';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { workedDates } from '../fixtures.dates.js';
import { API, DETAIL_PAIR, DETAIL_SEARCH, definition, resultsResponse, verifiedRow } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';
import { findBoard, renderDates } from '../views/dates/render.js';

// The Playwright smoke needs WP8's api and a browser, so `pnpm test` cannot run it; this proves its selectors match
// the markup the Dates view, the date pair detail and the nav render (review arch2-001, ui-r2-002; WP19 Task 19.9),
// at both widths it checks.

const one = (selector: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
};

describe('the Playwright smoke’s Dates selectors match the rendered view', () => {
  it('desktop: the board, its row links, the overview’s one tab stop, rings, lighting, legend, readout and the coverage toggle', async () => {
    renderDates({ body: workedDates() });
    const board = await screen.findByRole('table', { name: SMOKE.boardTable });
    expect(board).toBe(await findBoard());
    const rows = board.querySelectorAll(SMOKE.boardRow);
    expect(rows.length).toBe(10);
    expect(within(board).getAllByRole('link', { name: SMOKE.rowLink })).toHaveLength(10);
    expect(within(board).getAllByRole('link')[0]).toHaveAccessibleName('Open 14 Mar 2027 to 24 Mar 2027');

    expect(document.querySelectorAll(SMOKE.overviewTabStop)).toHaveLength(1);
    expect(one(SMOKE.overviewTabStop).tagName).toBe('BUTTON');
    expect(document.querySelectorAll(SMOKE.overviewCell).length).toBeGreaterThan(10);
    expect(document.querySelectorAll(SMOKE.ringedCell)).toHaveLength(10);
    // pointing at the first row lights its ringed cell
    expect(document.querySelector(SMOKE.litCell)).toBeNull();
    fireEvent.pointerEnter(rows[0] ?? board);
    expect(one(SMOKE.litCell)).toHaveAttribute('data-ringed');
    expect(one(SMOKE.litCell).dataset.cell).toBe('2027-03-14|10');
    // an unpriced cell carries its glyphs
    expect(one(`${SMOKE.overviewCell}[data-marks~="empty"] ${SMOKE.cellGlyphs}`)).toHaveTextContent(
      COPY.datesView.marks.glyph.empty,
    );

    expect(one(SMOKE.legend)).toBeVisible();
    const marks = document.querySelectorAll(SMOKE.legendMark);
    expect([...marks].map((m) => m.getAttribute('data-mark'))).toEqual([...MARK_ORDER]);
    for (const m of marks) expect(m.querySelector(SMOKE.legendGlyph)?.textContent).not.toBe('');

    fireEvent.pointerOver(one(SMOKE.overviewTabStop));
    expect(one(SMOKE.readout)).toHaveTextContent('14 Mar 2027');
    expect(screen.getByRole('link', { name: SMOKE.openThese })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SMOKE.coverageToggle })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(document.querySelector(SMOKE.phoneCard)).toBeNull();
  });

  it('phone: stacked cards, one month with Previous and Next month, the legend and the readout', async () => {
    setViewportWidth(375);
    renderDates({ body: workedDates() });
    expect(await screen.findAllByTestId('board-card')).toHaveLength(10);
    expect(document.querySelectorAll(SMOKE.phoneCard)).toHaveLength(10);
    // the cards are the board table's own rows (one semantic table at every width)
    expect(
      screen.getByRole('table', { name: SMOKE.boardTable }).querySelectorAll(SMOKE.phoneCard),
    ).toHaveLength(10);
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

describe('the Playwright smoke’s nav and detail selectors match the rendered markup', () => {
  it('the nav: two tiers labelled by their names, the current entry with its non-colour cue, 44 px links', () => {
    renderWithProviders(<Nav current="dates" />, { search: '?view=dates&def=def-0001' });
    const nav = screen.getByRole('navigation', { name: SMOKE.nav });
    const lists = SMOKE.navTiers.map((name) => within(nav).getByRole('list', { name }));
    expect(lists).toHaveLength(2);
    const current = one(SMOKE.navCurrent);
    expect(current).toHaveTextContent(COPY.nav.dates);
    expect(current.className).toContain('border-b-4');
    for (const link of within(nav).getAllByRole('link')) expect(link.className).toContain('min-h-11');
  });

  it('the detail: its table, headline, back link and per-airport-pair panels', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [verifiedRow()] })),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    expect(await screen.findByRole('table', { name: SMOKE.detailTable })).toBeInTheDocument();
    expect(one(SMOKE.detailHeadline)).toBeInTheDocument();
    expect(one(SMOKE.backToDates)).toHaveAttribute('href', expect.stringContaining('view=dates'));
    expect((await screen.findAllByTestId('airport-pair-panel')).length).toBeGreaterThan(0);
    expect(document.querySelectorAll(SMOKE.airportPairPanel).length).toBeGreaterThan(0);
  });
});
