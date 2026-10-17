import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { whileRunning } from '../../../src/api/queries.js';
import type { CalendarDay } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { CalendarView } from '../../../src/views/Calendar/CalendarView.js';
import { API, definition, summary } from '../../fixtures.js';
import {
  calendarResponse,
  cellAt,
  day,
  disc,
  priceAt,
  provCalendarAt,
  provItinerary,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';

const route = `${API}/definitions/:id/calendar`;
const jfk = priceAt(41200, provCalendarAt(2), false, cellAt('2027-03-14', 14, 'LHR', 'JFK'));
const ewr = priceAt(39900, provCalendarAt(2), false, cellAt('2027-03-14', 14, 'LHR', 'EWR'));
// The unfiltered day: every destination's 48 cells; the JFK-filtered one the api computes (decision 53): JFK's 24.
const mixedDay = day('2027-03-14', {
  cheapestCalendar: ewr,
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8, reused: 3 })],
});
const jfkDay = day('2027-03-14', {
  cheapestCalendar: jfk,
  discovery: [disc('travelpayouts', { priced: 18, no_data: 6, reused: 1 })],
});
const ewrOnlyDay = day('2027-03-15', {
  cheapestCalendar: priceAt(45000, provCalendarAt(2), false, cellAt('2027-03-15', 14, 'LHR', 'EWR')),
  discovery: [disc('travelpayouts', { priced: 20, not_run: 28 })],
});
const jfkNoPriceDay = day('2027-03-15', { discovery: [disc('travelpayouts', { empty: 4, not_run: 20 })] });
const verifiedDay = (d: string, stale = false) =>
  day(d, {
    cheapestVerified: priceAt(50000, provItinerary(5), stale, cellAt(d, 14)),
    discovery: [disc('searchapi', { priced: 48 })],
  });
const calendarDay = (d: string, stale = false) =>
  day(d, {
    cheapestCalendar: priceAt(40000, provCalendarAt(5), stale, cellAt(d, 14)),
    discovery: [disc('travelpayouts', { priced: 48 })],
  });
/** Serves `days` unfiltered and `filtered[destination]` for a destination query; records each query. */
const serve = (days: CalendarDay[], filtered: Partial<Record<string, CalendarDay[]>> = {}) => {
  const asked: Array<string | null> = [];
  server.use(
    http.get(route, ({ request }) => {
      const d = new URL(request.url).searchParams.get('destination');
      asked.push(d);
      return HttpResponse.json(calendarResponse(d === null ? days : (filtered[d] ?? [])));
    }),
  );
  return asked;
};
const at = (d: string): HTMLElement => {
  const el = document.querySelector(`[data-date="${d}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no day ${d}`);
  return el;
};
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

describe('Calendar view (spec §11 View B; plan decision 38)', () => {
  it('shows an explicit loading state, then the grid', async () => {
    server.use(
      http.get(route, async () => {
        await delay(30);
        return HttpResponse.json(calendarResponse([mixedDay]));
      }),
    );
    const { getByRole, findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(getByRole('status')).toHaveTextContent('Loading…');
    expect(await findByRole('table', { name: 'Mar 2027' })).toBeInTheDocument();
  });

  it('shows an error state naming the failure', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });

  it('a failed all-destination query is shown, not silently judged on no days (review ui I5, prov M5)', async () => {
    server.use(
      http.get(route, ({ request }) =>
        new URL(request.url).searchParams.get('destination') === null
          ? HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })
          : HttpResponse.json(calendarResponse([mixedDay])),
      ),
    );
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />, {
      search: '?cal.dest=JFK',
    });
    expect(await findByRole('alert')).toHaveTextContent('Could not load: boom');
  });

  it('shows the empty state when there are no days', async () => {
    serve([]);
    const { findByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(
      await findByText('No days to show yet. The calendar fills in as cells are searched.'),
    ).toBeInTheDocument();
  });

  it('names the next move when more than half the cells have no cached data (ruling 16, pft-006)', async () => {
    serve([day('2027-03-14', { discovery: [disc('travelpayouts', { priced: 1, no_data: 11 })] })]);
    const { findByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByText(COPY.thinCoverage)).toBeInTheDocument();
  });

  it('says nothing about thin coverage when half or fewer have no cached data', async () => {
    serve([mixedDay]);
    const { findByRole, queryByText } = renderWithProviders(<CalendarView definition={definition()} />);
    await findByRole('table', { name: 'Mar 2027' });
    expect(queryByText(COPY.thinCoverage)).toBeNull();
  });

  it('the header names the run and carries the reused count', async () => {
    serve([mixedDay]);
    const { findByText, getByText } = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await findByText('(3 reused from earlier runs)')).toBeInTheDocument();
    // why: WP9's span header names the runs by start time and says no single run status applies.
    expect(getByText(COPY.spanExecutions(1))).toBeInTheDocument();
    expect(getByText(/14 Oct 2026 13:00 Europe\/London/)).toBeInTheDocument();
  });

  it('says how many shown prices are stale; the header stale flag only when every one is', async () => {
    serve([calendarDay('2027-03-01', true), calendarDay('2027-03-02')]);
    const first = renderWithProviders(<CalendarView definition={definition()} />);
    expect(
      await first.findByText(
        /^1 of 2 shown prices are stale by fetch age plus any known vendor age \(itinerary prices after 8d,/,
      ),
    ).toBeInTheDocument();
    expect(first.queryByText('Every row here is older than one refresh cycle.')).toBeNull();
    first.unmount();
    serve([calendarDay('2027-03-01', true)]);
    const second = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await second.findByText('Every row here is older than one refresh cycle.')).toBeInTheDocument();
  });

  it('the destination filter lives in the URL and is sent to the api, whose filtered days render as they come (decision 53)', async () => {
    const asked = serve([mixedDay, ewrOnlyDay], { JFK: [jfkDay, jfkNoPriceDay] });
    const { findByRole, getByLabelText, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await findByRole('table', { name: 'Mar 2027' });
    expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£399');
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(param('cal.dest')).toBe('JFK');
    await waitFor(() =>
      expect(within(at('2027-03-14')).getByTestId('day-price-block')).toHaveTextContent('£412'),
    );
    expect(asked).toContain('JFK');
    expect(within(at('2027-03-14')).getByTestId('day-stay')).toHaveTextContent('14n · back 28 Mar');
    // why: the api counted JFK's cells, so the cue and the glyphs are JFK's own, never all destinations'.
    expect(within(at('2027-03-14')).getByTestId('coverage-cue')).toHaveTextContent(
      '18 priced, 6 no cached data',
    );
    expect(at('2027-03-15')).toHaveTextContent('∅ 4 no fares');
    expect(at('2027-03-15')).toHaveTextContent('○ 20 not searched');
    expect(document.body).not.toHaveTextContent('all destinations');
    await user.selectOptions(getByLabelText('Destination'), 'all');
    expect(param('cal.dest')).toBeNull();
  });

  it('the default basis is judged on the all-destination calendar, so a filter never flips it (decision 38)', async () => {
    serve([verifiedDay('2027-03-01'), verifiedDay('2027-03-02'), calendarDay('2027-03-03')], {
      JFK: [calendarDay('2027-03-01'), calendarDay('2027-03-02')],
    });
    const { findByRole } = renderWithProviders(<CalendarView definition={definition()} />, {
      search: '?cal.dest=JFK',
    });
    expect(await findByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
  });

  it('defaults to the calendar basis when verified days are not a majority, and to verified when they are', async () => {
    serve([verifiedDay('2027-03-01'), calendarDay('2027-03-02'), calendarDay('2027-03-03')]);
    const first = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await first.findByRole('radio', { name: 'calendar basis' })).toBeChecked();
    first.unmount();
    serve([verifiedDay('2027-03-01'), verifiedDay('2027-03-02'), calendarDay('2027-03-03')]);
    const second = renderWithProviders(<CalendarView definition={definition()} />);
    expect(await second.findByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
  });

  it('the operator’s basis overrides the default, persists in the URL, and survives a filter change', async () => {
    const days = [verifiedDay('2027-03-01'), calendarDay('2027-03-02'), calendarDay('2027-03-03')];
    serve(days, { JFK: days });
    const { findByRole, getByLabelText, getByRole, getByTestId, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await user.click(await findByRole('radio', { name: 'itinerary-search basis' }));
    expect(param('cal.basis')).toBe('verified');
    expect(getByTestId('calendar-legend')).toHaveTextContent(
      'Colour: one shade for itinerary-search basis prices on 1 day',
    );
    await user.selectOptions(getByLabelText('Destination'), 'JFK');
    expect(getByRole('radio', { name: 'itinerary-search basis' })).toBeChecked();
  });

  it('without a verification provider: calendar basis, the other disabled, and the day says itinerary search is not configured', async () => {
    serve([mixedDay]);
    const def = definition({
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    const { findByRole, getByRole, user } = renderWithProviders(<CalendarView definition={def} />);
    expect(await findByRole('radio', { name: 'calendar basis' })).toBeChecked();
    expect(getByRole('radio', { name: 'itinerary-search basis' })).toBeDisabled();
    at('2027-03-14').focus();
    await user.keyboard('{Enter}');
    expect(await findByRole('dialog')).toHaveTextContent(
      'itinerary search: no verification provider configured',
    );
  });

  it('at phone width shows one month at a time, with month navigation in the URL (plan decision 38)', async () => {
    setViewportWidth(375);
    serve([calendarDay('2027-03-30'), calendarDay('2027-04-02')]);
    const { findByRole, getAllByRole, getByRole, user } = renderWithProviders(
      <CalendarView definition={definition()} />,
    );
    await findByRole('table', { name: 'Mar 2027' });
    expect(getAllByRole('table')).toHaveLength(1);
    expect(getByRole('button', { name: 'Previous month' })).toBeDisabled();
    await user.click(getByRole('button', { name: 'Next month' }));
    expect(param('cal.month')).toBe('2027-04');
    expect(getByRole('table', { name: 'Apr 2027' })).toBeInTheDocument();
    expect(getAllByRole('table')).toHaveLength(1);
    // why: ui-r2-006 — the month navigation comes before the legend; ui-r2-001 — each day shows its phone face.
    const nav = getByRole('navigation', { name: 'Month' });
    const legend = getByRole('region', { name: 'Legend' });
    expect(nav.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(at('2027-04-02')).getByTestId('day-price-face')).toHaveTextContent('£400');
    expect(within(at('2027-04-02')).queryByTestId('day-price-block')).toBeNull();
  });

  it('Enter opens the side panel for the day; Escape closes it and focus returns to the day', async () => {
    serve([mixedDay]);
    const { findByRole, queryByRole, user } = renderWithProviders(<CalendarView definition={definition()} />);
    await findByRole('table', { name: 'Mar 2027' });
    // why: focus the day directly; tabbing would first reach the filter controls above the grid.
    at('2027-03-14').focus();
    await user.keyboard('{Enter}');
    expect(await findByRole('dialog', { name: 'Departing Sun 14 Mar 2027' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(at('2027-03-14')).toHaveFocus();
  });

  it('refetches every 2 s while the newest run is pending or running, and stops after (po-wp10-006)', () => {
    expect(whileRunning({ executions: [summary({ status: 'running' })] })).toBe(2_000);
    expect(whileRunning({ executions: [summary({ status: 'pending' })] })).toBe(2_000);
    expect(whileRunning({ executions: [summary({ status: 'completed' })] })).toBe(false);
    expect(whileRunning({ executions: [] })).toBe(false);
    expect(whileRunning(undefined)).toBe(false);
  });
});
