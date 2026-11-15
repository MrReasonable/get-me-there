import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { asIata, type ConfirmSummary } from '@gmt/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import {
  airportPairIndex,
  at,
  calendarFig,
  DATES_SPACE,
  type DatesOptions,
  figurePairing,
  pairingFig,
  pricedPair,
  provCached,
  provGrid,
  runSummary,
} from '../../fixtures.dates.js';
import { API, definition, execution } from '../../fixtures.js';
import { flightList, flightPair } from '../../fixtures.searches.js';
import { type Requests, serveDatesBy } from '../../msw/datesHandlers.js';
import { serveFlightLists, serveFlightRead } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { settled } from '../../render.js';
import { calendarRows, findLower, findTrips, renderDates, rowText, tripRows } from './render.js';

// Design 2026-11-08 §5.2 (mockup 02), Rulings 3–6, 16, 20–22 and Review Focus 1–3: a search's page's two sections,
// Cheapest trips and Lower on the calendar, built from the shared rows. The exact stopping sentences are pinned in
// logic/confirmWords.test.ts; here the page puts them in the section's lead.

const P = COPY.searchPage;

/** A read trip at `pence` on its airport pair, its pairing's own price and legs (Aer Lingus out, Virgin Atlantic back). */
const trip = (pence: number, over: Parameters<typeof pairingFig>[0] = {}) =>
  pairingFig({
    pairing: figurePairing({ pricePence: pence, fromPence: pence }),
    price: { ...pairingFig().price, pricePence: pence },
    ...over,
  });
/** A calendar price at `pence` from the browser's date grid, 3 h old. */
const cal = (pence: number, over: Parameters<typeof calendarFig>[0] = {}) =>
  calendarFig({
    price: { ...calendarFig().price, pricePence: pence, provenance: provGrid(), ageHours: 3 },
    ...over,
  });
const days = (n: number) => `2027-03-${String(14 + n).padStart(2, '0')}`;
/** `n` trips on consecutive days, £400 upward, 10 nights each. */
const trips = (n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_x, i) => [at(days(i), 10), pricedPair(trip(40_000 + i * 100))]),
  );

/** Serves one read for every scope; with a function the body follows the query. */
function serve(body: DatesOptions | ((q: URLSearchParams) => DatesOptions)) {
  const requests: Requests = [];
  server.use(serveDatesBy(typeof body === 'function' ? body : () => body, requests));
  return requests;
}
const serveRun = (over: Parameters<typeof execution>[0]) =>
  server.use(http.get(`${API}/executions/:id`, () => HttpResponse.json(execution(over))));
const summary = (over: Partial<ConfirmSummary> = {}): ConfirmSummary => ({
  mode: 'confirm',
  confirmed: 5,
  unread: 0,
  uncheckedCheaper: 0,
  stop: 'patience',
  ...over,
});
const flights = (confirm: ConfirmSummary, over: Record<string, unknown> = {}) => ({
  planned: 17,
  read: 17,
  reused: 0,
  failed: 0,
  ended: null,
  confirm,
  stopCause: null,
  ...over,
});
/** The search on one airport pair: its rows name no pair (Ruling 20). */
const ONE_PAIR = definition({ origins: ['LHR'], destinations: ['JFK'] });
const lead = (section: HTMLElement) => section.querySelector('.search-section-sub')?.textContent ?? '';

describe('Cheapest trips (Rulings 4, 20 and 22; mockup 02)', () => {
  it('five rows, then "Show 10 more" adds ten, then what is left, then no button', async () => {
    serve({ pairs: trips(16) });
    const { user } = renderDates();
    const section = await findTrips();
    expect(tripRows(section)).toHaveLength(5);
    await user.click(within(section).getByRole('button', { name: 'Show 10 more' }));
    expect(tripRows(section)).toHaveLength(15);
    await user.click(within(section).getByRole('button', { name: 'Show 1 more' }));
    expect(tripRows(section)).toHaveLength(16);
    expect(within(section).queryByRole('button', { name: /^Show \d+ more$/ })).toBeNull();
  });

  it('each row: the price as its link with one label, the dates, the nights, each way with its airlines, and ›', async () => {
    serve({
      origins: ['LHR'],
      destinations: ['JFK'],
      pairs: { [at('2027-03-14', 10)]: pricedPair(trip(41_200), {}, 1) },
    });
    renderDates({ def: ONE_PAIR });
    const [row] = tripRows(await findTrips());
    if (row === undefined) throw new Error('one trip');
    expect(within(row).getByRole('link', { name: /^£412 · Find on Google Flights/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    expect(within(row).getByTestId('price-label')).toHaveTextContent(/^Seller · 4h/);
    expect(rowText(row)).toContain('Sun 14 Mar → Wed 24 Mar');
    expect(rowText(row)).toMatch(/Out 07:15 → 18:05 · 10h 40m · 1 change · Aer Lingus/);
    expect(rowText(row)).toMatch(/Back 14:20 → 06:25 · 6h 55m · direct · Virgin Atlantic/);
    expect(
      within(row).getByRole('link', { name: 'Details for Sun 14 Mar → Wed 24 Mar' }),
    ).toBeInTheDocument();
  });

  it('the lead: "Flights read for these dates." and the stopping sentence; "these five" only with five shown, unfiltered', async () => {
    serve({ pairs: trips(7) });
    serveRun({ status: 'completed', flights: flights(summary({ confirmed: 7 })) });
    const r = renderDates();
    const section = await findTrips();
    await waitFor(() =>
      expect(lead(section)).toBe(
        'Flights read for these dates. Checked 17 dates; 7 trips with flights read. Reading stopped after 12 reads in a row found nothing cheaper than these five.',
      ),
    );
    r.unmount();
    // a filter applied: the five shown may not be the five cheapest, so the sentence names those
    renderDates({ search: '?view=dates&def=def-0001&d.nights=10-11' });
    const filtered = await findTrips();
    await waitFor(() => expect(lead(filtered)).toMatch(/nothing cheaper than the five cheapest\.$/));
    expect(lead(filtered)).not.toContain('these five');
  });

  it('"these five" still applies when the stay names the search\'s own range (no filter)', async () => {
    serve({ pairs: trips(5) });
    serveRun({ status: 'completed', flights: flights(summary({ confirmed: 5 })) });
    renderDates({ search: '?view=dates&def=def-0001&d.nights=10-21' });
    const section = await findTrips();
    await waitFor(() => expect(lead(section)).toMatch(/nothing cheaper than these five\.$/));
  });

  it('"these five" never when fewer than five trips show', async () => {
    serve({ pairs: trips(4) });
    serveRun({ status: 'completed', flights: flights(summary({ confirmed: 5 })) });
    renderDates();
    const section = await findTrips();
    await waitFor(() => expect(lead(section)).toMatch(/the five cheapest\.$/));
  });

  it('an early stop with dates left unchecked says why and how many', async () => {
    serve({ pairs: trips(1) });
    serveRun({
      status: 'completed',
      flights: flights(summary({ confirmed: 1, uncheckedCheaper: 120, stop: null }), {
        planned: 3,
        read: 3,
        ended: 'stopped',
        stopCause: { kind: 'detail', detail: 'quota' },
      }),
    });
    renderDates();
    const section = await findTrips();
    await waitFor(() =>
      expect(within(section).getByTestId('confirm-line')).toHaveTextContent(
        "Stopped checking flights after 3 dates because the browser worker's plan has no calls left; 1 trip with flights read. 120 dates weren't checked.",
      ),
    );
  });

  it('5 or more trips stopped early: the dates that look cheaper on the calendar, counted', async () => {
    serve({ pairs: trips(6) });
    serveRun({
      status: 'completed',
      flights: flights(summary({ confirmed: 6, uncheckedCheaper: 31, stop: 'returns-stopped' }), {
        planned: 9,
        read: 9,
      }),
    });
    renderDates();
    const section = await findTrips();
    await waitFor(() =>
      expect(within(section).getByTestId('confirm-line')).toHaveTextContent(
        "Stopped checking flights after 9 dates because return flights couldn't be read; 6 trips with flights read. 31 dates that look cheaper on the calendar weren't checked.",
      ),
    );
  });

  it('while the step runs, its running words; a run stored before the change, no sentence at all', async () => {
    serve({ pairs: trips(3), executions: [runSummary({ status: 'running', finishedAt: null })] });
    serveRun({
      status: 'running',
      flights: flights(summary({ confirmed: 3, stop: null }), { planned: 9, read: 9 }),
    });
    const r = renderDates();
    expect(await within(await findTrips()).findByTestId('confirm-line')).toHaveTextContent(
      'Checking flights: 9 dates so far; 3 trips with flights read.',
    );
    r.unmount();
    serve({ pairs: trips(3) });
    serveRun({ status: 'completed', flights: flights(summary(), { confirm: null }) });
    renderDates();
    const section = await findTrips();
    await screen.findByTestId('dates-run');
    expect(within(section).queryByTestId('confirm-line')).toBeNull();
    expect(lead(section)).toBe('Flights read for these dates.');
  });

  it("the over-limit line names the search's limit, or the journey filter applied", async () => {
    const over = { pairingRead: 'over-limit' as const, pairing: figurePairing({ which: 'over-limit' }) };
    const body: DatesOptions = {
      pairs: {
        ...trips(2),
        [at('2027-03-20', 10)]: pricedPair(cal(30_000, over)),
        [at('2027-03-21', 10)]: pricedPair(cal(30_100, over)),
      },
    };
    serve(body);
    const r = renderDates();
    expect(await within(await findTrips()).findByTestId('over-limit')).toHaveTextContent(
      "2 dates' trips are over 25h each way.",
    );
    r.unmount();
    renderDates({ search: '?view=dates&def=def-0001&d.journey=1200' });
    expect(await within(await findTrips()).findByTestId('over-limit')).toHaveTextContent(
      "2 dates' trips are over 20h each way.",
    );
  });

  it('Review Focus 3: calendar prices and no trip: "No flights read yet…", and nothing reads as "no flights"', async () => {
    serve({ pairs: { [at('2027-03-14', 10)]: pricedPair(cal(37_200)) } });
    server.use(serveFlightLists((dep, ret) => flightPair(dep, ret)));
    renderDates();
    await within(await findLower()).findByRole('button', { name: /^Read flights for/ });
    const section = await findTrips();
    expect(lead(section)).toBe(
      'No flights read yet for these dates. Read flights on a date below to see trips with flights read.',
    );
    expect(tripRows(section)).toHaveLength(0);
    expect(section.textContent).not.toMatch(/no flights\b(?! read)/i);
  });

  it('no price at all: the card\'s reason, never "no flights"; in a filter, the filter\'s words with Clear filters', async () => {
    serve({ rest: { empty: 4 } });
    const r = renderDates();
    const section = await findTrips();
    await waitFor(() => expect(lead(section)).not.toBe(''));
    expect(lead(section)).toMatch(/That isn't the same as no flights\.$/);
    r.unmount();
    const { user } = renderDates({ search: '?view=dates&def=def-0001&d.nights=10-10' });
    const filtered = await findTrips();
    expect(lead(filtered)).toBe(P.noPriceInFilters);
    await user.click(within(filtered).getByRole('button', { name: COPY.clearFilters }));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get('d.nights')).toBeNull());
  });

  it('Review Focus 1: trips on different airport pairs link their own booking and their own Details', async () => {
    serve({
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(trip(41_200)),
        [at('2027-03-15', 10)]: pricedPair(
          trip(41_300, {
            origin: asIata('LGW'),
            destination: asIata('EWR'),
            airportPair: airportPairIndex('LGW', 'EWR'),
          }),
        ),
      },
    });
    renderDates();
    const [lhr, lgw] = tripRows(await findTrips());
    if (lhr === undefined || lgw === undefined) throw new Error('two trips');
    expect(within(lhr).getByTestId('row-airports')).toHaveTextContent('LHR → JFK');
    expect(within(lgw).getByTestId('row-airports')).toHaveTextContent('LGW → EWR');
    const book = (row: HTMLElement) => within(row).getAllByRole('link')[0]?.getAttribute('href') ?? '';
    expect(book(lhr)).toContain('LHR');
    expect(book(lgw)).toContain('LGW');
    expect(book(lhr)).not.toBe(book(lgw));
    const details = (row: HTMLElement) =>
      new URL(
        within(row)
          .getByRole('link', { name: /^Details for/ })
          .getAttribute('href') ?? '',
        'http://x',
      ).searchParams;
    expect([details(lhr).get('t.from'), details(lhr).get('t.to')]).toEqual(['LHR', 'JFK']);
    expect([details(lgw).get('t.from'), details(lgw).get('t.to')]).toEqual(['LGW', 'EWR']);
    expect(within(lgw).getByRole('link', { name: /^Details for/ })).toHaveAccessibleName(
      'Details for LGW → EWR, Mon 15 Mar → Thu 25 Mar',
    );
  });
});

/** 155 calendar prices below the cheapest trip (£400), over a window of 10–21 nights. */
const MANY: DatesOptions = {
  space: { ...DATES_SPACE, maxNights: 21 },
  pairs: (i) => (i < 155 ? pricedPair(cal(30_000 + i * 10)) : i === 200 ? pricedPair(trip(40_000)) : {}),
};

describe('Lower on the calendar (Rulings 5 and 20; mockup 02)', () => {
  it('three rows, cheapest first, each saying its read state; "155 dates in all"; "See all on the calendar"', async () => {
    serve(MANY);
    renderDates();
    const section = await findLower();
    const rows = calendarRows(section);
    expect(rows.map((r) => within(r).getByTestId('price-cell').textContent)).toEqual([
      '£300',
      '£300.10',
      '£300.20',
    ]);
    for (const r of rows) expect(r).toHaveTextContent(COPY.readState.words['not-read']);
    expect(lead(section)).toBe(`${P.lowerLead} 155 dates in all.`);
    const all = within(section).getByRole('link', { name: P.seeAll });
    expect(all).toHaveAttribute('href', '#calendar');
    // the calendar carries the anchor
    expect(document.getElementById('calendar')).not.toBeNull();
  });

  it("each row's one line is its read state: not read, return not read, couldn't be read with the reason", async () => {
    serve({
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(cal(30_000)),
        [at('2027-03-15', 10)]: pricedPair(cal(30_100, { pairingRead: 'outbound-only' })),
        [at('2027-03-16', 10)]: pricedPair(
          cal(30_200, { pairingRead: 'list-failed', listReason: 'network' }),
        ),
      },
    });
    renderDates();
    const rows = calendarRows(await findLower());
    expect(rows[0]).toHaveTextContent('Flights not read');
    expect(rows[1]).toHaveTextContent('Return flights not read');
    expect(rows[2]).toHaveTextContent(/Flights couldn't be read: /);
    // a cached price says so by its label
    expect(rows[0]?.querySelector('[data-testid="price-label"]')).toHaveTextContent(/^Calendar · 3h/);
  });

  it('with no trip the lead says these are the lowest calendar prices; the singular count', async () => {
    serve({
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(
          cal(30_000, { price: { ...cal(30_000).price, provenance: provCached() } }),
        ),
      },
    });
    renderDates();
    const section = await findLower();
    expect(lead(section)).toBe(`${P.lowerLeadNoTrip} 1 date in all.`);
    expect(calendarRows(section)[0]?.querySelector('[data-testid="price-label"]')).toHaveTextContent(
      /^Cached/,
    );
  });

  it('Review Focus 1: calendar rows on a search with several airports say their pair', async () => {
    serve({
      pairs: {
        [at('2027-03-14', 10)]: pricedPair(cal(30_000)),
        [at('2027-03-15', 10)]: pricedPair(
          cal(30_100, {
            origin: asIata('LGW'),
            destination: asIata('EWR'),
            airportPair: airportPairIndex('LGW', 'EWR'),
          }),
        ),
      },
    });
    renderDates();
    const rows = calendarRows(await findLower());
    expect(rows.map((r) => within(r).getByTestId('row-airports').textContent)).toEqual([
      'LHR → JFK',
      'LGW → EWR',
    ]);
  });

  it("where flight lists can't be read here: no Read flights, one line saying why", async () => {
    serve({ pairs: { [at('2027-03-14', 10)]: pricedPair(cal(30_000)) } });
    renderDates();
    const section = await findLower();
    expect(await within(section).findByTestId('flights-unavailable')).toHaveTextContent(
      COPY.flights.unavailable,
    );
    expect(within(section).queryByRole('button', { name: /^Read flights/ })).toBeNull();
  });
});

describe('Read flights on a calendar row (spec rev 55 §8.1; Ruling 20)', () => {
  const lowBody: DatesOptions = {
    origins: ['LHR'],
    destinations: ['JFK'],
    pairs: {
      [at('2027-03-14', 10)]: pricedPair(trip(48_000), {}, 1),
      [at('2027-03-15', 10)]: pricedPair(cal(30_000), {}, 1),
    },
  };
  const readBody: DatesOptions = {
    ...lowBody,
    pairs: { ...lowBody.pairs, [at('2027-03-15', 10)]: pricedPair(trip(41_200), {}, 1) },
  };

  it('a press POSTs its dates and airports, says "Reading flights…", and the read landing turns the row into a trip', async () => {
    let landed = false;
    const datePairs: Requests = [];
    server.use(serveDatesBy(() => (landed ? readBody : lowBody), datePairs));
    server.use(
      serveFlightLists((dep, ret) =>
        flightPair(dep, ret, landed ? { list: flightList({ departureDate: dep, returnDate: ret }) } : {}),
      ),
    );
    const posted: unknown[] = [];
    server.use(serveFlightRead({ status: 202 }, posted));
    const { user } = renderDates({ def: ONE_PAIR });
    const lower = await findLower();
    const button = await within(lower).findByRole('button', {
      name: 'Read flights for Mon 15 Mar → Thu 25 Mar',
    });
    // fix round 1 (Important 1): the read's status is one node, mounted before the press and never hidden while empty
    const said = screen.getByTestId('read-said');
    expect(said).toHaveAttribute('role', 'status');
    expect(said).toBeEmptyDOMElement();
    expect(lower.contains(said)).toBe(false);
    landed = true;
    await user.click(button);
    expect(posted).toEqual([
      { departureDate: '2027-03-15', returnDate: '2027-03-25', origin: 'LHR', destination: 'JFK' },
    ]);
    // the newer list lands on the next flight-lists answer; the page then reads its dates again
    await waitFor(() => expect(datePairs.length).toBeGreaterThanOrEqual(2));
    const section = await findTrips();
    await waitFor(() => expect(tripRows(section)).toHaveLength(2));
    expect(rowText(tripRows(section)[0] ?? section)).toContain('Mon 15 Mar → Thu 25 Mar');
    expect(screen.queryByRole('region', { name: P.lowerHeading })).toBeNull();
    expect(await screen.findByText('Flights read for 15 → 25 Mar')).toBe(said);
    // the same element node said it: it stayed mounted while the last lower date left
    expect(screen.getByTestId('read-said')).toBe(said);
  });

  it("the read's status is never display:none (a hidden live region is not announced when it fills)", () => {
    const css = readFileSync(resolve(__dirname, '../../../src/views/Dates/dates.css'), 'utf8');
    const rules = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)].filter(([, sel]) =>
      sel?.includes('search-read-said'),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const [, sel, body] of rules) expect(body, sel).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });

  it("Minor 1 ruling: where flight lists can't be read here, the no-trip lead keeps only its first sentence", async () => {
    serve({ ...lowBody, pairs: { [at('2027-03-15', 10)]: pricedPair(cal(30_000), {}, 1) } });
    const r = renderDates({ def: ONE_PAIR });
    // the default flight lists: not available for this search
    await within(await findLower()).findByTestId('flights-unavailable');
    await waitFor(async () => expect(lead(await findTrips())).toBe(P.noTripLead));
    r.unmount();
    server.use(serveFlightLists((dep, ret) => flightPair(dep, ret)));
    renderDates({ def: ONE_PAIR });
    await within(await findLower()).findByRole('button', { name: /^Read flights for/ });
    expect(lead(await findTrips())).toBe(P.noTrip);
  });

  it('while a read goes the pressed row says so and the other rows wait', async () => {
    const twoLow: DatesOptions = {
      ...lowBody,
      pairs: { ...lowBody.pairs, [at('2027-03-16', 10)]: pricedPair(cal(30_100), {}, 1) },
    };
    serve(twoLow);
    server.use(
      serveFlightLists((dep, ret) => flightPair(dep, ret), {
        reading: { departureDate: '2027-03-15', returnDate: '2027-03-25' },
      }),
    );
    renderDates({ def: ONE_PAIR });
    const lower = await findLower();
    const reading = await within(lower).findByRole('button', { name: COPY.flights.reading });
    expect(reading).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(lower).getByRole('button', { name: 'Read flights for Tue 16 Mar → Fri 26 Mar' }),
    ).toBeDisabled();
  });

  it.each([
    ['browser_busy', COPY.flights.busy],
    ['outside_space', COPY.flights.outsideSpace],
    ['internal', COPY.flights.readFailed],
  ])("a refused read (%s) is said in words, never the api's message", async (code, words) => {
    serve(lowBody);
    server.use(serveFlightLists((dep, ret) => flightPair(dep, ret)));
    server.use(serveFlightRead({ status: 409, code }));
    const { user } = renderDates({ def: ONE_PAIR });
    const lower = await findLower();
    await user.click(await within(lower).findByRole('button', { name: /^Read flights for/ }));
    await waitFor(() => expect(screen.getByTestId('read-said')).toHaveTextContent(words));
    expect(screen.getByTestId('read-said')).toHaveAttribute('role', 'status');
    expect(document.body).not.toHaveTextContent('refused');
  });

  // why: CodeRabbit CR32: the flight lists' answer is awaited (recorded, then handed to the page) before the button
  // is looked for, and the same fixture with readNow true shows it, so the check can fail when the gate is wrong
  it.each([
    [false, 0],
    [true, 1],
  ])(
    'a Read flights button exactly when a read would go for the date now (readNow %s)',
    async (readNow, buttons) => {
      serve(lowBody);
      const asked: URL[] = [];
      server.use(serveFlightLists((dep, ret) => flightPair(dep, ret, { readNow }), {}, asked));
      const { client } = renderDates({ def: ONE_PAIR });
      const lower = await findLower();
      await within(lower).findAllByTestId('calendar-row');
      await waitFor(() => expect(asked.length).toBeGreaterThan(0));
      await settled(client);
      expect(within(lower).queryByTestId('flights-unavailable')).toBeNull();
      expect(within(lower).queryAllByRole('button', { name: /^Read flights/ })).toHaveLength(buttons);
    },
  );
});

describe("the page's words (the plan's main-path words, over the header, the filter row and both sections)", () => {
  const PAGE_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
    ['definition', /\bdefinitions?\b/i],
    ['cell', /\bcells?\b/i],
    ['date pair', /\bdate pairs?\b/i],
    ['basis', /\bbasis\b/i],
    ['discovery', /\bdiscovery\b/i],
    ['itinerary search', /\bitinerary search\b/i],
    ['verdict', /\bverdicts?\b/i],
    ['reused', /\breused\b/i],
    ['superseded', /\bsuperseded\b/i],
    ['billed calls', /\bbilled calls?\b/i],
    ['on-demand', /\bon-demand\b/i],
    ['trips you can book', /\btrips you can book\b/i],
  ];
  const swept = () =>
    [
      screen.getByTestId('dates-head'),
      screen.getByTestId('dates-filters'),
      ...screen.queryAllByTestId('cheapest-trips'),
      ...screen.queryAllByTestId('lower-on-calendar'),
    ]
      .map((el) =>
        [
          el.textContent ?? '',
          ...[...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')),
        ].join('\n'),
      )
      .join('\n');

  it('trips, lower dates, an over-limit line, a journey chip and the run line say none of them', async () => {
    serve({
      pairs: {
        ...trips(6),
        [at('2027-04-01', 10)]: pricedPair(cal(30_000)),
        [at('2027-04-02', 10)]: pricedPair(
          cal(30_000, { pairingRead: 'over-limit', pairing: figurePairing({ which: 'over-limit' }) }),
        ),
        [at('2027-04-03', 10)]: pricedPair(trip(39_000, { fromEarlierSearch: true, superseded: true })),
      },
    });
    serveRun({ status: 'completed', flights: flights(summary({ confirmed: 6, uncheckedCheaper: 3 })) });
    renderDates({ search: '?view=dates&def=def-0001&d.journey=1200' });
    await findLower();
    await screen.findByTestId('dates-run');
    await screen.findByTestId('confirm-line');
    expect(PAGE_WORDS.filter(([, re]) => re.test(swept())).map(([w]) => w)).toEqual([]);
  });

  it('no trip, a running search and a stopped one say none of them either', async () => {
    serve({
      pairs: { [at('2027-03-14', 10)]: pricedPair(cal(30_000)) },
      executions: [runSummary({ status: 'running', finishedAt: null })],
    });
    serveRun({ status: 'running', estimatedFinishAt: '2026-10-14T15:14:00.000Z' });
    const r = renderDates();
    await findLower();
    await screen.findByRole('progressbar');
    expect(PAGE_WORDS.filter(([, re]) => re.test(swept())).map(([w]) => w)).toEqual([]);
    r.unmount();
    serve({
      pairs: { [at('2027-03-14', 10)]: pricedPair(cal(30_000)) },
      executions: [runSummary({ status: 'paused_budget' })],
    });
    serveRun({
      status: 'paused_budget',
      stop: { sentence: 'Stopped at its monthly limit.', fix: { text: 'Search again', command: null } },
    });
    renderDates();
    await screen.findByTestId('stop-sentence');
    expect(PAGE_WORDS.filter(([, re]) => re.test(swept())).map(([w]) => w)).toEqual([]);
  });
});
