import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResultsView } from '../../src/views/Results/ResultsView.js';
import { at, priced, pricedPair } from '../fixtures.dates.js';
import { API, DETAIL_PAIR, DETAIL_SEARCH, definition, resultsResponse, verifiedRow } from '../fixtures.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { setViewportWidth } from '../viewport.js';
import { boardRows, findBoard, renderDates } from '../views/dates/render.js';

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

  it('a 2027-03-14 date pair reads 14 Mar on the board, and a 2027-04-01 one reads 1 Apr (April, not March)', async () => {
    renderDates({ body });
    const rows = boardRows(await findBoard());
    expect(rows[0]?.querySelectorAll('td')[1]).toHaveTextContent('14 Mar 2027');
    expect(rows[0]?.querySelectorAll('td')[2]).toHaveTextContent('24 Mar 2027');
    expect(rows[2]?.querySelectorAll('td')[1]).toHaveTextContent('1 Apr 2027');
    expect(rows[2]?.querySelectorAll('td')[2]).toHaveTextContent('13 Apr 2027');
  });

  it('the phone card reads the same dates', async () => {
    setViewportWidth(375);
    renderDates({ body });
    const cards = await screen.findAllByTestId('board-card');
    expect(within(cards[0] ?? document.body).getByRole('link')).toHaveTextContent(
      '14 Mar 2027–24 Mar 2027 (10n)',
    );
    expect(within(cards[2] ?? document.body).getByRole('link')).toHaveTextContent(
      '1 Apr 2027–13 Apr 2027 (12n)',
    );
  });

  it('the overview puts a 2027-03-31 date pair in March’s month and a 2027-04-01 one in April’s, and the readout names 14 Mar', async () => {
    renderDates({ body });
    await findBoard();
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

  it('the date pair detail’s header reads 14 Mar and 28 Mar for a 2027-03-14 → 2027-03-28 date pair (WP19 Task 19.8)', async () => {
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json(resultsResponse({ rows: [verifiedRow()] })),
      ),
    );
    renderWithProviders(<ResultsView definition={definition()} datePair={DETAIL_PAIR} />, {
      search: DETAIL_SEARCH,
    });
    expect(
      await screen.findByRole('heading', { name: '14 Mar 2027 to 28 Mar 2027 · 14 nights' }),
    ).toBeInTheDocument();
  });
});
