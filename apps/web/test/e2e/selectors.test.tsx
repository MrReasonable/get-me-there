import { within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { SMOKE } from '../../e2e/selectors.js';
import { COPY } from '../../src/copy.js';
import { CalendarView } from '../../src/views/Calendar/CalendarView.js';
import { API, definition } from '../fixtures.js';
import { calendarResponse, cellAt, day, disc, priceAt, provSyntheticAt } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';

// The Playwright smoke needs WP8's api and a browser, so `pnpm test` cannot run it; this proves its calendar
// selectors match the markup the components render (review arch2-001, ui-r2-002), at both widths it checks.
const synthetic = (d: string) =>
  day(d, {
    cheapestCalendar: priceAt(30000, provSyntheticAt(1), false, cellAt(d, 14)),
    discovery: [disc('fixture', { priced: 48 })],
  });
const serve = () =>
  server.use(
    http.get(`${API}/definitions/:id/calendar`, () =>
      HttpResponse.json(calendarResponse([synthetic('2027-03-14'), synthetic('2027-04-02')])),
    ),
  );
const fixtureDefinition = () =>
  definition({
    providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 24 } },
  });

describe('the Playwright smoke’s calendar selectors match the rendered calendar', () => {
  it('desktop: month tables, one tab stop on a day button, a priced day with the synthetic badge', async () => {
    serve();
    const { findAllByRole } = renderWithProviders(<CalendarView definition={fixtureDefinition()} />);
    const tables = await findAllByRole('table', { name: SMOKE.monthTable });
    expect(tables.map((t) => t.querySelector('caption')?.textContent)).toEqual(['Mar 2027', 'Apr 2027']);
    const stops = document.querySelectorAll(SMOKE.dayTabStop);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.tagName).toBe('BUTTON');
    expect(document.querySelectorAll(SMOKE.dayButton)).toHaveLength(2);
    const priced = document.querySelector(SMOKE.pricedDay);
    expect(priced).toHaveTextContent(COPY.providerShort.fixture);
  });

  it('phone: one month table, the next-month button, a phone face whose PriceCell title names the fixture', async () => {
    setViewportWidth(375);
    serve();
    const { findAllByRole, getByRole } = renderWithProviders(
      <CalendarView definition={fixtureDefinition()} />,
    );
    expect(await findAllByRole('table', { name: SMOKE.monthTable })).toHaveLength(1);
    expect(getByRole('button', { name: SMOKE.nextMonth })).toBeInTheDocument();
    const face = document.querySelector(SMOKE.pricedDayPhone);
    if (!(face instanceof HTMLElement)) throw new Error('no phone face');
    expect(face).toHaveTextContent('£');
    expect(within(face).getByTestId('price-cell').getAttribute('title')).toMatch(
      new RegExp(COPY.provider.fixture),
    );
    expect(document.querySelector(SMOKE.pricedDay)).toBeNull();
  });
});
