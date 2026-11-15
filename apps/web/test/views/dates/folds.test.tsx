import { asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords, isoDateTimeOfEpochMs } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { COPY } from '../../../src/copy.js';
import {
  at,
  calendarFig,
  pricedPair,
  provCached,
  provSynthetic,
  runSummary,
  workedDates,
} from '../../fixtures.dates.js';
import { API, execution, statusReport } from '../../fixtures.js';
import { latestRun, searchCard } from '../../fixtures.searches.js';
import { cellAt, fetchPoint, routeHistory } from '../../fixtures.wp10.js';
import { datesError, serveDates } from '../../msw/datesHandlers.js';
import { serveCards } from '../../msw/searchesHandlers.js';
import { server } from '../../msw/server.js';
import { NOW } from '../../render.js';
import { jargonIn, mainPathWords } from './jargon.js';
import { findTrips, renderDates } from './render.js';

// Trips and Search plan, Task 10 (Ruling 19): the three folds under the calendar. Native details rows, closed by
// default; Price over time lists this search's runs only, What was searched counts the latest run's whole space, Alert
// states the search's rules in words.

const F = COPY.searchPage.folds;
const real = { discoveryProviders: ['travelpayouts' as const] };

/** The search's runs, newest first, as the date-pairs read lists them. */
const runs = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    runSummary({
      id: `exec-${i + 1}`,
      ageHours: (i + 1) * 24,
      startedAt: isoDateTimeOfEpochMs(Date.parse(NOW) - (i + 1) * 24 * 3_600_000),
    }),
  );

/** A history point of run `k`, fetched k days before the tests' clock, lowest cell price `pence`. */
const point = (k: number, pence: number, over: Parameters<typeof fetchPoint>[3] = {}) =>
  fetchPoint(k * 24, pence, cellAt('2027-03-14', 14), { executionId: `exec-${k}`, ...over });

const serveHistory = (
  points: ReturnType<typeof point>[],
  provider: 'travelpayouts' | 'camoufox' = 'travelpayouts',
) =>
  server.use(
    http.get(`${API}/routes/:origin/:destination/history`, () =>
      HttpResponse.json(
        routeHistory({ calendarSeries: [{ providerId: provider, cabin: 'economy', points }] }),
      ),
    ),
  );

const fold = (name: string | RegExp) => {
  const summary = screen.getByText((_, el) => el?.tagName === 'SUMMARY' && matches(el.textContent, name));
  const details = summary.closest('details');
  if (details === null) throw new Error(`no fold ${String(name)}`);
  return details;
};
const matches = (text: string | null, name: string | RegExp) =>
  name instanceof RegExp ? name.test(text ?? '') : (text ?? '').startsWith(name);

/** The worked search's card: its latest run's marks over 2,184 dates (the remainder not reached), counts consistent. */
const card = (over: Partial<ReturnType<typeof latestRun>['marks']> = {}) => {
  const marks = {
    priced: 2146,
    'no-price-shown': 28,
    'couldnt-read': 0,
    'not-reached': 10,
    'not-searched': 0,
    ...over,
  };
  const total = Object.values(marks).reduce((n, v) => n + v, 0);
  return searchCard({
    readDates: 23,
    latestRun: latestRun({
      datePairs: total,
      datePairsSearched: marks.priced + marks['no-price-shown'],
      datePairsNeverSearched: marks['not-searched'],
      marks,
    }),
  });
};

describe('the three folds (Ruling 19)', () => {
  it('are one group of native details rows, closed by default, each summary with its one-line state', async () => {
    serveHistory([point(1, 37_200)]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    const group = await screen.findByTestId('search-folds');
    const rows = group.querySelectorAll(':scope > details');
    expect(rows).toHaveLength(3);
    for (const d of rows) expect(d).not.toHaveAttribute('open');
    // why: a cached price's age is its fetch age plus the cache's own bound (48h), so 24h fetched reads 3d
    await waitFor(() =>
      expect(rows[0]?.querySelector('summary')).toHaveTextContent(
        'Price over time · lowest calendar price £372, 13 Oct · Cached · 3d',
      ),
    );
    expect(rows[1]?.querySelector('summary')).toHaveTextContent(
      'What was searched · 2,146 of 2,184 dates priced, 38 not',
    );
    expect(rows[2]?.querySelector('summary')).toHaveTextContent('Alert · off');
  });
});

describe('Price over time', () => {
  it('lists up to six of this search’s runs, newest first, never another search’s points on the same route', async () => {
    // eight of this search's runs, each lowest at £400 + k; another search's run is the cheapest of all
    serveHistory([
      ...Array.from({ length: 8 }, (_, i) => point(i + 1, 40_000 + (i + 1) * 100)),
      point(3, 100, { executionId: 'another-search' }),
    ]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(8) } });
    await findTrips();
    const open = await screen.findByText(F.priceOverTime);
    open.closest('details')?.setAttribute('open', '');
    const list = within(await screen.findByRole('list', { name: F.priceHeading }));
    const items = list.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(items.map((li) => /^\d+ \w+ · £\d+/.exec(li.textContent ?? '')?.[0])).toEqual([
      '13 Oct · £401',
      '12 Oct · £402',
      '11 Oct · £403',
      '10 Oct · £404',
      '9 Oct · £405',
      '8 Oct · £406',
    ]);
    // the other search's £1 point is in no row, and not the summary's lowest
    expect(screen.queryByText(/£1\b/)).toBeNull();
  });

  it('gives each point its label: Cached for the cache, Calendar for the browser, age, and the truncated mark', async () => {
    serveHistory([point(1, 37_200, { truncated: true }), point(2, 38_000)]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(2) } });
    await findTrips();
    fold(F.priceOverTime).setAttribute('open', '');
    const items = within(await screen.findByRole('list', { name: F.priceHeading })).getAllByRole('listitem');
    const labels = items.map((li) => within(li).getByTestId('price-label'));
    expect(labels[0]).toHaveTextContent('Cached · 3d');
    expect(items[0]).toHaveTextContent(COPY.truncatedNote);
    expect(labels[1]).toHaveTextContent('Cached · 4d');
  });

  it('a browser calendar point says Calendar, and a stale one says why in its label’s name', async () => {
    serveHistory(
      [
        point(1, 37_200, {
          stale: 'refresh',
          provenance: provCached({
            providerId: 'camoufox',
            sourceKind: 'scraped-self',
            fetchedAt: asIsoDateTime('2026-10-13T15:00:00.000Z'),
            maxAgeHours: 0,
          }),
        }),
      ],
      'camoufox',
    );
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    fold(F.priceOverTime).setAttribute('open', '');
    const label = within(await screen.findByRole('list', { name: F.priceHeading })).getByTestId(
      'price-label',
    );
    expect(label).toHaveTextContent('Calendar · 24h');
    expect(within(label).getByText(/./, { selector: 'summary' })).toHaveAttribute(
      'aria-label',
      expect.stringContaining('older than'),
    );
  });

  it('says these are calendar prices, links the full history, and keeps the read-trip line out', async () => {
    serveHistory([point(1, 37_200)]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    const d = fold(F.priceOverTime);
    expect(within(d).getByText(F.priceNotTrips)).toBeInTheDocument();
    const link = within(d).getByRole('link', { name: F.fullHistory });
    const href = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(href.searchParams.get('view')).toBe('history');
    expect(href.searchParams.get('def')).toBe('def-0001');
  });

  it('a synthetic point raises the banner', async () => {
    serveHistory([point(1, 37_200, { provenance: provSynthetic() })]);
    server.use(serveCards([card()]));
    renderDates({
      body: {
        ...workedDates(real),
        executions: runs(1),
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(
            calendarFig({ price: { ...calendarFig().price, provenance: provCached() } }),
          ),
        },
      },
    });
    await findTrips();
    expect(await screen.findByText(/^Synthetic data: the fixture provider is enabled/)).toBeInTheDocument();
  });

  it('with no history yet it says so and has no lowest price', async () => {
    serveHistory([]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    await waitFor(() => expect(fold(F.priceOverTime)).toHaveTextContent(F.priceNone));
  });
});

describe('What was searched', () => {
  it('says what the latest run found over its whole space: five marks summing to the total, then flights read', async () => {
    server.use(serveCards([card({ 'couldnt-read': 5, 'not-reached': 5 })]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^What was searched · 2,146 of 2,184/));
    const rows = within(d)
      .getAllByRole('row')
      .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent?.trim()));
    expect(rows.map((r) => r.slice(0, 2))).toEqual([
      [F.marks.priced, '2,146'],
      [F.marks['no-price-shown'], '28'],
      [F.marks['couldnt-read'], '5'],
      [F.marks['not-reached'], '5'],
      [F.marks['not-searched'], '0'],
      [F.flightsRead, '23 dates'],
    ]);
    // the first five sum to the total the summary names
    const sum = rows.slice(0, 5).reduce((n, r) => n + Number((r[1] ?? '0').replace(/,/g, '')), 0);
    expect(sum).toBe(2184);
  });

  it('adds the thin-coverage line only when most searched dates had no price listed', async () => {
    server.use(serveCards([card({ priced: 100, 'no-price-shown': 2046, 'not-reached': 38 })]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    await screen.findByText(F.thin);
  });

  it('has no thin-coverage line when prices were mostly found', async () => {
    server.use(serveCards([card()]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    await waitFor(() => fold(/^What was searched · 2,146/));
    expect(screen.queryByText(F.thin)).toBeNull();
  });

  it('"Full search log" opens the coverage section inside the fold', async () => {
    server.use(serveCards([card()]));
    const { user } = renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^What was searched/));
    const toggle = within(d).getByRole('button', { name: F.fullLog });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(await within(d).findByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: F.hideLog })).toHaveAttribute('aria-expanded', 'true');
    // final review I2: the log's open state is the page's own, never in the URL, so it never travels to another search
    expect(new URLSearchParams(window.location.search).has('d.coverage')).toBe(false);
  });
});

describe('opening a fold from a link', () => {
  it('the run line’s "what was searched" opens the fold, scrolls to it and focuses its summary', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    server.use(serveCards([card()]));
    const { user } = renderDates({ body: workedDates(real) });
    await findTrips();
    scroll.mockClear();
    await user.click(
      await within(await screen.findByTestId('dates-run')).findByRole('link', {
        name: COPY.searchPage.whatWasSearched,
      }),
    );
    const d = await waitFor(() => fold(/^What was searched/));
    await waitFor(() => expect(d).toHaveAttribute('open'));
    expect(d.querySelector('summary')).toHaveFocus();
    expect(scroll.mock.contexts).toContain(d);
    scroll.mockRestore();
  });

  it('?view=coverage lands on the fold, open, with the full log shown, and the landing is consumed', async () => {
    server.use(serveCards([card()]));
    const before = window.history.length;
    renderDates({ body: workedDates(real), search: '?view=dates&def=def-0001&d.coverage=open' });
    const d = await waitFor(() => fold(/^What was searched/));
    await waitFor(() => expect(d).toHaveAttribute('open'));
    expect(await within(d).findByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    expect(d.querySelector('summary')).toHaveFocus();
    // final review I2: asked once, like d.fold: replaced out of the URL, the log kept open
    expect(window.location.search).toBe('?view=dates&def=def-0001');
    expect(window.history.length).toBe(before);
    expect(within(d).getByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
  });
});

describe('Alert', () => {
  const rule = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    definitionId: 'def-0001',
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
    ...over,
  });
  const serveRules = (rules: unknown[]) =>
    server.use(http.get(`${API}/alerts`, () => HttpResponse.json(rules)));

  it('is off with no rules, says what alerts watch, links Change alerts to this search', async () => {
    server.use(serveCards([card()]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert · off/));
    expect(within(d).getByText(F.alertWatches)).toBeInTheDocument();
    const href = new URL(
      within(d).getByRole('link', { name: F.changeAlerts }).getAttribute('href') ?? '',
      'http://x',
    );
    expect(href.searchParams.get('view')).toBe('alerts');
    expect(href.searchParams.get('def')).toBe('def-0001');
    expect(within(d).getByText(F.alertNone)).toBeInTheDocument();
  });

  it('says "Alert · N on" and each rule in words, never "basis"', async () => {
    serveRules([
      rule(),
      rule({
        id: 'r2',
        type: 'dropPct',
        thresholdPence: null,
        pct: 10,
        basis: 'verified',
        requireAllVerified: false,
      }),
    ]);
    server.use(serveCards([card()]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert · 2 on/));
    // one of the two rules watches trips with flights read, so the calendar-prices line would be wrong
    expect(within(d).queryByText(F.alertWatches)).toBeNull();
    const items = within(d).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(
      'Price at or below £450 · calendar prices, limits not checked · at most one email every 14 days',
    );
    expect(items[1]).toHaveTextContent(
      'Drop by percent 10% · flights read · at most one email every 14 days',
    );
  });

  it('a rule switched off is not on', async () => {
    serveRules([rule({ enabled: false })]);
    server.use(serveCards([card()]));
    renderDates({ body: workedDates(real) });
    await findTrips();
    await waitFor(() => fold(/^Alert · off/));
  });

  it('says email is not set up only for the check that is off as not set up', async () => {
    server.use(
      serveCards([card()]),
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'no email' },
          ]),
        ),
      ),
    );
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert/));
    const link = await within(d).findByRole('link', { name: F.emailSetUp });
    expect(new URL(link.getAttribute('href') ?? '', 'http://x').searchParams.get('view')).toBe('status');
    expect(within(d).getByText(F.emailNotSet)).toBeInTheDocument();
  });

  it.each([
    ['disabled', { state: 'off' as const, offReason: 'disabled' as const }],
    ['working', { state: 'ok' as const, offReason: null }],
  ])('says nothing of email when its check is %s', async (_name, over) => {
    server.use(
      serveCards([card()]),
      http.get(`${API}/status`, () =>
        HttpResponse.json(statusReport([{ id: 'email', area: 'email', summary: 'email', ...over }])),
      ),
    );
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert/));
    await waitFor(() => expect(within(d).queryByText(F.emailNotSet)).toBeNull());
    expect(within(d).queryByRole('link', { name: F.emailSetUp })).toBeNull();
  });
});

describe('Alert, the calendar-prices line and the cooldown in words', () => {
  const calendarRule = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    definitionId: 'def-0001',
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
    ...over,
  });

  it('says what alerts watch when every listed rule watches calendar prices', async () => {
    server.use(
      serveCards([card()]),
      http.get(`${API}/alerts`, () => HttpResponse.json([calendarRule(), calendarRule({ id: 'r2' })])),
    );
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert · 2 on/));
    expect(within(d).getByText(F.alertWatches)).toBeInTheDocument();
  });

  it('words the cooldown in days, in hours when it is not a whole number of days, and one day as a day', async () => {
    server.use(
      serveCards([card()]),
      http.get(`${API}/alerts`, () =>
        HttpResponse.json([
          calendarRule({ id: 'r1', cooldownHours: 24 }),
          calendarRule({ id: 'r2', cooldownHours: 100 }),
        ]),
      ),
    );
    renderDates({ body: workedDates(real) });
    await findTrips();
    const d = await waitFor(() => fold(/^Alert · 2 on/));
    const items = within(d).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('at most one email a day');
    expect(items[1]).toHaveTextContent('at most one email every 100 hours');
  });
});

describe('Price over time, review fixes', () => {
  it('orders the runs by the run and dates each by its start, however late its lowest price was fetched', async () => {
    // exec-1 is the newer run; its lowest price was fetched earlier than exec-2's
    serveHistory([
      point(1, 37_200, { at: isoDateTimeOfEpochMs(Date.parse(NOW) - 40 * 3_600_000) }),
      point(2, 38_000),
    ]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(2) } });
    await findTrips();
    const items = within(await screen.findByRole('list', { name: F.priceHeading })).getAllByRole('listitem');
    expect(items.map((li) => /^\d+ \w+ · £\d+/.exec(li.textContent ?? '')?.[0])).toEqual([
      '13 Oct · £372',
      '12 Oct · £380',
    ]);
  });

  it('says a stale lowest price’s words in the summary, not by colour alone, and the row says them once', async () => {
    serveHistory([point(1, 37_200, { stale: 'refresh' })]);
    server.use(serveCards([card()]));
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    const d = await waitFor(() => {
      const el = fold(F.priceOverTime);
      expect(el.querySelector('summary .sr-only')).not.toBeNull();
      return el;
    });
    expect(d.querySelector('summary .sr-only')).toHaveTextContent('older than');
    const row = within(d).getByRole('listitem');
    expect(row.querySelector('.sr-only')).toBeNull();
  });

  it('shows the runs that loaded beside the error of the airport pair that did not', async () => {
    server.use(
      serveCards([card()]),
      http.get(`${API}/routes/:origin/:destination/history`, ({ params }) =>
        params.origin === 'LGW' && params.destination === 'EWR'
          ? HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })
          : HttpResponse.json(
              routeHistory({
                calendarSeries: [
                  { providerId: 'travelpayouts', cabin: 'economy', points: [point(1, 37_200)] },
                ],
              }),
            ),
      ),
    );
    renderDates({ body: { ...workedDates(real), executions: runs(1) } });
    await findTrips();
    const d = await waitFor(() => fold(F.priceOverTime));
    expect(await within(d).findByRole('alert')).toBeInTheDocument();
    expect(within(d).getByRole('list', { name: F.priceHeading })).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('picks up the run that finishes on the page: its row appears when the page re-reads at the run’s end', async () => {
    let finished = false;
    server.use(
      serveCards([card()]),
      http.get(`${API}/routes/:origin/:destination/history`, () =>
        HttpResponse.json(
          routeHistory({
            calendarSeries: [
              {
                providerId: 'travelpayouts',
                cabin: 'economy',
                points: finished ? [point(1, 37_200, { executionId: 'exec-0001' })] : [],
              },
            ],
          }),
        ),
      ),
      http.get(`${API}/executions/:id`, () => HttpResponse.json(execution({ status: 'running' }))),
    );
    const { client } = renderDates({
      body: { ...workedDates(real), executions: [runSummary({ status: 'running', finishedAt: null })] },
    });
    await findTrips();
    await waitFor(() => expect(client.getQueryData(['execution', 'exec-0001'])).toBeDefined());
    const d = fold(F.priceOverTime);
    await waitFor(() => expect(d).toHaveTextContent(F.priceNone));
    finished = true;
    await act(async () => {
      client.setQueryData(['execution', 'exec-0001'], execution({ status: 'completed' }));
    });
    expect(await within(d).findByRole('list', { name: F.priceHeading })).toBeInTheDocument();
  });
});

describe('the folds with the date-pairs read failing or over the bound (review I1)', () => {
  const tooMany = () =>
    datesError(422, 'too_many_cells', 'the scope has 100000 cells, above 50000', {
      cells: 100_000,
      bound: 50_000,
    });

  it('over the bound: the folds are there, and d.coverage=open finds the full search log', async () => {
    server.use(tooMany(), serveCards([card()]));
    renderDates({ search: '?view=dates&def=def-0001&d.coverage=open' });
    expect(await screen.findByRole('table', { name: COPY.coverageHeading })).toBeInTheDocument();
    const d = fold(/^What was searched/);
    await waitFor(() => expect(d).toHaveAttribute('open'));
    expect(d.querySelector('summary')).toHaveFocus();
    expect(fold(/^Alert/)).toBeInTheDocument();
  });

  it('a failed read: the folds are there, with the counts from the card and no flights count from the page', async () => {
    server.use(datesError(500, 'internal', 'boom'), serveCards([card()]));
    renderDates({});
    const d = await waitFor(() => fold(/^What was searched · 2,146/));
    expect(within(d).getByText(F.flightsRead)).toBeInTheDocument();
    expect(fold(F.priceOverTime)).toBeInTheDocument();
  });

  it('after narrowing the scope the old landing does not pull the page back to the log', async () => {
    server.use(tooMany(), serveCards([card()]));
    renderDates({ search: '?view=dates&def=def-0001&d.coverage=open' });
    const d = await waitFor(() => fold(/^What was searched/));
    await waitFor(() => expect(d).toHaveAttribute('open'));
    d.removeAttribute('open');
    d.ownerDocument.body.focus();
    // the landing was consumed, so the narrowed URL no longer asks for the log
    expect(new URLSearchParams(window.location.search).has('d.coverage')).toBe(false);
    server.use(serveDates(workedDates(real)));
    window.history.replaceState(null, '', '/?view=dates&def=def-0001&d.from=LHR');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await findTrips();
    expect(d).not.toHaveAttribute('open');
  });
});

describe('the folds’ words', () => {
  it('say no banned word, no set-up term and no "£" outside a price, open or closed', async () => {
    serveHistory([point(1, 37_200, { truncated: true })]);
    server.use(
      serveCards([card({ priced: 100, 'no-price-shown': 2046, 'not-reached': 38 })]),
      http.get(`${API}/alerts`, () =>
        HttpResponse.json([
          {
            id: 'r1',
            definitionId: 'def-0001',
            type: 'absolute',
            thresholdPence: 45_000,
            pct: null,
            basis: 'calendar',
            requireAllVerified: null,
            cooldownHours: 336,
            enabled: true,
          },
          {
            id: 'r2',
            definitionId: 'def-0001',
            type: 'absolute',
            thresholdPence: 40_000,
            pct: null,
            basis: 'verified',
            requireAllVerified: true,
            cooldownHours: 336,
            enabled: true,
          },
        ]),
      ),
      http.get(`${API}/status`, () =>
        HttpResponse.json(
          statusReport([
            { id: 'email', area: 'email', state: 'off', offReason: 'not-set-up', summary: 'no email' },
          ]),
        ),
      ),
    );
    renderDates({ body: { ...workedDates(real), executions: runs(2) } });
    await findTrips();
    await screen.findByText(F.emailNotSet);
    for (const d of document.querySelectorAll('details.sfold')) d.setAttribute('open', '');
    const root = await screen.findByTestId('search-folds');
    expect(findBannedWords(root.textContent ?? '', BANNED_WORD_ALLOWLIST).map((h) => h.word)).toEqual([]);
    expect(jargonIn(mainPathWords(root))).toEqual([]);
    expect(mainPathWords(root)).not.toMatch(/\bbasis\b/i);
  });
});
