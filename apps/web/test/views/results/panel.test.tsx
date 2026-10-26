import { asIata, asIsoDate, type CellKey, generateCells, resultRowKey } from '@gmt/core';
import { within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CalendarGapResponse, DefinitionResponse } from '../../../src/api/types.js';
import { verifyCellName } from '../../../src/components/VerifyCellButton.js';
import { COPY } from '../../../src/copy.js';
import { AirportPairPanel, type GapMark } from '../../../src/views/Results/AirportPairPanel.js';
import {
  canPressVerify,
  cellsForDatePair,
  noHeadroom,
  orderCalendarPrices,
  orderOutcomes,
  reasonText,
} from '../../../src/views/Results/panel.js';
import {
  API,
  calendarGap,
  calendarRow,
  DETAIL_SEARCH,
  definition,
  summary,
  verifiedRow,
} from '../../fixtures.js';
import {
  bare,
  cellAt,
  cellDetail,
  hoursBefore,
  keyOf,
  outcome,
  priceAt,
  provCalendarAt,
} from '../../fixtures.wp10.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// The date pair detail's per-airport-pair panel (spec §11, WP19 Task 19.6): the Calendar's side panel moved, its tests
// ported from test/views/calendar/panel.test.tsx. The Calendar-only parts (the day's section, the cell picker, the
// dialog's focus and Escape) stay with the Calendar's own test until Task 19.8 removes that view.

const c = cellAt('2027-03-14', 14);
const key: CellKey = keyOf(c);
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

function renderPanel(
  def: DefinitionResponse = definition(),
  gap: GapMark | null = null,
  cells: readonly CellKey[] = [key],
) {
  return renderWithProviders(
    <div>
      {cells.map((k) => (
        <AirportPairPanel
          key={`${k.origin}${k.destination}`}
          definition={def}
          cell={k}
          executions={executions}
          gap={gap}
        />
      ))}
    </div>,
    { search: DETAIL_SEARCH },
  );
}

/** A calendar-gap mark for this panel's cell, from the gap route's fixture (spec §6.9, decision 58). */
function gapMark(over: Partial<CalendarGapResponse['cells'][number]['calendar']> = {}): GapMark {
  const g = calendarGap();
  const [first] = g.cells;
  if (first === undefined || g.cheapestVerified === null) throw new Error('the gap fixture has a cell');
  return {
    calendar: { ...first.calendar, ...over },
    reference: g.cheapestVerified,
  };
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
  it('a scheduled_only outcome of the latest run says which run fetches it and its stored detail’s reason; an earlier run’s reads in the past tense; without a detail the reason alone (spec §3 rev 36, R12, S6, S9)', () => {
    const latest = (leftFor: 'next-scheduled-run' | 'next-run' | 'no-longer-used') => ({
      leftFor,
      latest: true,
    });
    expect(reasonText('scheduled_only', 'catch-up-no-browser', latest('next-scheduled-run'))).toBe(
      'left for the next scheduled run: a catch-up loads no browser pages',
    );
    expect(reasonText('scheduled_only', 'outside-browser-window', latest('next-scheduled-run'))).toBe(
      "left for the next scheduled run: outside this run's browser window",
    );
    expect(reasonText('scheduled_only', 'outside-browser-window', latest('next-run'))).toBe(
      "left for your next run of this search: outside this run's browser window",
    );
    expect(reasonText('scheduled_only', 'catch-up-no-browser', latest('no-longer-used'))).toBe(
      'not fetched: this search no longer uses the browser provider; a catch-up loads no browser pages',
    );
    expect(
      reasonText('scheduled_only', 'catch-up-no-browser', { leftFor: 'next-scheduled-run', latest: false }),
    ).toBe('left by that run: a catch-up loads no browser pages');
    expect(reasonText('scheduled_only')).toBe('left for a later run');
    expect(reasonText('budget', null)).toBe('stopped: a budget cap was reached');
  });
  it('no headroom: a zero cap or no calls of headroom left (WP7 childCapPreview)', () => {
    expect(noHeadroom(null)).toBe(false);
    expect(noHeadroom({ maxCalls: 0, headroomCalls: 40, needCalls: 6 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 0, needCalls: 6 })).toBe(true);
    expect(noHeadroom({ maxCalls: 6, headroomCalls: 1840, needCalls: 6 })).toBe(false);
  });
  it('verify may be pressed only once its cost has loaded, with headroom, and not while one is sent (ui-r2-007)', () => {
    expect(canPressVerify(undefined, false)).toBe(false);
    expect(canPressVerify({ ...detail, verify: null }, false)).toBe(false);
    expect(
      canPressVerify({ ...detail, verify: { maxCalls: 6, headroomCalls: 0, needCalls: 6 } }, false),
    ).toBe(false);
    expect(canPressVerify(detail, true)).toBe(false);
    expect(canPressVerify(detail, false)).toBe(true);
  });
  it('superseded calendar prices come after current ones, each group in api order (decision 54)', () => {
    const p = (id: number, superseded: boolean) => ({ id, superseded });
    expect(orderCalendarPrices([p(1, true), p(2, false), p(3, true), p(4, false)]).map((x) => x.id)).toEqual([
      2, 4, 1, 3,
    ]);
  });
  it("the panels follow core's generation order: origins and destinations sorted (arch2-004)", () => {
    const def = definition();
    const dates = { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28') };
    const cells = cellsForDatePair(def.origins, def.destinations, dates);
    expect(def.origins).toEqual(['LHR', 'LGW']);
    const core = generateCells({
      origins: def.origins,
      destinations: def.destinations,
      departureFrom: dates.departureDate,
      departureTo: dates.departureDate,
      minNights: 14,
      maxNights: 14,
    });
    expect(cells).toEqual(core.map(keyOf));
    expect(cells.map((k) => `${k.origin}${k.destination}`)).toEqual(['LGWEWR', 'LGWJFK', 'LHREWR', 'LHRJFK']);
    // the Dates airport filter narrows them, in the same order
    expect(
      cellsForDatePair([asIata('LHR')], [asIata('JFK'), asIata('EWR')], dates).map((k) => k.destination),
    ).toEqual(['EWR', 'JFK']);
  });
});

describe('the per-airport-pair panel (spec §11 Date pair detail, §10 cells route; plan decision 38)', () => {
  it('is headed by its airport pair and reads its own cell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(cellRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(detail);
      }),
    );
    const { findByRole, getByTestId } = renderPanel();
    await findByRole('table');
    expect(getByTestId('airport-pair-panel').querySelector('h3')).toHaveTextContent('LHR → JFK');
    expect(paths).toEqual(['/api/definitions/def-0001/cells/LHR/JFK/2027-03-14/2027-03-28']);
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

  it('a priced verification with no confirmed price says "price not confirmed" in the outcome (decision 48)', async () => {
    const unconfirmed = cellDetail(c, {
      outcomes: [
        outcome(c, 'verification', 'searchapi', 'priced', { reason: 'partial-expansion;price-unconfirmed' }),
      ],
    });
    server.use(http.get(cellRoute, () => HttpResponse.json(unconfirmed)));
    const { findByRole } = renderPanel();
    const row = within(await findByRole('table')).getAllByRole('row')[1];
    expect(row).toHaveTextContent(/priced.*price not confirmed/);
    expect(row).toHaveTextContent(
      'some outbound flights could not be expanded; price not confirmed by the final step',
    );
  });

  it('shows every cell price with provenance and the rows-read note; an offer links to its row in this detail', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByText, getByTestId } = renderPanel();
    await findByText('£412');
    const panel = getByTestId('airport-pair-panel');
    const provs = within(panel).getAllByTestId('provenance');
    expect(provs).toHaveLength(2);
    expect(provs[0]).toHaveClass('border-dashed');
    expect(panel).toHaveTextContent('calendar price · run 7 Oct 2026');
    expect(panel).toHaveTextContent('cheapest of the rows read');
    expect(panel).toHaveTextContent('itinerary offer · Example Air · verified');
    const link = within(panel).getByRole('link', { name: 'show in results' }).getAttribute('href') ?? '';
    const q = new URLSearchParams(link.split('?')[1]);
    expect([q.get('view'), q.get('row'), q.get('depart'), q.get('return')]).toEqual([
      'results',
      resultRowKey(observation),
      '2027-03-14',
      '2027-03-28',
    ]);
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
    const { findAllByTestId } = renderPanel();
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
    const { findAllByTestId } = renderPanel();
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
    const { findByText, getByTestId } = renderPanel();
    await findByText('£300');
    const prices = within(getByTestId('airport-pair-panel')).getAllByTestId('price-cell');
    expect(prices.map((p) => p.textContent?.includes('superseded by a later search'))).toEqual([false, true]);
    expect(prices[0]).toHaveTextContent('£412');
  });

  it('a cell where one provider found no fares and the browser provider was left says so, row by row (R18)', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          outcomes: [
            outcome(c, 'discovery', 'travelpayouts', 'empty', {
              executionId: 'exec-0001',
              fetchedAt: hoursBefore(2),
            }),
            outcome(c, 'discovery', 'camoufox', 'skipped', {
              executionId: 'exec-0001',
              reason: 'scheduled_only',
              skipDetail: 'catch-up-no-browser',
              fetchedAt: null,
            }),
          ],
        }),
      ),
    );
    const { findByRole } = renderPanel();
    const table = await findByRole('table');
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(rows.some((t) => t.includes(COPY.provider.travelpayouts) && t.includes(COPY.bucket.empty))).toBe(
      true,
    );
    expect(
      rows.some(
        (t) =>
          t.includes(COPY.provider.camoufox) &&
          t.includes('left for the next scheduled run: a catch-up loads no browser pages'),
      ),
    ).toBe(true);
  });

  it('S9: with two runs, only the latest run’s left cell is promised to a later run; the earlier one reads in the past tense', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          latestExecutionId: 'exec-0001',
          browserLeftFor: 'next-run',
          outcomes: [
            outcome(c, 'discovery', 'camoufox', 'skipped', {
              executionId: 'exec-0001',
              reason: 'scheduled_only',
              skipDetail: 'outside-browser-window',
              fetchedAt: null,
            }),
            outcome(c, 'discovery', 'camoufox', 'skipped', {
              executionId: 'exec-0000',
              reason: 'scheduled_only',
              skipDetail: 'catch-up-no-browser',
              fetchedAt: null,
            }),
          ],
        }),
      ),
    );
    const { findByRole } = renderPanel();
    const table = await findByRole('table');
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent ?? '');
    expect(
      rows.filter((t) =>
        t.includes("left for your next run of this search: outside this run's browser window"),
      ),
    ).toHaveLength(1);
    expect(
      rows.filter((t) => t.includes('left by that run: a catch-up loads no browser pages')),
    ).toHaveLength(1);
    expect(rows.some((t) => t.includes('left for your next run of this search: a catch-up'))).toBe(false);
  });

  it('a cell price lacking provenance fails to render: the contract parse refuses the response, no amount appears', async () => {
    const [first] = detail.calendarPrices;
    if (first === undefined) throw new Error('fixture has a calendar price');
    const { provenance: _dropped, ...rest } = first;
    server.use(
      http.get(cellRoute, () => HttpResponse.json({ ...detail, calendarPrices: [rest], observations: [] })),
    );
    const { findByRole, getByTestId } = renderPanel();
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(getByTestId('airport-pair-panel')).not.toHaveTextContent('£');
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
    expect(queryByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) })).toBeNull();
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
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) }));
    expect(await findByText(COPY.verifyStartedFor(verifyCellName(key)))).toBeInTheDocument();
    // why: cost-004: the click confirms the hard stop the panel showed, so a cap-share soft confirm never dead-ends it.
    expect(posted).toEqual({
      definitionId: 'def-0001',
      cell: key,
      confirmCalls: 6,
      confirmCostPence: 0,
    });

    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'active', message: 'child active' } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) }));
    expect(await findByText('An itinerary search for this cell is already running.')).toBeInTheDocument();

    const capMessage = 'budget cap: provider-month:searchapi 10000 of 10000 calls';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'cap', message: capMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) }));
    expect(await findByText(`Refused by a budget cap: ${capMessage}`)).toBeInTheDocument();

    // why: cost-004: a 409 'confirm' is a confirmation the click did not cover, never "already running".
    const confirmMessage =
      'the estimate of £1.20 is above the confirmation threshold and has not been confirmed';
    server.use(
      http.post(`${API}/cells/verify`, () =>
        HttpResponse.json({ error: { code: 'confirm', message: confirmMessage } }, { status: 409 }),
      ),
    );
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) }));
    expect(await findByText(COPY.panel.verifyConfirmRefused(confirmMessage))).toBeInTheDocument();
  });

  it('the verify status names the cell that was submitted, in its own panel only', async () => {
    server.use(
      http.get(cellRoute, () => HttpResponse.json(detail)),
      http.post(`${API}/cells/verify`, () => HttpResponse.json({ executionId: 'child-1' })),
    );
    const other: CellKey = { ...key, origin: asIata('LGW') };
    const { findAllByText, getByRole, getAllByTestId, user } = renderPanel(definition(), null, [key, other]);
    await findAllByText('hard stop 6 calls · 1840 calls of budget headroom left');
    await user.click(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) }));
    const [mine, theirs] = getAllByTestId('airport-pair-panel');
    if (mine === undefined || theirs === undefined) throw new Error('two panels');
    expect(await within(mine).findByText(COPY.verifyStartedFor(verifyCellName(key)))).toBeInTheDocument();
    // why: no search was submitted for the other airport pair, so no status may say one started for it
    expect(within(theirs).queryByText(COPY.verifyStartedFor(verifyCellName(other)))).toBeNull();
    expect(within(theirs).queryByText(COPY.verifyStartedFor(verifyCellName(key)))).toBeNull();
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
    expect(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) })).toBeDisabled();
  });

  it('a definition allowing 0 billed calls says so and names the call cap that fixes it, in plain words (N2)', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({ ...detail, verify: { maxCalls: 0, headroomCalls: 0, needCalls: 6 } }),
      ),
    );
    const zero = definition({ budget: { maxCalls: 0, maxFreeCalls: 2000, maxCostMicroGbp: 0 } });
    const { findByText, getByRole, queryByText } = renderPanel(zero);
    expect(
      await findByText(
        "This definition allows 0 billed calls, so this search cannot start. Raise the definition's call cap to at least 6 in Definitions → Run budget (Max billed calls per run).",
      ),
    ).toBeInTheDocument();
    expect(COPY.panel.verifyZeroRunCap(6)).toBe(
      "This definition allows 0 billed calls, so this search cannot start. Raise the definition's call cap to at least 6 in Definitions → Run budget (Max billed calls per run).",
    );
    // why: the jargon line is for real headroom exhaustion by a running parent or child, not for a 0-call definition.
    expect(queryByText('No budget headroom left for this search.')).toBeNull();
    expect(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) })).toBeDisabled();
  });

  it('with no headroom left the button is disabled and says why', async () => {
    server.use(
      http.get(cellRoute, () =>
        HttpResponse.json({
          ...detail,
          verify: { maxCalls: 6, headroomCalls: 0, needCalls: 6 },
        }),
      ),
    );
    const { findByText, getByRole } = renderPanel();
    expect(await findByText('No budget headroom left for this search.')).toBeInTheDocument();
    expect(getByRole('button', { name: COPY.verifyCellFor(verifyCellName(key)) })).toBeDisabled();
  });
});

describe('the calendar-gap mark in its panel (spec §11, §6.9, decision 58)', () => {
  it('names the gap and shows its calendar price and the reference across the whole search, each through PriceCell', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { getByTestId } = renderPanel(
      definition({ destinationNotes: { JFK: 'onward leg not included' } }),
      gapMark(),
    );
    const mark = getByTestId('gap-mark');
    expect(mark).toHaveTextContent(COPY.calendarGapLead(1));
    const [cached, reference] = within(mark).getAllByTestId('price-cell');
    expect(cached).toHaveTextContent('£399');
    expect(within(cached ?? mark).getByTestId('provenance')).toHaveTextContent('constraints not checked');
    expect(mark).toHaveTextContent(COPY.datesView.gapReference);
    expect(reference).toHaveTextContent('£412');
    // a current reference carries no not-seen mark (decision 54)
    expect(reference).not.toHaveTextContent('not seen in latest search');
    // every price for a destination carries its note (spec §11)
    expect(mark).toHaveTextContent('onward leg not included');
  });

  it('a truncated gap price says "cheapest of the rows read"; a reference the latest search no longer returned says so (decision 54)', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const mark = gapMark({ truncated: true });
    const { getByTestId } = renderPanel(definition(), {
      ...mark,
      reference: { ...mark.reference, notSeenInLatest: { ageHours: 30 } },
    });
    const [cached, reference] = within(getByTestId('gap-mark')).getAllByTestId('price-cell');
    expect(cached).toHaveTextContent('cheapest of the rows read');
    expect(reference).toHaveTextContent('not seen in latest search (30h ago)');
  });

  it('without a gap cell there is no mark', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByRole, queryByTestId } = renderPanel();
    await findByRole('table');
    expect(queryByTestId('gap-mark')).toBeNull();
  });
});

describe('panel point of sale (spec §11)', () => {
  it('each price in the panel names its market', async () => {
    server.use(http.get(cellRoute, () => HttpResponse.json(detail)));
    const { findByText, getByTestId } = renderPanel();
    await findByText('£412');
    const pos = within(getByTestId('airport-pair-panel')).getAllByTestId('point-of-sale');
    expect(pos.map((e) => e.textContent)).toEqual(['market not stated', 'UK market']);
  });
});
