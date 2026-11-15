import { asIsoDate } from '@gmt/core';
import { fireEvent, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TripView } from '../../src/views/Trip/TripView.js';
import { at, priced, pricedPair } from '../fixtures.dates.js';
import { API, definition } from '../fixtures.js';
import { tripBody } from '../fixtures.trip.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';
import { calendarRows, findCalendar, findLower, renderDates, rowText } from '../views/dates/render.js';

// Review focus 3 for the Dates view (WP19 Tasks 19.4, 19.5): run by `test:tz` under America/Los_Angeles and
// Asia/Tokyo. Every date the view shows is formatted from its `YYYY-MM-DD` string, so a browser west or east of
// Greenwich never moves a date pair to the day before or after.

const ZONES = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
// why: the 2027-01-01 offsets prove the zone is in effect, so these tests cannot pass vacuously in UTC
const JAN_OFFSET_MINUTES = { 'America/Los_Angeles': 480, 'Asia/Tokyo': -540 } as const;

const body = {
  pairs: {
    [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
    [at('2027-03-31', 11)]: pricedPair(priced(30_500)),
    [at('2027-04-01', 12)]: pricedPair(priced(31_000)),
  },
};
const cellAt = (date: string, from: number) =>
  document.querySelector<HTMLElement>(`[data-testid="dates-overview"] [data-cell="${date}|${from}"]`);

describe.each(ZONES)('the Dates view’s dates never shift under TZ=%s', (zone) => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });

  it('the zone is in effect', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
    expect(new Date(2027, 0, 1).getTimezoneOffset()).toBe(JAN_OFFSET_MINUTES[zone]);
  });

  it('a 2027-03-14 date reads Sun 14 Mar in its row, and a 2027-04-01 one Thu 1 Apr (April, not March)', async () => {
    renderDates({ body });
    const rows = calendarRows(await findLower());
    expect(rowText(rows[0] ?? document.body)).toContain('Sun 14 Mar → Wed 24 Mar');
    expect(rowText(rows[2] ?? document.body)).toContain('Thu 1 Apr → Tue 13 Apr');
  });

  it('the same dates at phone width', async () => {
    setViewportWidth(375);
    renderDates({ body });
    const rows = calendarRows(await findLower());
    expect(rowText(rows[0] ?? document.body)).toContain('Sun 14 Mar → Wed 24 Mar');
    expect(rowText(rows[2] ?? document.body)).toContain('Thu 1 Apr → Tue 13 Apr');
  });

  it('the overview puts a 2027-03-31 date pair in March’s month and a 2027-04-01 one in April’s, and the readout names 14 Mar', async () => {
    renderDates({ body });
    await findCalendar();
    expect(cellAt('2027-03-31', 11)?.closest('table')?.querySelector('caption')).toHaveTextContent(
      'Mar 2027',
    );
    expect(cellAt('2027-04-01', 12)?.closest('table')?.querySelector('caption')).toHaveTextContent(
      'Apr 2027',
    );
    // the day number in its own column: 31 Mar 2027 is a Wednesday, 1 Apr a Thursday (Monday first)
    expect(cellAt('2027-03-31', 11)?.closest('td')?.cellIndex).toBe(2);
    expect(cellAt('2027-04-01', 12)?.closest('td')?.cellIndex).toBe(3);
    const c = cellAt('2027-03-14', 10);
    if (c === null) throw new Error('no cell');
    fireEvent.pointerOver(c);
    expect(screen.getByTestId('dates-readout')).toHaveTextContent('14 Mar 2027–24 Mar 2027 (10n)');
  });

  it('the Trip page’s heading reads Sun 14 Mar and Sun 28 Mar for a 2027-03-14 → 2027-03-28 trip (trip-page plan Task 7)', async () => {
    const departureDate = asIsoDate('2027-03-14');
    const returnDate = asIsoDate('2027-03-28');
    server.use(
      http.get(`${API}/definitions/:id/trip`, () =>
        HttpResponse.json(tripBody({ departureDate, returnDate, nights: 14, searchLink: null })),
      ),
    );
    renderWithProviders(
      <TripView
        definition={definition()}
        state={{ departureDate, returnDate, from: [], to: [], journey: null }}
      />,
      { search: '?view=trip&def=def-0001&depart=2027-03-14&return=2027-03-28' },
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sun 14 Mar → Sun 28 Mar · 14 nights' }),
    ).toBeInTheDocument();
  });
});
