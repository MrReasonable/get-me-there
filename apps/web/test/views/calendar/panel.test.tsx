import { asIsoDate, generateCells, resultRowKey } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { verifyCellName } from '../../../src/components/VerifyCellButton.js';
import { COPY } from '../../../src/copy.js';
import { CellPanel } from '../../../src/views/Calendar/CellPanel.js';
import {
  canPressVerify,
  cellsForDay,
  noHeadroom,
  orderCalendarPrices,
  orderOutcomes,
  reasonText,
} from '../../../src/views/Calendar/panel.js';
import { API, calendarRow, definition, summary, verifiedRow } from '../../fixtures.js';
import {
  bare,
  cellAt,
  cellDetail,
  disc,
  hoursBefore,
  keyOf,
  outcome,
  priceAt,
  provCalendarAt,
  provItinerary,
  slice,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

const c = cellAt('2027-03-14', 14);
const date = asIsoDate('2027-03-14');
const earlier = summary({
  id: 'exec-0000',
  ageHours: 170,
  startedAt: hoursBefore(172),
  finishedAt: hoursBefore(171),
});
const executions = [summary(), earlier];
const observation = verifiedRow({ cell: c, seller: 'Example Air', pricePence: 52000 });
const detail = cellDetail(c, {
  outcomes: [
    outcome(c, 'discovery', 'travelpayouts', 'priced', {
      executionId: 'exec-0000',
      fetchedAt: hoursBefore(171),
    }),
    outcome(c, 'discovery', 'travelpayouts', 'priced', { reusedFromExecutionId: 'exec-0000' }),
    outcome(c, 'verification', 'searchapi', 'skipped', { reason: 'budget' }),
  ],
  calendarPrices: [
    {
      ...bare(priceAt(41200, provCalendarAt(2), false, c, true)),
      executionId: 'exec-0000',
      calendarPriceId: 7,
      superseded: false,
    },
  ],
  observations: [observation],
});
const cellRoute = `${API}/definitions/:id/cells/:origin/:destination/:departureDate/:returnDate`;
const daySlice = slice({
  discovery: [disc('travelpayouts', { priced: 40, no_data: 8 })],
  verification: { selected: 10, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 0 },
  cheapestCalendar: priceAt(41200, provCalendarAt(2), false, c),
});

function renderPanel(def = definition(), s = daySlice, inline = false) {
  const onClose = vi.fn();
  const r = renderWithProviders(
    <CellPanel
      definition={def}
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

describe('outcome order and reason words (prov-011, ui-r1-012)', () => {
  it('orders rows by the run list, newest first, then any other run, each by fetchedAt', () => {
    const child = outcome(c, 'verification', 'searchapi', 'priced', {
      executionId: 'child-1',
      fetchedAt: hoursBefore(1),
    });
    const [oldRun, reused, skipped] = detail.outcomes;
    if (oldRun === undefined || reused === undefined || skipped === undefined)
      throw new Error('fixture has three outcomes');
    const order = orderOutcomes([oldRun, child, skipped, reused], executions);
    expect(order.map((o) => `${o.executionId}:${o.stage}`)).toEqual([
      'exec-0001:discovery',
      'exec-0001:verification',
      'exec-0000:discovery',
      'child-1:verification',
    ]);
  });
  it('puts every reason in operator words; an unknown reason is shown as it came', () => {
    expect(reasonText('budget')).toBe('stopped: a budget cap was reached');
    expect(reasonText('not_selected')).toBe('not selected for itinerary search');
    expect(reasonText('offers-dropped:3')).toBe('3 offers could not be read and were dropped');
    expect(reasonText('something-new')).toBe('other: something-new');
    expect(reasonText('constructor')).toBe('other: constructor');
    expect(reasonText('no-priced-options')).toBe('the provider answered with no priced options');
    expect(reasonText('mixed')).toBe('several different errors');
    expect(reasonText(null)).toBe('—');
    expect(reasonText('partial-expansion;price-unconfirmed;offers-dropped:2')).toBe(
      'some outbound flights could not be expanded; price not confirmed by the final step; 2 offers could not be read and were dropped',
    );
  });
  it('no headroom: a zero cap or no calls of headroom left (WP7 childCapPreview)', () => {
    expect(noHeadroom(null)).toBe(false);
    expect(noHeadroom({ maxCalls: 0, headroomCalls: 40 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 0 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 1840 })).toBe(false);
  });
  it('verify may be pressed only once its cost has loaded, with headroom, and not while one is sent (ui-r2-007)', () => {
    expect(canPressVerify(undefined, false)).toBe(false);
    expect(canPressVerify({ ...detail, verify: null }, false)).toBe(false);
    expect(canPressVerify({ ...detail, verify: { maxCalls: 6, headroomCalls: 0 } }, false)).toBe(false);
    expect(canPressVerify(detail, true)).toBe(false);
    expect(canPressVerify(detail, false)).toBe(true);
  });
  it('superseded calendar prices come after current ones, each group in api order (decision 54)', () => {
    const p = (id: number, superseded: boolean) => ({ id, superseded });
    expect(orderCalendarPrices([p(1, true), p(2, false), p(3, true), p(4, false)]).map((x) => x.id)).toEqual([
      2, 4, 1, 3,
    ]);
  });
  it("the cell picker follows core's generation order: origins and destinations sorted (arch2-004)", () => {
    const def = definition();
    const cells = cellsForDay(def, date);
    expect(def.origins).toEqual(['LHR', 'LGW']);
    expect(cells[0]).toEqual({
      origin: 'LGW',
      destination: 'EWR',
      departureDate: '2027-03-14',
      returnDate: '2027-03-24',
    });
    const core = generateCells({
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: date,
      departureTo: date,
      minNights: def.minNights,
      maxNights: def.maxNights,
    });
    expect(cells.map((k) => `${k.origin}${k.destination}${k.returnDate}`)).toEqual(
      core.map((k) => `${k.origin}${k.destination}${k.returnDate}`),
    );
  });
});

describe('View B side panel (spec §11, §10 cells route; plan decision 38)', () => {
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

  it('lists the cell outcomes newest run first, marks the latest run, words the reason and labels reuse by date', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole } = renderPanel();
    const table = await findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    // why: ui-r2-010 — the run labels each row and stays in view while the table scrolls sideways.
    expect(within(table).getAllByRole('rowheader')[0]).toHaveClass('sticky');
    expect(rows.map((r) => r.getAttribute('data-current'))).toEqual(['true', 'true', 'false']);
    expect(rows[0]).toHaveTextContent(
      /run 14 Oct 2026.*latest run.*discovery.*Travelpayouts.*priced.*reused from run 7 Oct 2026/,
    );
    expect(rows[1]).toHaveTextContent(
      /itinerary search.*SearchApi.*skipped.*stopped: a budget cap was reached/,
    );
    expect(rows[2]).toHaveTextContent(/run 7 Oct 2026.*discovery/);
  });

  it('a priced verification with no confirmed price says "price not confirmed" in the outcome and the day (decision 48)', async () => {
    const unconfirmed = cellDetail(c, {
      outcomes: [
        outcome(c, 'verification', 'searchapi', 'priced', { reason: 'partial-expansion;price-unconfirmed' }),
      ],
    });
    server.use(http.get(cellRoute, () => HttpResponse.json(unconfirmed)));
    const day = slice({
      discovery: [disc('travelpayouts', { priced: 48 })],
      verification: { selected: 1, itinerarySearched: 1, onDemand: 0, unconfirmedCells: 1 },
      unconfirmedCells: 1,
    });
    const { findByRole, getByRole } = renderPanel(definition(), day);
    const row = within(await findByRole('table')).getAllByRole('row')[1];
    expect(row).toHaveTextContent(/priced.*price not confirmed/);
    expect(row).toHaveTextContent(
      'some outbound flights could not be expanded; price not confirmed by the final step',
    );
    expect(within(getByRole('region', { name: 'This day' })).getByTestId('day-marker')).toHaveTextContent(
      'price not confirmed: 1 itinerary-searched cell priced nothing the final step confirmed',
    );
  });

  it('shows every cell price with provenance and the rows-read note; an offer links to its Results row', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByText, getByRole } = renderPanel(definition(), slice({}));
    await findByText('£412');
    const dialog = getByRole('dialog');
    const provs = within(dialog).getAllByTestId('provenance');
    expect(provs).toHaveLength(2);
    expect(provs[0]).toHaveClass('border-dashed');
    expect(dialog).toHaveTextContent('calendar price · run 7 Oct 2026');
    expect(dialog).toHaveTextContent('cheapest of the rows read');
    expect(dialog).toHaveTextContent('itinerary offer · Example Air · verified');
    const link = within(dialog).getByRole('link', { name: 'show in results' }).getAttribute('href') ?? '';
    expect(new URLSearchParams(link.split('?')[1]).get('row')).toBe(resultRowKey(observation));
    expect(new URLSearchParams(link.split('?')[1]).get('view')).toBe('results');
  });

  it('an offer whose price the final step did not confirm says so inside its price; a page-capped row says rows read (prov-r2-001)', async () => {
    const unconfirmed = verifiedRow({
      cell: c,
      seller: 'Example Air',
      pricePence: 50000,
      unverified: ['priceConfirmed'],
    });
    const capped = calendarRow({ cell: c, truncated: true });
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, calendarPrices: [], observations: [unconfirmed, capped] }),
      ),
    );
    const { findAllByTestId } = renderPanel(definition(), slice({}));
    const [first, second] = await findAllByTestId('panel-observation');
    if (first === undefined || second === undefined) throw new Error('two observations');
    expect(within(first).getByTestId('price-cell')).toHaveTextContent(
      'price not confirmed by the final step',
    );
    expect(within(second).getByTestId('price-cell')).toHaveTextContent('cheapest of the rows read');
    expect(within(second).getByTestId('price-cell')).not.toHaveTextContent('price not confirmed');
  });

  it('an offer the latest search no longer returned, and a superseded row, carry decision 54 marks in the panel', async () => {
    const unseen = verifiedRow({ cell: c, seller: 'Example Air', notSeenInLatest: { ageHours: 30 } });
    const old = calendarRow({ cell: c, superseded: true });
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, calendarPrices: [], observations: [unseen, old] }),
      ),
    );
    const { findAllByTestId } = renderPanel(definition(), slice({}));
    const [first, second] = await findAllByTestId('panel-observation');
    if (first === undefined || second === undefined) throw new Error('two observations');
    expect(within(first).getByTestId('price-cell')).toHaveTextContent('not seen in latest search (30h ago)');
    expect(within(second).getByTestId('price-cell')).toHaveTextContent('superseded by a later search');
  });

  it('a superseded calendar price says so and is listed after the current one (decision 54)', async () => {
    const [first] = detail.calendarPrices;
    if (first === undefined) throw new Error('fixture has a calendar price');
    const old = { ...first, calendarPriceId: 8, pricePence: 30000, superseded: true };
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, calendarPrices: [old, first], observations: [] }),
      ),
    );
    const { findByText, getByRole } = renderPanel(definition(), slice({}));
    await findByText('£300');
    const prices = within(getByRole('dialog')).getAllByTestId('price-cell');
    expect(prices.map((c) => c.textContent?.includes('superseded by a later search'))).toEqual([false, true]);
    expect(prices[0]).toHaveTextContent('£412');
  });

  it('a cell price lacking provenance fails to render: the contract parse refuses the response, no amount appears', async () => {
    const [first] = detail.calendarPrices;
    if (first === undefined) throw new Error('fixture has a calendar price');
    const { provenance: _dropped, ...rest } = first;
    server.use(
      http.get(cellRoute, () => HttpResponse.json({ ...detail, calendarPrices: [rest], observations: [] })),
    );
    const { findByRole, getByRole } = renderPanel(definition(), slice({}));
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(getByRole('dialog')).not.toHaveTextContent('£');
  });

  it('hides the verify action when the definition has no verification provider', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json({ ...detail, verify: null })));
    const def = definition({
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
    });
    const { findByRole, queryByRole } = renderPanel(def);
    await findByRole('table');
    expect(queryByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) })).toBeNull();
  });

  it('verify shows what it may spend, posts through WP9’s action, and names a running search or a budget cap', async () => {
    let posted: unknown = null;
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post(`${API}/cells/verify`, async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ executionId: 'child-1' });
      }),
    );
    const { findByText, getByRole, user } = renderPanel();
    expect(await findByText('hard stop 6 calls · 1840 calls of budget headroom left')).toHaveAttribute(
      'data-testid',
      'verify-cost',
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) }));
    expect(await findByText(COPY.verifyStartedFor(verifyCellName(c)))).toBeInTheDocument();
    // why: cost-004: the click confirms the hard stop the panel showed, so a cap-share soft confirm never dead-ends it.
    expect(posted).toEqual({
      definitionId: 'def-0001',
      cell: keyOf(c),
      confirmCalls: 6,
      confirmCostPence: 0,
    });

    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'active', message: 'child active' } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) }));
    expect(await findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();

    const capMessage = 'budget cap: provider-month:searchapi 10000 of 10000 calls';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'cap', message: capMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) }));
    expect(await findByText(`Refused by a budget cap: ${capMessage}`)).toBeInTheDocument();

    // why: cost-004: a 409 'confirm' is a confirmation the click did not cover, never "already running".
    const confirmMessage =
      'the estimate of £1.20 is above the confirmation threshold and has not been confirmed';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'confirm', message: confirmMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) }));
    expect(
      await findByText(COPY.calendarView.panel.verifyConfirmRefused(confirmMessage)),
    ).toBeInTheDocument();
  });

  it('while the cell detail loads, verify is disabled and says its cost is loading (ui-r2-007)', async () => {
    server.use(
      http.get(cellRoute, async () => {
        await delay('infinite');
        return HttpResponse.json(detail);
      }),
    );
    const { getByRole, getByTestId } = renderPanel();
    expect(getByTestId('verify-cost')).toHaveTextContent('Loading what this search may spend…');
    expect(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) })).toBeDisabled();
  });

  it('at phone width the panel is a section of the page, not an overlay dialog (ui-r2-010)', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole, queryByRole, getByTestId } = renderPanel(definition(), daySlice, true);
    await findByRole('table');
    expect(queryByRole('dialog')).toBeNull();
    expect(getByTestId('cell-panel').tagName).toBe('SECTION');
    expect(getByTestId('cell-panel')).not.toHaveClass('fixed');
  });

  it('with no headroom left the button is disabled and says why', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          verify: { maxCalls: 6, headroomCalls: 0 },
        }),
      ),
    );
    const { findByText, getByRole } = renderPanel();
    expect(await findByText('No budget headroom left for this search.')).toBeInTheDocument();
    expect(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(c)) })).toBeDisabled();
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
      definition(),
      slice({ cheapestVerified: priceAt(52000, provItinerary(5), false, c) }),
    );
    expect(getByRole('heading', { name: 'Departing Sun 14 Mar 2027' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
