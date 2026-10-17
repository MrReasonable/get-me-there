import { within } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { DurationTooltip } from '../../src/views/Duration/DurationChart.js';
import { DurationView } from '../../src/views/Duration/DurationView.js';
import { barValue, buildDurationData, gapLabel, rowAt } from '../../src/views/Duration/data.js';
import { API, definition } from '../fixtures.js';
import { bare, cellAt, durationResponse, night, priceAt, provSyntheticAt } from '../fixtures.wp10.js';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';

// 10: both priced; 11: discovery searched, no itinerary search; 12: calendar only, itinerary-searched, no price;
// 13: nothing searched; 14: omitted by the api.
const resp = durationResponse([
  night(10, [52000, 3], [41200, 5]),
  night(11, null, null, { verification: false, travelpayouts: true }),
  night(
    12,
    null,
    [39900, 4],
    { verification: true, travelpayouts: true },
    cellAt('2027-03-20', 12, 'LGW', 'EWR'),
  ),
  night(13, null, null, { verification: false, travelpayouts: false }),
]);
const route = `${API}/definitions/:id/duration-analysis`;
const def = definition({
  minNights: 10,
  maxNights: 14,
  destinationNotes: { EWR: 'onward leg not included' },
});
const data = () => buildDurationData(resp, 10, 14, true);

describe('duration data (spec §11 View C; plan decision 38)', () => {
  it('one row per nights in range; missing prices are null gaps, never 0, never interpolated', () => {
    const d = data();
    expect(d.rows.map((r) => barValue(r, 'verified'))).toEqual([52000, null, null, null, null]);
    expect(d.rows.map((r) => r.nights)).toEqual([10, 11, 12, 13, 14]);
    expect(d.rows.map((r) => r.cells.verified?.price?.pricePence ?? null)).toEqual([
      52000,
      null,
      null,
      null,
      null,
    ]);
    expect(d.rows.map((r) => r.cells['calendar:travelpayouts']?.price?.pricePence ?? null)).toEqual([
      41200,
      null,
      39900,
      null,
      null,
    ]);
  });
  it('gaps are per series: not searched versus searched with no price, by stage', () => {
    const d = data();
    const verified = d.rows.map((r) => gapLabel(r.cells.verified, 'verified'));
    const calendar = d.rows.map((r) => gapLabel(r.cells['calendar:travelpayouts'], 'calendar'));
    expect(verified.slice(1)).toEqual([
      'not itinerary-searched',
      'itinerary-searched, no class-verified price',
      'not itinerary-searched',
      'not itinerary-searched',
    ]);
    // why: N1 (ruling 4): the calendar series names its buckets; "searched" is View D's word alone.
    expect(calendar.slice(1)).toEqual([
      '48 no cached data',
      '48 no cached data',
      'not searched',
      'not searched',
    ]);
    expect(d.rows.map((r) => r.anySearched)).toEqual([true, true, true, false, false]);
  });
  it('a partly searched nights value says k of N, never "searched, no price" for the whole stay length (prov-r2-007)', () => {
    const partly = buildDurationData(
      durationResponse([night(10, null, null, { verification: [1, 4], travelpayouts: [3, 48] })]),
      10,
      10,
      true,
    );
    const [row] = partly.rows;
    expect(gapLabel(row?.cells.verified, 'verified')).toBe(
      'itinerary-searched 1 of 4 selected cells, no class-verified price',
    );
    expect(gapLabel(row?.cells['calendar:travelpayouts'], 'calendar')).toBe(
      '3 no cached data, 45 not searched',
    );
    expect(gapLabel(undefined, 'calendar')).toBe('not searched');
  });
  it('a stay length whose cells all came back "no cached data" never reads as searched (N1, ruling 4)', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json(
          durationResponse([
            night(10, [52000, 3], [41200, 5]),
            night(11, null, null, { verification: false, travelpayouts: true }),
          ]),
        ),
      ),
    );
    const { findByRole } = renderWithProviders(
      <DurationView definition={definition({ minNights: 10, maxNights: 11 })} />,
    );
    const table = await findByRole('table', { name: 'Cheapest found per stay length, with provenance' });
    expect(table).toHaveTextContent('48 no cached data');
    expect(
      document.body.textContent?.replaceAll('not searched', '').replaceAll('itinerary-searched', ''),
    ).not.toMatch(/\bsearched\b/);
  });

  it('counts the prices shown and the stale ones; the tooltip row is found by label, never by cast', () => {
    const d = data();
    expect([d.shownPrices, d.stalePrices]).toEqual([3, 0]);
    expect(rowAt(d.rows, 12)?.nights).toBe(12);
    expect(rowAt(d.rows, '12')?.nights).toBe(12);
    expect(rowAt(d.rows, null)).toBeUndefined();
  });
  it('names the series from the prices’ own provenance, with n in the label', () => {
    expect(data().series.map((s) => s.name)).toEqual([
      'min among verified (class verified, n=3)',
      'calendar, Aviasales cache (constraints not checked, n=9)',
    ]);
    const at = cellAt('2027-03-14', 10);
    const synthetic = durationResponse([
      {
        nights: 10,
        minVerified: null,
        minCalendar: [
          {
            providerId: 'fixture',
            price: { ...bare(priceAt(30000, provSyntheticAt(1), false, at)), cell: at, superseded: false },
            n: 2,
          },
        ],
        searched: {
          verification: { searched: 0, total: 4 },
          discovery: [
            {
              providerId: 'fixture',
              searched: 48,
              total: 48,
              buckets: { priced: 2, empty: 0, no_data: 46, error: 0, skipped: 0, not_run: 0, reused: 0 },
            },
          ],
        },
      },
    ]);
    expect(buildDurationData(synthetic, 10, 10, false).series.map((s) => s.name)).toEqual([
      'calendar, synthetic fixture data (constraints not checked, n=2)',
    ]);
  });
  it('omits the verified series when there is no verification provider and nothing verified; empty with no price', () => {
    expect(
      buildDurationData(durationResponse([night(10, null, [41200, 5])]), 10, 14, false).series.map(
        (s) => s.key,
      ),
    ).toEqual(['calendar:travelpayouts']);
    expect(buildDurationData(durationResponse([night(10, null, null)]), 10, 14, true).isEmpty).toBe(true);
  });
  it('the tooltip shows each price through PriceCell with its provenance marks, n and departure date, or the gap by kind', () => {
    const d = data();
    const notes = def.destinationNotes;
    const tip = renderWithProviders(<DurationTooltip active label={10} data={d} notes={notes} />).getByTestId(
      'duration-tooltip',
    );
    expect(tip).toHaveTextContent('10 nights');
    // why: decision 52, review prov-r2-003 — a tooltip fare is a PriceCell: badge, destination, age in its title.
    const cells = within(tip).getAllByTestId('price-cell');
    expect(cells.map((c) => c.textContent)).toEqual([
      expect.stringContaining('£520'),
      expect.stringContaining('£412'),
    ]);
    expect(cells[0]).toHaveTextContent("vendor's cache age unknown");
    expect(cells[1]).toHaveClass('border-dashed');
    expect(cells[1]).toHaveTextContent('JFK');
    expect(tip).toHaveTextContent('n=3 · departs Sun 14 Mar');
    expect(tip).toHaveTextContent('n=5 · departs Sun 14 Mar');
    const gap = renderWithProviders(
      <DurationTooltip active label="12" data={d} notes={notes} />,
    ).getAllByTestId('duration-tooltip')[1];
    if (gap === undefined) throw new Error('second tooltip');
    expect(gap).toHaveTextContent('min among verified: itinerary-searched, no class-verified price');
    expect(within(gap).getByTestId('price-cell').getAttribute('title')).toContain('onward leg not included');
    expect(gap).toHaveTextContent('n=4 · departs Sat 20 Mar');
    const none = renderWithProviders(
      <DurationTooltip active label={13} data={d} notes={notes} />,
    ).getAllByTestId('duration-tooltip')[2];
    expect(none).toHaveTextContent('calendar, Aviasales cache: not searched');
  });
  it('the tooltip renders nothing when inactive or off the data', () => {
    expect(
      renderWithProviders(<DurationTooltip active={false} label={10} data={data()} notes={{}} />).container,
    ).toBeEmptyDOMElement();
    expect(
      renderWithProviders(<DurationTooltip active label={99} data={data()} notes={{}} />).container,
    ).toBeEmptyDOMElement();
  });
});

describe('Duration view (spec §11 View C)', () => {
  it('shows an explicit loading state', () => {
    server.use(
      http.get(route, async () => {
        await delay('infinite');
        return HttpResponse.json(resp);
      }),
    );
    expect(renderWithProviders(<DurationView definition={def} />).getByRole('status')).toHaveTextContent(
      'Loading…',
    );
  });
  it('shows an error state', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 }),
      ),
    );
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByRole('alert'),
    ).toHaveTextContent('Could not load: boom');
  });
  it('shows an explicit empty state and no chart', async () => {
    server.use(http.get(route, () => HttpResponse.json(durationResponse([]))));
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByText(
        /^No prices yet for any stay length/,
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('.recharts-responsive-container')).toBeNull();
  });

  it('draws a named chart with axis titles, a legend carrying n, starred ticks, no "£" and no bar for a gap', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const figure = await findByRole('figure', { name: 'Cheapest found by stay length' });
    expect(figure).toHaveAccessibleDescription(/Cheapest found per stay length, with provenance/);
    expect(figure).toHaveTextContent('n = priced cells behind each minimum');
    // why: recharts draws legend icons as svgs too; the chart surface is the one with role="application".
    const svg = figure.querySelector('svg[role="application"]');
    expect(svg?.textContent).toContain('nights');
    expect(svg?.textContent).toContain('13*');
    // why: UI-008: the note's example is a symbol, never a numeral the chart may show as a searched tick.
    expect(COPY.durationView.chartNote).not.toMatch(/\d+\*/);
    expect(svg?.textContent).toContain('14*');
    expect(svg?.textContent).not.toContain('11*');
    // why: decision 52 — axis ticks print pounds without the sign; the figure carries no sweep exemption.
    expect(svg?.textContent).toContain('price (GBP)');
    expect(svg?.textContent).not.toContain('£');
    expect(figure).not.toHaveAttribute('data-scale');
    const legend = figure.querySelector('.recharts-legend-wrapper')?.textContent ?? '';
    expect(legend).toContain('min among verified (class verified, n=3)');
    expect(legend).toContain('calendar, Aviasales cache (constraints not checked, n=9)');
    // why: three non-null values (10 verified, 10 and 12 calendar): a gap must never be drawn as a zero-height bar.
    expect(figure.querySelectorAll('.recharts-rectangle')).toHaveLength(3);
    const [verifiedBars, calendarBars] = [...figure.querySelectorAll('.recharts-bar')];
    expect(verifiedBars?.querySelectorAll('.recharts-rectangle')).toHaveLength(1);
    const dashed = [...(calendarBars?.querySelectorAll('.recharts-rectangle') ?? [])].map((b) =>
      b.getAttribute('stroke-dasharray'),
    );
    expect(dashed).toEqual(['4 2', '4 2']);
    // why: review ui M8 — the dash is a calendar bar's only non-colour cue, so it is 2 px, not 1.
    expect(
      [...(calendarBars?.querySelectorAll('.recharts-rectangle') ?? [])].map((b) =>
        b.getAttribute('stroke-width'),
      ),
    ).toEqual(['2', '2']);
    expect(verifiedBars?.querySelector('.recharts-rectangle')?.getAttribute('stroke-width')).toBe('1');
  });

  it('a stale minimum is drawn faded with a heavy outline', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json(
          durationResponse([
            {
              ...night(10, null, [41200, 5]),
              minCalendar: [
                {
                  providerId: 'travelpayouts',
                  price: {
                    ...bare(priceAt(41200, provSyntheticAt(400), true, cellAt('2027-03-14', 10))),
                    cell: cellAt('2027-03-14', 10),
                    superseded: false,
                  },
                  n: 5,
                },
              ],
            },
          ]),
        ),
      ),
    );
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const figure = await findByRole('figure');
    const bar = figure.querySelector('.recharts-rectangle');
    expect(bar?.getAttribute('stroke-width')).toBe('2');
    expect(bar?.getAttribute('fill-opacity')).toBe('0.3');
  });

  it('tables every price with provenance, destination and note, n and departure date; each gap by kind; nights link to Results', async () => {
    server.use(http.get(route, () => HttpResponse.json(resp)));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />, {
      search: '?view=duration&def=def-0001',
    });
    const table = await findByRole('table', { name: 'Cheapest found per stay length, with provenance' });
    const provs = within(table).getAllByTestId('provenance');
    expect(provs).toHaveLength(3);
    expect(table).toHaveTextContent('EWR');
    expect(table).toHaveTextContent('onward leg not included');
    expect(table).toHaveTextContent('n=4 · departs Sat 20 Mar');
    for (const gap of [
      'not itinerary-searched',
      'itinerary-searched, no class-verified price',
      '48 no cached data',
      'not searched',
    ])
      expect(table).toHaveTextContent(gap);
    const link =
      within(table).getByRole('link', { name: '12 nights: show in results' }).getAttribute('href') ?? '';
    const p = new URLSearchParams(link.split('?')[1]);
    expect(p.get('view')).toBe('results');
    expect(p.get('f.nights')).toBe('12-12');
    expect(p.get('def')).toBe('def-0001');
  });

  it('decision 54: a verified minimum not seen in the latest search and a superseded calendar minimum say so', async () => {
    const [first] = resp.byNights;
    if (first === undefined || first.minVerified === null) throw new Error('fixture has a verified minimum');
    const [cal] = first.minCalendar;
    if (cal === undefined) throw new Error('fixture has a calendar minimum');
    const marked = {
      ...first,
      minVerified: { ...first.minVerified, notSeenInLatest: { ageHours: 30 } },
      minCalendar: [{ ...cal, price: { ...cal.price, superseded: true } }],
    };
    server.use(http.get(route, () => HttpResponse.json({ ...resp, byNights: [marked] })));
    const { findByRole } = renderWithProviders(<DurationView definition={def} />);
    const table = await findByRole('table', { name: 'Cheapest found per stay length, with provenance' });
    const [verified, calendar] = within(table).getAllByTestId('price-cell');
    expect(verified).toHaveTextContent('not seen in latest search (30h ago)');
    expect(calendar).toHaveTextContent('superseded by a later search');
  });

  it('a duration price lacking provenance fails to render: the contract parse refuses it, no amount appears', async () => {
    const [first] = resp.byNights;
    if (first?.minVerified == null) throw new Error('fixture has a verified minimum');
    const { provenance: _dropped, ...noProv } = first.minVerified;
    server.use(
      http.get(route, () => HttpResponse.json({ ...resp, byNights: [{ ...first, minVerified: noProv }] })),
    );
    const { findByRole, container } = renderWithProviders(<DurationView definition={def} />);
    expect(await findByRole('alert')).toHaveTextContent(/^Could not load:/);
    expect(container).not.toHaveTextContent('£');
  });

  it('says how many shown prices are stale', async () => {
    server.use(
      http.get(route, () =>
        HttpResponse.json(
          durationResponse(
            [night(10, [52000, 3], [41200, 5])].map((n) => ({
              ...n,
              minVerified: n.minVerified === null ? null : { ...n.minVerified, stale: true },
            })),
          ),
        ),
      ),
    );
    expect(
      await renderWithProviders(<DurationView definition={def} />).findByText(
        '1 of 2 shown prices are stale (older than one refresh cycle by fetch age plus any known vendor age)',
      ),
    ).toBeInTheDocument();
  });

  it('the scrolling chart and table are named regions (review ui I4)', async () => {
    const { findByRole } = renderWithProviders(<DurationView definition={definition()} />);
    expect(await findByRole('region', { name: COPY.durationView.chartScroll })).toBeInTheDocument();
    expect(await findByRole('region', { name: COPY.durationView.tableScroll })).toBeInTheDocument();
  });
});
