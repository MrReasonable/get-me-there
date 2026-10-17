import {
  asIata,
  asIsoDate,
  bandCheapest,
  effectiveAge,
  filterRows,
  formatAgeFull,
  formatFetchedAgo,
  type ResultFilters,
  resultRowKey,
  type SortKey,
  sortRows,
} from '@gmt/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { ResultRow } from '../../../src/api/types.js';
import { formatIsoDate } from '../../../src/format.js';
import { parseResultsState, SORT_KEYS } from '../../../src/state/resultsState.js';
import { ResultsView } from '../../../src/views/Results/ResultsView.js';
import {
  API,
  calendarRow,
  cell,
  definition,
  failedRow,
  fxConverted,
  partialRow,
  provCalendar,
  provSearch,
  provSynthetic,
  resultsResponse,
  summary,
  verifiedRow,
} from '../../fixtures.js';
import { expectConsoleErrors } from '../../guards.js';
import { server } from '../../msw/server.js';
import { NOW, renderWithProviders, settled } from '../../render.js';
import { setViewportWidth } from '../../viewport.js';

/** Counts GET /results so tests can prove sorting and filtering never refetch (spec §6.5). */
function countResults(body = resultsResponse()) {
  const hits = { n: 0 };
  server.use(
    http.get(`${API}/definitions/:id/results`, () => {
      hits.n += 1;
      return HttpResponse.json(body);
    }),
  );
  return hits;
}

const view = (search = '?view=results&def=def-0001', def = definition()) =>
  renderWithProviders(<ResultsView definition={def} />, { search });
const table = () => screen.findByRole('table', { name: 'Round trips found' });
const headers = () =>
  screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[↑↓]/g, '').trim());
const dataRows = () =>
  within(screen.getByRole('table', { name: 'Round trips found' }))
    .getAllByRole('row')
    .filter((r) => r.querySelector('[aria-expanded]') !== null);
const rowNames = () =>
  dataRows().map((r) =>
    r
      .querySelector('[aria-expanded]')
      ?.getAttribute('aria-label')
      ?.replace(/^(Show|Hide) details for /, ''),
  );
const nameOf = (r: ResultRow) =>
  `${r.cell.destination} ${formatIsoDate(r.cell.departureDate)} to ${formatIsoDate(r.cell.returnDate)}`;
const url = () => new URLSearchParams(window.location.search);

/** Five rows with distinct keys for every sort column. */
const five: ResultRow[] = [
  verifiedRow(),
  partialRow(),
  verifiedRow({
    itineraryHash: 'h3',
    pricePence: 50000,
    totalMinutes: 600,
    stopsOut: 0,
    stopsIn: 0,
    cell: cell('LHR', 'EWR', '2027-03-20', '2027-04-05', 16),
    adjustedPence: 52000,
  }),
  verifiedRow({
    itineraryHash: 'h4',
    pricePence: 45000,
    totalMinutes: 1500,
    stopsOut: 2,
    stopsIn: 1,
    cell: cell('LGW', 'JFK', '2027-03-10', '2027-03-21', 11),
    stale: true,
  }),
  calendarRow({ pricePence: 30000 }),
];

describe('phone layout at 375px (jsdom has no layout, so the structure is asserted)', () => {
  it('the table sits in its own scroll region, every control is a 44px target, and tablets get the stacked layout', async () => {
    setViewportWidth(375);
    countResults(resultsResponse({ rows: five }));
    view();
    const t = await table();
    expect(t.closest('section')).toHaveClass('overflow-x-auto');
    for (const b of screen.getAllByRole('button', { name: /^Show details/ }))
      expect(b).toHaveClass('min-h-11');
    for (const b of screen.getAllByRole('button', { name: /^Sort by/ })) expect(b).toHaveClass('min-h-11');
    expect(screen.queryByRole('columnheader', { name: /Carriers/ })).toBeNull();
  });

  it('a 768px tablet is still too narrow for twelve columns, so it gets the stacked layout too', async () => {
    setViewportWidth(768);
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    expect(screen.queryByRole('columnheader', { name: /Carriers/ })).toBeNull();
  });
});

describe('View A columns (spec §11)', () => {
  it('wide: every column in the spec order; adjusted appears only when configured, through PriceCell', async () => {
    countResults();
    const { unmount } = view();
    await table();
    expect(headers()).toEqual([
      'Details',
      'Price',
      'Travel time',
      'Departure',
      'Return',
      'Nights',
      'Destination',
      'Carriers',
      'Stops',
      'Class',
      'Fetched',
      'Provider',
    ]);
    unmount();
    countResults(resultsResponse({ rows: [verifiedRow({ adjustedPence: 45000 })] }));
    view();
    await table();
    expect(headers().at(-1)).toBe('Adjusted (operator-entered onward cost)');
    const adjusted = screen
      .getByText('incl. operator-entered onward cost')
      .closest('[data-testid="price-cell"]');
    expect(adjusted).toHaveTextContent('£450');
  });

  it('wide: the price line shows source and age only, since Provider and Destination are columns (ruling on UI-14)', async () => {
    countResults();
    view();
    await table();
    const first = dataRows()[0];
    if (first === undefined) throw new Error('no rows');
    const line = within(first).getByTestId('provenance');
    expect(within(line).getByText('Google Flights via SearchApi')).toBeInTheDocument();
    expect(within(line).queryByText('SearchApi')).toBeNull();
    expect(within(line).queryByText('JFK')).toBeNull();
  });

  it('375px: price, full provenance and the class badge stay in the primary row; sort is a select; filters fold away', async () => {
    setViewportWidth(375);
    countResults();
    const { user } = view();
    await table();
    // why: jsdom loads no CSS, so this asserts the columns the component chose, not Tailwind's layout.
    expect(headers()).toEqual(['Details', 'Price', 'Class', 'Departure', 'Return', 'Stops']);
    const first = dataRows()[0];
    if (first === undefined) throw new Error('no rows');
    expect(within(first).getByText('£412')).toBeInTheDocument();
    expect(within(within(first).getByTestId('provenance')).getByText('SearchApi')).toBeInTheDocument();
    expect(within(first).getByTestId('class-badge')).toHaveTextContent('verified');
    expect(screen.getByRole('combobox', { name: 'Sort rows by' })).toBeInTheDocument();
    expect(screen.getByText('Filters (0 active)').closest('details')).not.toHaveAttribute('open');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort rows by' }), 'totalTime.asc');
    expect(url().get('sort')).toBe('totalTime.asc');
    await user.click(within(first).getByRole('button', { name: /Show details/ }));
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
  });
});

describe('View A header (spec §11 two lines)', () => {
  it('line 1: the headline price through PriceCell with provider, source and the full age; line 2 links to Coverage', async () => {
    countResults();
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent('£412');
    expect(within(headline).getByText('SearchApi')).toBeInTheDocument();
    expect(
      within(headline).getByText(formatAgeFull(effectiveAge(verifiedRow().provenance, NOW))),
    ).toBeInTheDocument();
    expect(
      within(headline).getByText('JFK 14 Mar 2027–28 Mar 2027 (14n) · itinerary-search basis · verified'),
    ).toBeInTheDocument();
    const line2 = screen.getByRole('link', {
      name: 'discovery: 60 priced · 10 no fares · 40 no cached data · 6 error · 0 skipped · 10 not searched of 126 (0 reused) · itinerary-searched 8 of 10 selected (2 outbounds each) +1 on demand',
    });
    expect(line2).toHaveAttribute('href', '/?view=coverage&def=def-0001');
  });

  it('a converted, stale, truncated calendar headline carries "≈", "stale" and "cheapest of the rows read" (the Critical)', async () => {
    const row = calendarRow({
      stale: true,
      truncated: true,
      provenance: { ...provCalendar, fx: fxConverted },
    });
    countResults(resultsResponse({ basis: 'calendar', rows: [row] }));
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    if (headline === null) throw new Error('no headline');
    expect(headline).toHaveTextContent(/≈.*£399/);
    expect(within(headline).getByText('stale')).toBeInTheDocument();
    expect(within(headline).getByText('cheapest of the rows read')).toBeInTheDocument();
    expect(within(headline).getByText(formatAgeFull(effectiveAge(row.provenance, NOW)))).toBeInTheDocument();
  });

  it('the headline follows the filters; when they leave nothing it is labelled "overall, filters not applied" (decision 36)', async () => {
    countResults();
    const { unmount } = view('?view=results&f.class=partially-verified');
    await table();
    const headline = () => screen.getByText('cheapest found').parentElement;
    expect(headline()).toHaveTextContent('£388');
    expect(screen.queryByText('overall, filters not applied')).toBeNull();
    unmount();
    view('?view=results&f.maxPrice=100');
    await screen.findByText('No rows match these filters.');
    expect(headline()).toHaveTextContent('£412');
    expect(screen.getByText('overall, filters not applied')).toBeInTheDocument();
  });

  it('"(E outbounds each)" is the shown run own policy, even after the definition changed (decision 42)', async () => {
    countResults(resultsResponse({ executions: [summary({ expandTop: 3 })] }));
    view('?view=results', definition({ updatedAt: '2026-10-14T12:30:00.000Z' }));
    await table();
    expect(
      screen.getByRole('link', {
        name: /itinerary-searched 8 of 10 selected \(3 outbounds each\) \+1 on demand$/,
      }),
    ).toBeInTheDocument();
  });

  it('says "within the cheapest N of M" when truncated, and reports rows outside the current space', async () => {
    countResults(resultsResponse({ truncated: true, excludedByCurrentSpace: 3, total: 4210 }));
    view();
    expect(await screen.findByText('within the cheapest 2 of 4210')).toBeInTheDocument();
    expect(
      screen.getByText('3 rows outside the current window and nights range are not shown'),
    ).toBeInTheDocument();
  });

  it('a non-price sort over a truncated page says it sorts within the cheapest rows (review PFT-04)', async () => {
    countResults(resultsResponse({ truncated: true, total: 4210 }));
    view('?view=results&sort=totalTime.asc');
    expect(
      await screen.findByText('sorted by Travel time within the cheapest 2 of 4210'),
    ).toBeInTheDocument();
    expect(screen.getByText('Order: Travel time, ascending')).toBeInTheDocument();
  });
});

describe('client-side sort and filter (spec §6.5)', () => {
  it.each(
    SORT_KEYS.flatMap((key) =>
      (['asc', 'desc'] as const).map((dir): [SortKey, 'asc' | 'desc'] => [key, dir]),
    ),
  )('sort=%s.%s matches core sortRows over filterRows, without a refetch', async (key, dir) => {
    const hits = countResults(resultsResponse({ rows: five }));
    const { client } = view(`?view=results&sort=${key}.${dir}`);
    await table();
    expect(rowNames()).toEqual(sortRows(filterRows(five, {}), key, dir).map(nameOf));
    await settled(client);
    expect(hits.n).toBe(1);
  });

  it('no sort keeps the server ranking, says so, and stale rows keep their place, labelled', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    expect(screen.getByText('Order: server ranking (class, then price)')).toBeInTheDocument();
    expect(rowNames()).toEqual(filterRows(five, {}).map(nameOf));
    const staleRow = dataRows()[3];
    expect(staleRow && within(staleRow).getByText('stale')).toBeInTheDocument();
  });

  it('a superseded calendar row is marked in words and keeps the position the server gave it, after current rows (decision 57; controller-directed)', async () => {
    const current = calendarRow({ pricePence: 39900 });
    const superseded = calendarRow({
      pricePence: 30000,
      superseded: true,
      calendarPriceId: 8,
      cell: cell('LGW', 'JFK', '2027-05-01', '2027-05-15', 14),
    });
    countResults(resultsResponse({ rows: [current, superseded], basis: 'calendar' }));
    view('?view=results&def=def-0001&basis=calendar');
    await table();
    const rows = dataRows();
    expect(rows).toHaveLength(2);
    const [first, second] = rows;
    expect(first && within(first).queryByText('superseded by a later search')).toBeNull();
    expect(second && within(second).getByText('superseded by a later search')).toBeInTheDocument();
  });

  it('marks exactly the rows core bandCheapest marks', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    const marked = bandCheapest(filterRows(five, {}), 6);
    const labelled = dataRows().filter(
      (r) => within(r).queryByText('cheapest in its 6h travel-time band') !== null,
    );
    expect(labelled.map((r) => r.id)).toEqual(
      filterRows(five, {})
        .filter((r) => marked.has(resultRowKey(r)))
        .map((r) => `row-${resultRowKey(r)}`),
    );
    expect(labelled.length).toBeGreaterThan(0);
  });

  it('sorting and filtering compose without refetching, and live in the URL', async () => {
    const hits = countResults();
    const { user, client } = view();
    await table();
    await user.click(screen.getByRole('button', { name: 'Sort by Price, ascending' }));
    expect(rowNames()[0]).toBe(nameOf(partialRow()));
    expect(url().get('sort')).toBe('price.asc');
    await user.click(screen.getByRole('checkbox', { name: 'partially verified' }));
    expect(dataRows()).toHaveLength(1);
    expect(url().get('f.class')).toBe('verified,unchecked');
    expect(screen.getByText('showing 1 of 2 rows (filters active)')).toBeInTheDocument();
    await settled(client);
    expect(hits.n).toBe(1);
  });

  it('failed rows are hidden by default, counted, and one click shows them (spec §6.9)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), partialRow(), failedRow()] }));
    const { user } = view();
    await table();
    expect(dataRows()).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'verified' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'failed' })).not.toBeChecked();
    expect(screen.getByText('1 failed row hidden by default')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show failed rows' }));
    expect(dataRows()).toHaveLength(3);
    expect(url().get('f.class')).toBe('verified,partially-verified,failed,unchecked');
  });

  it.each<[string, string, (u: ReturnType<typeof view>['user']) => Promise<void>, ResultFilters]>([
    [
      'provider',
      'f.provider',
      (u) => u.click(screen.getByRole('checkbox', { name: 'Travelpayouts' })),
      { providerId: ['travelpayouts'] },
    ],
    [
      'destination',
      'f.dest',
      (u) => u.click(screen.getByRole('checkbox', { name: 'EWR' })),
      { destination: [asIata('EWR')] },
    ],
    [
      'max stops',
      'f.stops',
      (u) => u.selectOptions(screen.getByLabelText('Max stops'), '0'),
      { maxStops: 0 },
    ],
    [
      'max price (Enter applies)',
      'f.maxPrice',
      (u) => u.type(screen.getByLabelText('Max price (£)'), '400{Enter}'),
      { maxPricePence: 40000 },
    ],
    [
      'nights (a blank end takes the data range)',
      'f.nights',
      (u) => u.type(screen.getByLabelText('Min nights'), '14{Enter}'),
      { nights: { min: 14, max: 16 } },
    ],
    [
      'hide stale',
      'f.stale',
      (u) => u.click(screen.getByRole('checkbox', { name: 'Hide stale rows' })),
      { hideStale: true },
    ],
    [
      'unverified constraint',
      'f.unverified',
      (u) => u.selectOptions(screen.getByLabelText('Has this constraint unverified'), 'checkedBagRequired'),
      { unverified: ['checkedBagRequired'] },
    ],
  ])(
    'the %s filter applies through the URL, as core filterRows would',
    async (_label, param, act, filters) => {
      const hits = countResults(resultsResponse({ rows: five }));
      const { user, client } = view();
      await table();
      await act(user);
      expect(url().get(param)).not.toBeNull();
      expect(parseResultsState(url()).filters).toEqual(filters);
      expect(rowNames()).toEqual(filterRows(five, filters).map(nameOf));
      await settled(client);
      expect(hits.n).toBe(1);
    },
  );

  it('the departure-date range filter keeps departures inside it (decision 36)', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    // why: a date input commits a whole date; setting one end fills the other from the data's own range.
    fireEvent.change(screen.getByLabelText('Departs on or after'), { target: { value: '2027-03-14' } });
    expect(url().get('f.depart')).toBe('2027-03-14..2027-04-02');
    fireEvent.change(screen.getByLabelText('Departs on or before'), { target: { value: '2027-03-20' } });
    expect(url().get('f.depart')).toBe('2027-03-14..2027-03-20');
    expect(rowNames()).toEqual(
      filterRows(five, { departure: { from: asIsoDate('2027-03-14'), to: asIsoDate('2027-03-20') } }).map(
        nameOf,
      ),
    );
    expect(rowNames()).toHaveLength(3);
  });

  it('clearing one departure date keeps the other end, open-ended on the cleared side (UI-9)', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    fireEvent.change(screen.getByLabelText('Departs on or after'), { target: { value: '2027-03-14' } });
    fireEvent.change(screen.getByLabelText('Departs on or before'), { target: { value: '2027-03-20' } });
    fireEvent.change(screen.getByLabelText('Departs on or after'), { target: { value: '' } });
    expect(url().get('f.depart')).toBe('2027-03-10..2027-03-20');
    fireEvent.change(screen.getByLabelText('Departs on or before'), { target: { value: '' } });
    expect(url().get('f.depart')).toBe('2027-03-10..2027-04-02');
  });

  it('a max price or nights box that does not parse is flagged instead of silently ignored (UI-8)', async () => {
    countResults(resultsResponse({ rows: five }));
    const { user } = view();
    await table();
    await user.type(screen.getByLabelText('Max price (£)'), 'abc');
    expect(screen.getByLabelText('Max price (£)')).toBeInvalid();
    expect(screen.getByText('not an amount in pounds (for example 450 or 450.50)')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Min nights'), '1x');
    expect(screen.getByLabelText('Min nights')).toBeInvalid();
    expect(screen.getByText('not a whole number')).toBeInTheDocument();
  });

  it('carriers: codes apply on leaving the box; entries that are not codes are shown as ignored (review PFT-12)', async () => {
    countResults(resultsResponse({ rows: five }));
    const { user } = view();
    await table();
    await user.type(screen.getByLabelText('Carriers (comma-separated codes)'), 'zz, British');
    await user.tab();
    expect(url().get('f.carriers')).toBe('ZZ');
    expect(screen.getByText('ignored, not two-character carrier codes: BRITISH')).toBeInTheDocument();
  });

  it('hide stale states how many rows it hid; Clear filters resets every box', async () => {
    countResults(resultsResponse({ rows: five }));
    const { user } = view('?view=results&f.stale=hide&f.maxPrice=48000');
    await table();
    expect(screen.getByText('1 stale row hidden')).toBeInTheDocument();
    expect(screen.getByLabelText('Max price (£)')).toHaveValue('480');
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(url().get('f.stale')).toBeNull();
    expect(screen.getByLabelText('Max price (£)')).toHaveValue('');
  });

  it('filters survive a remount because they are in the URL', async () => {
    countResults();
    const first = view('?view=results&f.class=partially-verified');
    await table();
    expect(dataRows()).toHaveLength(1);
    const search = window.location.search;
    first.unmount();
    view(search);
    await table();
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'partially verified' })).toBeChecked();
  });

  it('stops and carriers filters are disabled on the calendar basis', async () => {
    countResults(resultsResponse({ basis: 'calendar', rows: [calendarRow()] }));
    view();
    expect(await screen.findByLabelText('Max stops')).toBeDisabled();
    expect(screen.getByLabelText('Carriers (comma-separated codes)')).toBeDisabled();
    expect(screen.getByText('Stops and carriers are not known on the calendar basis.')).toBeInTheDocument();
  });
});

describe('empty, loading and error states (reviews UI-5, tsr-011, tsr-002)', () => {
  it('no rows from the run points to Coverage; rows filtered to nothing say so and offer Clear', async () => {
    countResults(resultsResponse({ rows: [], cheapest: null }));
    const { unmount } = view();
    expect(await screen.findByRole('link', { name: /This run has no rows on this basis/ })).toHaveAttribute(
      'href',
      '/?view=coverage&def=def-0001',
    );
    expect(screen.queryByText('No rows match these filters.')).toBeNull();
    unmount();
    countResults();
    const { user } = view('?view=results&f.maxPrice=100');
    expect(await screen.findByText('No rows match these filters.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' }).at(-1) ?? document.body);
    expect(await table()).toBeInTheDocument();
  });

  it('loading is announced, then the table renders', async () => {
    countResults();
    view();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(await table()).toBeInTheDocument();
  });

  it('a failed load shows the reason and a retry, never stale numbers', async () => {
    let fail = true;
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        fail
          ? HttpResponse.json({ error: { code: 'internal', message: 'database is locked' } }, { status: 500 })
          : HttpResponse.json(resultsResponse()),
      ),
    );
    const { user } = view();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load: database is locked');
    expect(screen.queryByText(/£/)).toBeNull();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await table()).toBeInTheDocument();
  });

  it('a row without provenance fails the whole response (parsed in every mode): an alert and no price (spec §9 item 6)', async () => {
    const { provenance: _drop, ...bare } = calendarRow();
    server.use(
      http.get(`${API}/definitions/:id/results`, () =>
        HttpResponse.json({ ...resultsResponse(), rows: [verifiedRow(), bare] }),
      ),
    );
    view();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /does not match core\/api-contract: rows\.1\.provenance/,
    );
    expect(screen.queryByText(/£/)).toBeNull();
  });

  it('a schema-valid row whose provenance pairs the fixture provider with a non-synthetic source withholds only its own price', async () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const odd = verifiedRow({
      itineraryHash: 'odd',
      pricePence: 45600,
      provenance: { ...provSearch, providerId: 'fixture' },
    });
    countResults(resultsResponse({ rows: [verifiedRow(), odd] }));
    view();
    await table();
    const withheld = dataRows()[1];
    if (withheld === undefined) throw new Error('no second row');
    expect(within(withheld).getByRole('alert')).toHaveTextContent(
      'price withheld: provenance missing or invalid',
    );
    expect(within(withheld).queryByText(/£/)).toBeNull();
    expect(within(dataRows()[0] ?? document.body).getByText('£412')).toBeInTheDocument();
  });

  it('such a row is withheld whole (no carriers, stops, class, provider) and raises the red synthetic banner (ruling 3)', async () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    const odd = verifiedRow({
      itineraryHash: 'odd',
      carriers: ['ZZ'],
      provenance: { ...provSearch, providerId: 'fixture' },
    });
    countResults(resultsResponse({ rows: [verifiedRow(), odd] }));
    view();
    await table();
    const withheld = dataRows()[1];
    if (withheld === undefined) throw new Error('no second row');
    expect(within(withheld).queryByText('ZZ')).toBeNull();
    expect(within(withheld).queryByText('Fixture')).toBeNull();
    expect(within(withheld).getAllByText('withheld').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('every Fetched cell is core formatFetchedAgo of its row (review tsr2-007)', async () => {
    countResults(resultsResponse({ rows: five }));
    view();
    await table();
    const fetchedColumn = headers().indexOf('Fetched');
    const cells = dataRows().map((r) => r.querySelectorAll('td')[fetchedColumn]?.textContent);
    expect(cells).toEqual(filterRows(five, {}).map((r) => formatFetchedAgo(effectiveAge(r.provenance, NOW))));
    expect(cells[0]).toBe('fetched 5h ago');
  });

  it('a page of itinerary rows of unknown vendor age is labelled, not called stale (decision 44)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), partialRow()] }));
    view();
    await table();
    expect(screen.getAllByText("vendor's cache age unknown")).toHaveLength(3);
    expect(screen.queryByText('Every row here is older than one refresh cycle.')).toBeNull();
  });

  it('an unconfirmed price says so in the table row and the headline, as the first mark (decision 44)', async () => {
    const unconfirmed = partialRow({
      verdicts: { cabin: 'pass', priceConfirmed: 'unverified' },
      unverified: ['priceConfirmed'],
    });
    countResults(resultsResponse({ rows: [unconfirmed], cheapest: unconfirmed }));
    view();
    await table();
    const headline = screen.getByText('cheapest found').parentElement;
    expect(
      within(headline ?? document.body).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
    expect(
      within(dataRows()[0] ?? document.body).getByText('price not confirmed by the final step'),
    ).toBeInTheDocument();
  });

  it('negative: real rows raise no synthetic banner and say no "synthetic fixture data" (spec §5.5)', async () => {
    countResults(resultsResponse({ rows: [verifiedRow(), calendarRow()] }));
    view();
    await table();
    expect(screen.queryByText(/Synthetic data/)).toBeNull();
    expect(screen.queryByText('synthetic fixture data')).toBeNull();
  });

  it('a synthetic price only in the overall cheapest still raises the banner (review prov-r2-008)', async () => {
    const synthetic = calendarRow({ provenance: provSynthetic, searchLink: null });
    countResults(resultsResponse({ rows: [verifiedRow()], cheapest: synthetic }));
    view();
    await table();
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('a synthetic row raises the red banner whatever /providers says, and says "synthetic fixture data" (review prov-005)', async () => {
    countResults(
      resultsResponse({
        basis: 'calendar',
        rows: [calendarRow({ provenance: provSynthetic, searchLink: null })],
      }),
    );
    view();
    await table();
    expect(screen.getByText(/Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
    expect(screen.getAllByText('synthetic fixture data').length).toBeGreaterThan(0);
  });
});

describe('row= selects, expands and scrolls to a row (plan "Web")', () => {
  it('the row named by its resultRowKey is marked current, expanded and scrolled into view', async () => {
    countResults();
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    view('?view=results&row=hash-partial-1');
    await table();
    const selected = dataRows().find((r) => r.getAttribute('aria-current') === 'true');
    if (selected === undefined) throw new Error('no selected row');
    expect(within(selected).getByText('£388')).toBeInTheDocument();
    expect(within(selected).getByRole('button', { name: /Hide details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect.poll(() => scrolled).toEqual([selected]);
  });
});

describe('keyboard operation of the table (spec §9 item 6, §11 accessibility)', () => {
  it('sort headers and row expansion work from the keyboard alone, and Tab moves to the next control', async () => {
    countResults();
    const { user } = view();
    await table();
    const priceSort = screen.getByRole('button', { name: 'Sort by Price, ascending' });
    priceSort.focus();
    await user.keyboard('{Enter}');
    expect(url().get('sort')).toBe('price.asc');
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sort by Price, descending' }));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sort by Travel time, ascending' }),
    );

    const toggle = within(dataRows()[0] ?? document.body).getByRole('button', { name: /Show details/ });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).not.toBeNull();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
