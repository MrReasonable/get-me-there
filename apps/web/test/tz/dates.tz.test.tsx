import { asIata, asIsoDate, asIsoMonth } from '@gmt/core';
import { HttpResponse, http } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatIsoDate, formatIsoDateLong, WEEK_HEADERS } from '../../src/format.js';
import { CalendarGrid } from '../../src/views/Calendar/CalendarGrid.js';
import { buildCalendarModel } from '../../src/views/Calendar/model.js';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { API, calendarRow, DETAIL_PAIR, DETAIL_SEARCH, definition, resultsResponse } from '../fixtures.js';
import { cellAt, gridDay, priceAt, provItinerary } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { NOW, renderWithProviders } from '../render.js';

const ZONES = ['America/Los_Angeles', 'Asia/Tokyo'] as const;
// why: the 2027-01-01 offsets prove the zone is in effect, so these tests cannot pass vacuously in UTC.
const JAN_OFFSET_MINUTES = { 'America/Los_Angeles': 480, 'Asia/Tokyo': -540 } as const;
// why: the control proves the bug is real in each zone: a naive Date moves the day.
const NAIVE_SHIFT = {
  'America/Los_Angeles': { input: '2027-03-14', localDay: 13 },
  'Asia/Tokyo': { input: '2027-03-14T20:00:00.000Z', localDay: 15 },
} as const;
/** The negative control (TS-11): what a Date-based formatter would print. Test code only; src may not do this. */
const naiveDayLong = (iso: string) => {
  const d = new Date(iso);
  return `${WEEK_HEADERS[(d.getDay() + 6) % 7]} ${d.getDate()}`;
};

/** A day's button and its weekday column (Monday = 0). */
function cell(date: string): HTMLButtonElement {
  const el = document.querySelector(`button[data-date="${date}"]`);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`no day ${date}`);
  return el;
}
function column(date: string): number {
  return cell(date).closest('td')?.cellIndex ?? -1;
}

describe.each(ZONES)('dates never shift under TZ=%s (review focus 3)', (zone) => {
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

  it('control: a naive Date would move the day in this zone, and would mislabel the US DST day west of Greenwich', () => {
    expect(new Date(NAIVE_SHIFT[zone].input).getDate()).toBe(NAIVE_SHIFT[zone].localDay);
    if (zone === 'America/Los_Angeles') expect(naiveDayLong('2027-03-14')).toBe('Sat 13');
  });

  it('formatting comes from the string: DST-change days and the leap day keep their date and weekday', () => {
    expect(formatIsoDateLong(asIsoDate('2027-03-14'))).toBe('Sun 14 Mar 2027'); // US DST starts
    expect(formatIsoDateLong(asIsoDate('2027-03-28'))).toBe('Sun 28 Mar 2027'); // UK DST starts
    expect(formatIsoDateLong(asIsoDate('2027-10-31'))).toBe('Sun 31 Oct 2027'); // UK DST ends
    expect(formatIsoDateLong(asIsoDate('2028-02-29'))).toBe('Tue 29 Feb 2028');
    expect(formatIsoDate('2027-03-14')).toBe('14 Mar 2027'); // WP9's Results form, the same module
  });

  it('the calendar grid renders each day under its own date and weekday', () => {
    const days = ['2027-03-13', '2027-03-14', '2027-03-15', '2027-03-28', '2027-04-01'].map((d) =>
      gridDay(d, { cheapestVerified: priceAt(41200, provItinerary(5), false, cellAt(d, 14)) }),
    );
    renderWithProviders(
      <CalendarGrid
        days={days}
        model={buildCalendarModel(days, 'verified', NOW)}
        months={[asIsoMonth('2027-03'), asIsoMonth('2027-04')]}
        destinationNotes={{}}
        compact={false}
        onOpen={() => undefined}
      />,
    );
    expect(column('2027-03-13')).toBe(5);
    expect(column('2027-03-14')).toBe(6);
    expect(column('2027-03-15')).toBe(0);
    expect(cell('2027-03-14').querySelector('[aria-hidden="true"]')?.textContent).toBe('14');
    expect(cell('2027-03-14')).toHaveTextContent('Sun 14 Mar 2027');
    expect(cell('2027-03-28')).toHaveTextContent('Sun 28 Mar 2027');
    expect(cell('2027-04-01').closest('table')).toHaveAccessibleName('Apr 2027');
    expect(column('2027-04-01')).toBe(3);
  });

  it('the Results date columns render departure and return from their strings', async () => {
    const row = calendarRow({
      cell: {
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        nights: 14,
      },
    });
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [row], total: 1 })),
      ),
    );
    const { findAllByText, queryAllByText } = renderWithProviders(
      <ResultsView definition={definition()} datePair={DETAIL_PAIR} />,
      { search: DETAIL_SEARCH },
    );
    expect((await findAllByText(/14 Mar 2027/)).length).toBeGreaterThan(0);
    expect((await findAllByText(/28 Mar 2027/)).length).toBeGreaterThan(0);
    expect(queryAllByText(/\b(13|15) Mar 2027\b|\b(27|29) Mar 2027\b/)).toHaveLength(0);
  });
});
