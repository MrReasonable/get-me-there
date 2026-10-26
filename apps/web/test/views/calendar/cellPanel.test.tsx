import { asIsoDate } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { verifyCellName } from '../../../src/components/VerifyCellButton.js';
import { COPY } from '../../../src/copy.js';
import { CellPanel } from '../../../src/views/Calendar/CellPanel.js';
import { cellsForDay } from '../../../src/views/Calendar/panel.js';
import { API, definition, summary } from '../../fixtures.js';
import {
  cellAt,
  cellDetail,
  disc,
  hoursBefore,
  outcome,
  priceAt,
  provCalendarAt,
  provItinerary,
  slice,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// The Calendar's side panel shell: the day's section, the cell picker, the dialog's focus and Escape (spec §11 View B).
// Its outcome, price and verify sections moved to the date pair detail's per-airport-pair panel with their tests
// (test/views/results/panel.test.tsx, WP19 Task 19.6); this file keeps the Calendar-only parts until Task 19.8 removes
// the Calendar view.

const c = cellAt('2027-03-14', 14);
const date = asIsoDate('2027-03-14');
const executions = [summary()];
const detail = cellDetail(c, {
  outcomes: [outcome(c, 'discovery', 'travelpayouts', 'priced', { fetchedAt: hoursBefore(2) })],
});
const cellRoute = `${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;
const daySlice = slice({
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
  verification: { selected: 10, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 0 },
  cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
});

function renderPanel(s = daySlice, inline = false) {
  const onClose = vi.fn();
  const r = renderWithProviders(
    <CellPanel
      definition={definition()}
      date={date}
      slice={s}
      executions={executions}
      initialCell={c}
      inline={inline}
      onClose={onClose}
    />,
  );
  return { onClose, ...r };
}

describe('View B side panel shell (spec §11, plan decision 38)', () => {
  it('shows the day’s six-bucket marker and its prices with full provenance', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const day = await findByRole('region', { name: 'This day' });
    expect(within(day).getByTestId('day-marker')).toHaveTextContent(
      '40 priced · 0 no fares · 8 no cached data',
    );
    expect(day).toHaveTextContent('cheapest calendar price');
    expect(day).toHaveTextContent('14 nights · back Sun 28 Mar');
    expect(within(day).getByTestId('provenance')).toHaveTextContent('Aviasales cache');
    expect(within(day).getByTestId('provenance')).toHaveTextContent('constraints not checked');
  });

  it('a day whose itinerary search priced nothing the final step confirmed says so in its marker (decision 48)', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const day = slice({
      discovery: [disc('travelpayouts', { priced: 48 })],
      verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
      unconfirmedCells: 1,
    });
    const { findByRole } = renderPanel(day);
    expect(
      within(await findByRole('region', { name: 'This day' })).getByTestId('day-marker'),
    ).toHaveTextContent(
      'price not confirmed: 1 itinerary-searched cell priced nothing the final step confirmed',
    );
  });

  it('the verify status goes away when another cell is picked', async () => {
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post(`${API}/cells/verify`, () => HttpResponse.json({ executionId: 'child-1' })),
    );
    const { findByText, getByRole, queryByText, user } = renderPanel();
    await findByText('hard stop 6 calls · 1840 calls of budget headroom left');
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) }));
    expect(await findByText(COPY.verifyStartedFor(verifyCellName(c)))).toBeInTheDocument();
    const options = cellsForDay(definition(), date);
    const otherIndex = options.findIndex((o) => verifyCellName(o) !== verifyCellName(c));
    const other = options[otherIndex];
    if (other === undefined) throw new Error('another cell');
    await user.selectOptions(getByRole('combobox'), String(otherIndex));
    // why: no search was submitted for the picked cell, so no status may say one started for it
    expect(queryByText(COPY.verifyStartedFor(verifyCellName(other)))).toBeNull();
    expect(queryByText(COPY.verifyStartedFor(verifyCellName(c)))).toBeNull();
  });

  it('at phone width the panel is a section of the page, not an overlay dialog (ui-r2-010)', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole, queryByRole, getByTestId } = renderPanel(daySlice, true);
    await findByRole('table');
    expect(queryByRole('dialog')).toBeNull();
    expect(getByTestId('cell-panel').tagName).toBe('SECTION');
    expect(getByTestId('cell-panel')).not.toHaveClass('fixed');
  });

  it('the cell picker lists origins × destinations × nights for the day and fetches the chosen cell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(cellRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(detail);
      }),
    );
    expect(cellsForDay(definition(), date)).toHaveLength(2 * 2 * 12);
    const { findByLabelText, getByRole, user } = renderPanel();
    const picker = await findByLabelText('Cell');
    const target = cellsForDay(definition(), date).findIndex(
      (k) => k.origin === 'LGW' && k.destination === 'EWR' && k.returnDate === '2027-04-04',
    );
    await user.selectOptions(picker, String(target));
    await waitFor(() =>
      expect(paths.at(-1)).toMatch(/\/api\/definitions\/def-0001\/cells\/LGW\/EWR\/2027-03-14\/2027-04-04$/),
    );
    expect(getByRole('option', { name: 'LGW→EWR · 21 nights · back Sun 4 Apr' })).toBeInTheDocument();
  });

  it('focuses its heading on open and closes on Escape', async () => {
    const { getByRole, onClose, user } = renderPanel(
      slice({ cheapestVerified: priceAt(52000, provItinerary(5), false, c) }),
    );
    expect(getByRole('heading', { name: 'Departing Sun 14 Mar 2027' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
