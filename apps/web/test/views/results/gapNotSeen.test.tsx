import { within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { CalendarGapBanner } from '../../../src/views/Results/CalendarGapBanner.js';
import { API, calendarGap } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// WP10's edit to WP9's calendar-gap banner (plan decision 54): the cheapest verified price the gap is measured
// against says when the latest search no longer returned it.
describe('calendar-gap cheapest verified (decision 54)', () => {
  it('a cheapest verified price not seen in the latest search says so; a current one does not', async () => {
    const base = calendarGap();
    const cv = base.cheapestVerified;
    if (cv === null) throw new Error('fixture has a cheapest verified price');
    server.use(
      http.get(`${API}/definitions/:id/calendar-gap`, () =>
        HttpResponse.json({ ...base, cheapestVerified: { ...cv, notSeenInLatest: { ageHours: 30 } } }),
      ),
    );
    const first = renderWithProviders(<CalendarGapBanner definitionId="def-0001" destinationNotes={{}} />);
    const banner = await first.findByRole('region', { name: 'Cells to search' });
    const [cheapest, cellPrice] = within(banner).getAllByTestId('price-cell');
    expect(cheapest).toHaveTextContent('not seen in latest search (30h ago)');
    expect(cellPrice).not.toHaveTextContent('not seen in latest search');
    first.unmount();
    server.use(http.get(`${API}/definitions/:id/calendar-gap`, () => HttpResponse.json(base)));
    const second = renderWithProviders(<CalendarGapBanner definitionId="def-0001" destinationNotes={{}} />);
    const current = await second.findByRole('region', { name: 'Cells to search' });
    expect(current).not.toHaveTextContent('not seen in latest search');
  });
});
