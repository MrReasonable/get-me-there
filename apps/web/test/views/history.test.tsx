import { asIata, asIsoDateTime } from '@gmt/core';
import { waitFor, within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { formatInstantLondon } from '../../src/format.js';
import { HISTORY_PARAMS, historyHref } from '../../src/state/links.js';
import { HistoryChart } from '../../src/views/History/HistoryChart.js';
import { HistoryView } from '../../src/views/History/HistoryView.js';
import {
  assignColours,
  coloursRepeat,
  consecutiveRuns,
  historySpan,
  itineraryHeading,
  linesForPairs,
  linesFromItinerary,
  linesFromRoute,
  newestAllStale,
  type PlotLine,
  type PlotPoint,
  runOrder,
  withBreaks,
} from '../../src/views/History/lines.js';
import { API, definition, resultsResponse, summary } from '../fixtures.js';
import {
  cellAt,
  fetchPoint,
  itineraryHistory,
  provCalendarAt,
  routeHistory,
  runsAt,
} from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { drawn, drawnText, renderWithProviders } from '../render.js';

const routeRoute = `${API}/routes/:origin/:destination/history`;
const itineraryRoute = `${API}/itineraries/:hash/history`;
const resultsRoute = `${API}/definitions/:id/results`;
// Points from the runs 2h, 170h and 500h ago; a run 300h ago fetched nothing for this series.
const threeRuns = routeHistory({
  calendarSeries: [
    {
      providerId: 'travelpayouts',
      cabin: 'economy',
      points: [
        fetchPoint(500, 45000),
        fetchPoint(2, 39900, cellAt('2027-03-21', 14)),
        fetchPoint(170, 42000),
      ],
    },
  ],
});
/** The definition's runs: 500h, 300h, 170h and 2h ago, so 500→170 skips a run and 170→2 is consecutive. */
const RUNS = runsAt(2, 170, 300, 500);
const order = runOrder(RUNS);
const serveRuns = (executions = RUNS) =>
  server.use(http.get(resultsRoute, () => HttpResponse.json(resultsResponse({ executions }))));
const priced = (pts: ReadonlyArray<{ pricePence: number | null }>) => pts.map((p) => p.pricePence);

describe('history lines (spec §11 History; plan decisions 38, 52)', () => {
  it('the run order lists parent runs oldest first; one-cell child runs are not in it', () => {
    const child = summary({ id: 'child-1', isChild: true });
    expect([...runOrder([...RUNS.slice(0, 1), child, ...RUNS.slice(1)]).entries()]).toEqual([
      ['exec-500', 0],
      ['exec-300', 1],
      ['exec-170', 2],
      ['exec-2', 3],
    ]);
  });
  it('withBreaks sorts any input order and breaks wherever the join rule refuses', () => {
    const gap = (t: number) => ({ t, gap: true });
    const near = (a: { t: number }, b: { t: number }) => b.t - a.t <= 200;
    expect(withBreaks([{ t: 300 }, { t: 0 }, { t: 100 }], near, gap)).toEqual([
      { t: 0 },
      { t: 100 },
      { t: 300 },
    ]);
    expect(withBreaks([{ t: 0 }, { t: 201 }], near, gap)).toEqual([
      { t: 0 },
      { t: 100.5, gap: true },
      { t: 201 },
    ]);
  });
  it('joins only consecutive runs of the definition, never by time gap (decision 52, prov-r2-005)', () => {
    const joined = consecutiveRuns(order);
    expect(joined({ executionId: 'exec-170' }, { executionId: 'exec-2' })).toBe(true);
    expect(joined({ executionId: 'exec-500' }, { executionId: 'exec-170' })).toBe(false);
    expect(joined({ executionId: 'exec-2' }, { executionId: 'exec-170' })).toBe(false);
    expect(joined({ executionId: 'child-1' }, { executionId: 'exec-2' })).toBe(false);
    const [line] = linesFromRoute(threeRuns, order).fetch;
    expect(priced(line?.points ?? [])).toEqual([45000, null, 42000, 39900]);
    // why: the same points with no run between them join, however far apart in time.
    const [dense] = linesFromRoute(threeRuns, runOrder(runsAt(2, 170, 500))).fetch;
    expect(priced(dense?.points ?? [])).toEqual([45000, 42000, 39900]);
    // why: an unknown run order joins nothing.
    const [none] = linesFromRoute(threeRuns, runOrder([])).fetch;
    expect(priced(none?.points ?? [])).toEqual([45000, null, 42000, null, 39900]);
  });
  it('marks a calendar point whose cheapest cell differs from the previous point’s', () => {
    const [line] = linesFromRoute(threeRuns, order).fetch;
    const changed = (line?.points ?? []).flatMap((p) => (p.kind === 'price' ? [p.cellChanged] : []));
    expect(changed).toEqual([false, false, true]);
  });
  it('the route-level series is its own line, plotted by travel date, broken after a missing day', () => {
    const r = routeHistory({
      routeSeries: [
        {
          providerId: 'searchapi',
          trip: null,
          cabin: 'unknown',
          points: ['2027-03-10', '2027-03-11', '2027-03-14'].map((date) => ({
            date,
            pricePence: 38000,
            currency: 'GBP',
            fetchedAt: fetchPoint(2, 1).at,
            providerId: 'searchapi',
            sourceKind: 'scraped-search',
            pointOfSale: 'unknown',
            fx: { converted: false },
            stale: false,
          })),
        },
      ],
    });
    const { route } = linesFromRoute(r, order);
    expect(route[0]?.points[0]?.t).toBe(Date.UTC(2027, 2, 10));
    expect(priced(route[0]?.points ?? [])).toEqual([38000, 38000, null, 38000]);
  });
  it("names each series by its source and cabin; the vendor's price history by its trip (decision 52, ui-r2-008, ruling 6)", () => {
    const { fetch, route } = linesFromRoute(threeRuns, order);
    expect(fetch.map((l) => l.name)).toEqual([
      "Aviasales cache · economy · cheapest calendar price across this pair's cells, per run (constraints not checked)",
    ]);
    expect(route.map((l) => l.name)).toEqual(["Google's price history for 10–20 Mar · economy, indicative"]);
    const [first] = routeHistory().routeSeries;
    if (first === undefined) throw new Error('fixture has a route series');
    const unknown = routeHistory({ routeSeries: [{ ...first, trip: null, cabin: 'unknown' }] });
    expect(linesFromRoute(unknown, order).route.map((l) => l.name)).toEqual([
      "Google's price history, trip unknown · cabin not stated, indicative",
    ]);
    expect(linesFromRoute(threeRuns, order, 'LHR-JFK').fetch[0]?.name).toMatch(/^LHR-JFK · Aviasales cache/);
  });
  it('one seller in two cabins is two series: own key, own name with the cabin, own colour (review prov I2)', () => {
    const base = itineraryHistory();
    const first = base.series[0];
    if (first === undefined) throw new Error('fixture has a series');
    const lines = linesFromItinerary(
      itineraryHistory({ series: [first, { ...first, cabin: 'business' }] }),
      runOrder(runsAt(5, 6, 173, 174)),
    );
    const keys = lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(4);
    expect(lines.map((l) => l.name)).toContain(
      'Google Flights via SearchApi · itinerary offer · Example Travel · business',
    );
    expect(new Set(lines.map((l) => l.colour)).size).toBe(4);
  });
  it('an itinerary splits confirmed and unconfirmed prices into a solid and a dotted series, joined by run order', () => {
    const lines = linesFromItinerary(itineraryHistory(), runOrder(runsAt(5, 6, 173, 174)));
    expect(lines.map((l) => [l.kind, l.name])).toEqual([
      ['offer', 'Google Flights via SearchApi · itinerary offer · Example Travel · economy'],
      [
        'offer-unconfirmed',
        'Google Flights via SearchApi · itinerary offer · Example Travel · economy · price not confirmed by the final step',
      ],
    ]);
    // why: 173 → 5 skips the runs 174 and 6 between them, so the confirmed line breaks; 174 → 6 skips 173 and breaks too.
    expect(lines.map((l) => priced(l.points))).toEqual([
      [43000, null, 41200],
      [40000, null, 39000],
    ]);
  });
  it('colours: one pair keeps a colour per series key; the overlay gives every line of a pair the pair’s colour (ui-r2-009)', () => {
    const pairs = [
      { origin: asIata('LHR'), destination: asIata('JFK') },
      { origin: asIata('LGW'), destination: asIata('EWR') },
    ];
    const both = linesForPairs([threeRuns, threeRuns], pairs, order, true);
    expect(both.fetch.map((l) => l.colour)).toEqual([0, 1]);
    expect(both.route.map((l) => l.colour)).toEqual([0, 1]);
    const one = linesForPairs([threeRuns], pairs.slice(0, 1), order, false);
    expect(one.fetch.map((l) => l.colour)).toEqual([0]);
    expect(
      assignColours([
        { key: 'b', colour: 0 },
        { key: 'a', colour: 0 },
      ]).map((l) => l.colour),
    ).toEqual([1, 0]);
    expect(coloursRepeat([{ colour: 5 }])).toBe(false);
    expect(coloursRepeat([{ colour: 6 }])).toBe(true);
  });
  it('drops series with no points; spans count runs and newest-stale come from the drawn points', () => {
    expect(
      linesFromRoute(
        routeHistory({
          calendarSeries: [{ providerId: 'travelpayouts', cabin: 'economy', points: [] }],
          routeSeries: [],
        }),
        order,
      ),
    ).toEqual({ fetch: [], route: [] });
    const { fetch } = linesFromRoute(threeRuns, order);
    expect(historySpan(fetch, new Set())).toEqual({
      runs: 3,
      onDemand: 0,
      firstAt: fetchPoint(500, 1).at,
      lastAt: fetchPoint(2, 1).at,
    });
    // why: UI-010: a point an on-demand child fetched is counted as an on-demand search, never as a run.
    const [firstPoint] = fetch[0]?.points.filter((p) => p.kind === 'price') ?? [];
    const childId = firstPoint?.kind === 'price' ? firstPoint.executionId : '';
    expect(historySpan(fetch, new Set([childId]))).toMatchObject({ runs: 2, onDemand: 1 });
    expect(COPY.historyView.spanLine(1, 1, '1 Oct', '2 Oct')).toBe(
      '1 run and 1 on-demand search shown, 1 Oct to 2 Oct',
    );
    expect(historySpan([], new Set())).toBeNull();
    expect(newestAllStale(fetch)).toBe(false);
    const stale = linesFromRoute(
      routeHistory({
        calendarSeries: [
          {
            providerId: 'travelpayouts',
            cabin: 'economy',
            points: [fetchPoint(2, 1, undefined, { stale: true })],
          },
        ],
      }),
      order,
    );
    expect(newestAllStale(stale.fetch)).toBe(true);
  });
  it('the itinerary heading comes from the api’s cell and carriers', () => {
    expect(itineraryHeading(itineraryHistory())).toBe('LHR→JFK · Sun 14 Mar 2027 to Sun 28 Mar 2027 · BA');
  });
});

describe('History view (spec §11 History, §10 history routes; plan decision 38)', () => {
  it('shows an explicit loading state', () => {
    server.use(
      http.get(routeRoute, async () => {
        await delay('infinite');
        return HttpResponse.json(threeRuns);
      }),
    );
    expect(
      renderWithProviders(<HistoryView definition={definition()} />).getByRole('status'),
    ).toHaveTextContent('Loading…');
  });
  it('shows an error state', async () => {
    server.use(
      http.get(routeRoute, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    expect(
      await renderWithProviders(<HistoryView definition={definition()} />).findByRole('alert'),
    ).toHaveTextContent('Could not load: boom');
  });
  it('shows the empty state when there is no history', async () => {
    server.use(
      http.get(routeRoute, () => HttpResponse.json(routeHistory({ calendarSeries: [], routeSeries: [] }))),
    );
    const { findByText } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(
      await findByText('No price history yet for this selection. Each run adds a point.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('route mode: the pair lives in the URL, the definition’s cabin is the query, and "all pairs" overlays them', async () => {
    const paths: string[] = [];
    const cabins: Array<string | null> = [];
    server.use(
      http.get(routeRoute, ({ request }) => {
        const u = new URL(request.url);
        paths.push(u.pathname);
        cabins.push(u.searchParams.get('cabin'));
        return HttpResponse.json(threeRuns);
      }),
    );
    const { findByLabelText, findAllByRole, user } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    const picker = await findByLabelText('Route');
    if (!(picker instanceof HTMLSelectElement)) throw new Error('route picker is a select');
    expect([...picker.options].map((o) => o.text)).toEqual([
      'LHR→JFK',
      'LHR→EWR',
      'LGW→JFK',
      'LGW→EWR',
      'All pairs',
    ]);
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LHR/JFK/history'));
    expect(cabins.at(-1)).toBe('economy');
    await user.selectOptions(picker, 'LGW-EWR');
    expect(new URLSearchParams(window.location.search).get(HISTORY_PARAMS.pair)).toBe('LGW-EWR');
    await waitFor(() => expect(paths.at(-1)).toBe('/api/routes/LGW/EWR/history'));
    await user.selectOptions(picker, 'all');
    const tables = await findAllByRole('table', { name: /^LGW-EWR · Aviasales cache/ });
    expect(tables).toHaveLength(1);
    expect(new Set(paths)).toEqual(
      new Set([
        '/api/routes/LHR/JFK/history',
        '/api/routes/LHR/EWR/history',
        '/api/routes/LGW/JFK/history',
        '/api/routes/LGW/EWR/history',
      ]),
    );
  });

  it('draws fetch-time lines and the indicative route-level series in separate charts, breaking only between runs', async () => {
    serveRuns();
    server.use(http.get(routeRoute, () => HttpResponse.json(threeRuns)));
    const { findByRole, getByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    const fetchChart = await findByRole('figure', { name: 'Price by fetch date' });
    const routeChart = getByRole('figure', {
      name: 'Vendor price history for a searched trip (indicative): price by date',
    });
    // why: each chart draws after its box is measured, in renders after the figure's; wait for what is read below
    const fetchText = await drawnText(fetchChart, 'fetched (Europe/London)');
    const routeText = await drawnText(routeChart, 'date of the vendor price', '10 Mar 2027');
    expect(
      getByText(/^Each point is one run. A line joins two points only when they come from consecutive runs/),
    ).toBeInTheDocument();
    // why: decision 52 — no fare outside PriceCell, so neither figure is exempt and their axes print no "£".
    for (const f of [fetchChart, routeChart]) expect(f).not.toHaveAttribute('data-scale');
    expect(fetchText).not.toContain('£');
    expect(routeText).not.toContain('£');
    const curve = await drawn(fetchChart, '.recharts-line-curve');
    // why: the 300h run between the 500h and 170h points fetched nothing: two sub-paths, never a segment across it.
    expect(curve.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    expect(curve.getAttribute('stroke-dasharray')).toBe('6 3');
    const routeCurve = await drawn(routeChart, '.recharts-line-curve');
    expect(routeCurve.getAttribute('d')?.match(/M/g)).toHaveLength(1);
  });

  it('a point from a catch-up says "ran <time>, catch-up for <missed time>" and keeps its own fetch time; other runs show nothing extra (spec §8.2 rev 36)', async () => {
    const runs = runsAt(2, 170, 300, 500);
    serveRuns(runs);
    const run170 = runs.find((r) => r.id === 'exec-170');
    // why: review R19 — the api labels the point from the run that fetched it, whatever its definition; this
    // definition's own runs list says nothing about it
    const labelled = routeHistory({
      calendarSeries: [
        {
          providerId: 'travelpayouts',
          cabin: 'economy',
          points: [
            fetchPoint(500, 45000),
            fetchPoint(2, 39900, cellAt('2027-03-21', 14)),
            fetchPoint(170, 42000, cellAt('2027-03-14', 14), {
              catchUp: {
                ranAt: run170?.startedAt ?? asIsoDateTime('2026-10-07T12:00:00.000Z'),
                for: asIsoDateTime('2026-10-07T04:00:00.000Z'),
              },
            }),
          ],
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(labelled)));
    const { findAllByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const [table] = await findAllByRole('table');
    if (table === undefined) throw new Error('no table');
    const rows = within(table).getAllByRole('row').slice(1);
    const texts = rows.map((r) => r.textContent ?? '');
    const startedAt = run170?.startedAt ?? '';
    const label = COPY.historyView.catchUpRun(
      formatInstantLondon(Date.parse(startedAt)),
      formatInstantLondon(Date.parse('2026-10-07T04:00:00.000Z')),
    );
    expect(label).toMatch(/^ran \d{1,2} [A-Z][a-z]{2} 2026 \d{2}:\d{2}, catch-up for 7 Oct 2026 05:00$/);
    expect(texts.filter((t) => t.includes(label))).toHaveLength(1);
    expect(texts.filter((t) => t.includes('catch-up for'))).toHaveLength(1);
    // the catch-up's price shows its own fetch time in the When column
    const row = rows.find((r) => (r.textContent ?? '').includes(label));
    expect(row?.querySelector('td')?.textContent).toBe(
      formatInstantLondon(Date.parse(fetchPoint(170, 42000).at)),
    );
  });

  it('a stale route-level point is labelled stale beside its indicative amount (decision 54)', async () => {
    const r = routeHistory();
    const [series] = r.routeSeries;
    if (series === undefined) throw new Error('fixture has a route series');
    const [p0, ...rest] = series.points;
    if (p0 === undefined) throw new Error('fixture has a route point');
    const stale = { ...r, routeSeries: [{ ...series, points: [{ ...p0, stale: true }, ...rest] }] };
    server.use(http.get(routeRoute, () => HttpResponse.json(stale)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const table = await findByRole('table', { name: /^Google's price history for 10–20 Mar/ });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent?.includes('stale'))).toEqual([true, false, false]);
    expect(rows[0]).toHaveAttribute('data-indicative');
    // why: prov-004: every stored point is vendor-stated GBP (the repository refuses any other), so no "≈"; it says so.
    expect(rows[0]).not.toHaveTextContent('≈');
    expect(rows[0]).toHaveTextContent(COPY.historyView.routeGbp);
  });

  it('a route-level travel date between two missing dates still shows as a dot (ui-r2-008)', async () => {
    const lone = routeHistory({
      calendarSeries: [],
      routeSeries: [
        {
          providerId: 'searchapi',
          trip: { departureDate: '2027-03-10', returnDate: '2027-03-20' },
          cabin: 'economy',
          points: ['2027-03-10', '2027-03-12', '2027-03-14'].map((date) => ({
            date,
            pricePence: 38000,
            currency: 'GBP',
            fetchedAt: fetchPoint(2, 1).at,
            providerId: 'searchapi',
            sourceKind: 'scraped-search',
            pointOfSale: 'unknown',
            fx: { converted: false },
            stale: false,
          })),
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(lone)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const chart = await findByRole('figure', {
      name: 'Vendor price history for a searched trip (indicative): price by date',
    });
    await waitFor(() => expect(chart.querySelectorAll('.recharts-line-dots circle')).toHaveLength(3));
  });

  it('a stale point is drawn as a hollow dot, a fresh one filled (review ui M9)', async () => {
    const r = routeHistory({
      calendarSeries: [
        {
          providerId: 'travelpayouts',
          cabin: 'economy',
          points: [fetchPoint(2, 39900, cellAt('2027-03-14', 14), { stale: true }), fetchPoint(170, 42000)],
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(r)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const chart = await findByRole('figure', { name: 'Price by fetch date' });
    await waitFor(() => expect(chart.querySelectorAll('circle[data-stale]').length).toBeGreaterThan(1));
    expect(chart.querySelectorAll('circle[data-stale="true"]')).toHaveLength(1);
    expect(chart.querySelector('circle[data-stale="true"]')).toHaveAttribute('fill', '#ffffff');
    expect(chart.querySelectorAll('circle[data-stale="false"]').length).toBeGreaterThan(0);
  });

  it('a failed runs query is shown, not read as a definition with no runs (route and itinerary history)', async () => {
    server.use(
      http.get(routeRoute, () => HttpResponse.json(threeRuns)),
      http.get(itineraryRoute, () => HttpResponse.json(itineraryHistory())),
      http.get(resultsRoute, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'runs down' } }, { status: 500 }),
      ),
    );
    const route = renderWithProviders(<HistoryView definition={definition()} />);
    expect(await route.findByRole('alert')).toHaveTextContent('Could not load: runs down');
    route.unmount();
    const itinerary = renderWithProviders(<HistoryView definition={definition()} />, {
      search: '?hash=h1',
    });
    expect(await itinerary.findByRole('alert')).toHaveTextContent('Could not load: runs down');
  });

  it('a gap point draws no dot: only priced points get one, so no phantom fetch sits at the top of the plot', async () => {
    const at = asIsoDateTime('2026-10-12T15:00:00.000Z');
    const priced = (t: number, executionId: string): PlotPoint => ({
      kind: 'price',
      t,
      at,
      executionId,
      pricePence: 41200,
      provenance: provCalendarAt(2),
      stale: false,
      truncated: false,
      cell: null,
      cellChanged: false,
      priceConfirmed: true,
      catchUp: null,
    });
    const line: PlotLine = {
      key: 'travelpayouts|calendar',
      kind: 'calendar',
      providerId: 'travelpayouts',
      name: 'Travelpayouts calendar',
      colour: 0,
      points: [
        priced(Date.parse('2026-10-01T00:00:00.000Z'), 'a'),
        { kind: 'gap', t: Date.parse('2026-10-05T00:00:00.000Z'), pricePence: null },
        priced(Date.parse('2026-10-10T00:00:00.000Z'), 'b'),
      ],
    };
    const { findByRole } = renderWithProviders(<HistoryChart lines={[line]} tablesId="tables" />);
    const chart = await findByRole('figure', { name: 'Price by fetch date' });
    await waitFor(() => expect(chart.querySelectorAll('circle[data-stale]').length).toBeGreaterThan(0));
    expect(chart.querySelectorAll('circle[data-stale]')).toHaveLength(2);
    for (const c of chart.querySelectorAll('circle[data-stale]')) expect(c).toHaveAttribute('cy');
  });

  it('tables every point: provider prices through PriceCell with stale and rows-read labels and the changed cell; route rows labelled indicative', async () => {
    const r = routeHistory({
      calendarSeries: [
        {
          providerId: 'travelpayouts',
          cabin: 'economy',
          points: [
            fetchPoint(2, 39900, cellAt('2027-03-21', 14), { truncated: true }),
            fetchPoint(170, 42000, undefined, { stale: true }),
          ],
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(r)));
    const { findByRole, getByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const calendarTable = await findByRole('table', {
      name: /Aviasales cache · economy · cheapest calendar price/,
    });
    const rows = within(calendarTable).getAllByRole('row').slice(1);
    expect(within(calendarTable).getAllByTestId('provenance')).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('cheapest of the rows read');
    expect(rows[0]).toHaveTextContent('cheapest searched cell LHR→JFK Sun 21 Mar–Sun 4 Apr');
    expect(rows[0]).toHaveTextContent('a different cell from the previous point');
    expect(rows[1]).toHaveTextContent('stale');
    const routeTable = getByRole('table', { name: /^Google's price history for 10–20 Mar/ });
    expect(
      within(routeTable).getAllByText(
        "Google Flights via SearchApi · indicative price history for 10–20 Mar · economy · point of sale GB · fetched 2h ago · vendor's cache age unknown",
      ),
    ).toHaveLength(3);
    expect(routeTable).toHaveTextContent('Wed 10 Mar 2027');
    // why: decision 54 — a route-level point carries "stale" by fetch age; this fixture's are fresh.
    expect(routeTable).not.toHaveTextContent('stale');
    expect(within(routeTable).queryAllByTestId('provenance')).toHaveLength(0);
  });

  it('"run" means a parent run: on-demand searches are counted apart, and the route view says where offers live (UI-010)', async () => {
    serveRuns([...RUNS, summary({ id: 'child-1', isChild: true })]);
    server.use(http.get(routeRoute, () => HttpResponse.json(threeRuns)));
    const { findByText, getByText } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(
      await findByText('across 4 runs and 1 on-demand search; no single run status applies'),
    ).toBeInTheDocument();
    // why: the route view plots calendar series only; a class-verified offer's history is per itinerary, from Results.
    expect(getByText(COPY.historyView.offersPerItinerary)).toBeInTheDocument();
  });

  it('the header names the definition’s runs from the executions list the status bar uses, never the calendar (decision 52)', async () => {
    const paths: string[] = [];
    serveRuns();
    server.use(
      http.get(routeRoute, () => HttpResponse.json(threeRuns)),
      // why: the calendar route is retired (spec §10, revision 48) and the Dates view's date-pairs route took its
      // place; History reads neither, so a stray request to either fails here rather than passing unnoticed.
      http.get(`${API}/definitions/:id/calendar`, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
      http.get(`${API}/definitions/:id/date-pairs`, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
    );
    const { findByRole, findByText, getByText } = renderWithProviders(
      <HistoryView definition={definition()} />,
    );
    await findByRole('figure', { name: 'Price by fetch date' });
    expect(await findByText(COPY.spanExecutions(4, 0))).toBeInTheDocument();
    expect(getByText('3 runs shown, 23 Sep 2026 to 14 Oct 2026')).toBeInTheDocument();
    expect(getByText(/run started 14 Oct 2026 \d\d:00 Europe\/London/)).toBeInTheDocument();
    expect(paths).toEqual([]);
  });

  it('itinerary mode names the trip from the api, on a fresh load, and badges unconfirmed prices inside their PriceCell', async () => {
    const paths: string[] = [];
    server.use(
      http.get(itineraryRoute, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json(itineraryHistory());
      }),
    );
    // why: decision 52, review prov-005 — no Results row is cached (a bookmark): the api's cell names the trip.
    const { findByRole, getByText } = renderWithProviders(
      <HistoryView definition={definition({ destinationNotes: { JFK: 'onward leg not included' } })} />,
      { search: '?view=history&hash=hash-verified-1' },
    );
    const unconfirmed = await findByRole('table', {
      name: /price not confirmed by the final step: every point/,
    });
    // why: prov-r2-010 — the badge sits inside each unconfirmed price, first, as everywhere else.
    for (const cell of within(unconfirmed).getAllByTestId('price-cell'))
      expect(cell).toHaveTextContent('price not confirmed by the final step');
    const confirmed = await findByRole('table', { name: /Example Travel · economy: every point/ });
    expect(within(confirmed).getAllByTestId('price-cell')[0]).not.toHaveTextContent('price not confirmed');
    expect(getByText('LHR→JFK · Sun 14 Mar 2027 to Sun 28 Mar 2027 · BA')).toBeInTheDocument();
    expect(unconfirmed).toHaveTextContent('JFK');
    expect(getByText('itinerary hash-verified-1')).toBeInTheDocument();
    expect(unconfirmed).toHaveTextContent('onward leg not included');
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('.recharts-line-curve')].map((c) => c.getAttribute('stroke-dasharray')),
      ).toEqual([null, '2 3']),
    );
    expect(paths.at(-1)).toBe('/api/itineraries/hash-verified-1/history');
  });

  it('a history price lacking provenance fails to render: the contract parse refuses it, no amount appears', async () => {
    const [series] = threeRuns.calendarSeries;
    const [point] = series?.points ?? [];
    if (series === undefined || point === undefined) throw new Error('fixture has a calendar point');
    const { provenance: _dropped, ...noProv } = point;
    server.use(
      http.get(routeRoute, () =>
        HttpResponse.json({ ...threeRuns, calendarSeries: [{ ...series, points: [noProv] }] }),
      ),
    );
    const { findByRole, container } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(container).not.toHaveTextContent('£');
  });

  it('historyHref keeps the other URL parameters and sets view and hash', () => {
    window.history.replaceState(null, '', '/?view=results&def=def-0001');
    const p = new URLSearchParams(historyHref('abc 123').split('?')[1]);
    expect([p.get('view'), p.get('hash'), p.get('def')]).toEqual(['history', 'abc 123', 'def-0001']);
  });

  it('the scrolling charts and tables are named regions (review ui I4)', async () => {
    const { findByRole, findAllByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    expect(
      await findByRole('region', { name: COPY.historyView.chartScroll(COPY.historyView.fetchChartTitle) }),
    ).toBeInTheDocument();
    expect(
      await findByRole('region', { name: COPY.historyView.chartScroll(COPY.historyView.routeChartTitle) }),
    ).toBeInTheDocument();
    expect((await findAllByRole('region', { name: /table of points/ })).length).toBeGreaterThan(1);
  });
});

describe('History tables point of sale (spec §11)', () => {
  it('every provider price in the table names its market', async () => {
    const r = routeHistory({
      calendarSeries: [
        {
          providerId: 'travelpayouts',
          cabin: 'economy',
          points: [fetchPoint(2, 39900, cellAt('2027-03-21', 14)), fetchPoint(170, 42000)],
        },
      ],
    });
    server.use(http.get(routeRoute, () => HttpResponse.json(r)));
    const { findByRole } = renderWithProviders(<HistoryView definition={definition()} />);
    const t = await findByRole('table', { name: /Aviasales cache · economy · cheapest calendar price/ });
    const pos = within(t).getAllByTestId('point-of-sale');
    // why: both points are Aviasales calendar prices, whose point of sale is 'unknown'
    expect(pos.map((e) => e.textContent)).toEqual(['market not stated', 'market not stated']);
  });
});
