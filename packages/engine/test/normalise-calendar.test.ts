import { asIsoDate, asIsoDateTime, cellKeyString, isTruncated, type RawCalendarPrice } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../src/context.js';
import { calendarPriceInGbp, FX_SOURCE, reduceTile, vendorLinkOf } from '../src/normalise.js';
import { newRun } from '../src/run.js';
import { commitTile, normaliseDeps } from '../src/stages/discovery.js';
import { createHarness, discoveryOf, FIXTURE_RULES, type Harness, JFK, LHR } from './support/harness.js';
import { mapPrices, mapTiles } from './support/wrappers.js';

const USD_NANO = 787_401_575; // 1 / 1.27 GBP per USD × 1e9
const cell = {
  origin: LHR,
  destination: JFK,
  departureDate: asIsoDate('2026-11-02'),
  returnDate: asIsoDate('2026-11-09'),
};
const price = (amountMinor: number, currency = 'GBP'): RawCalendarPrice => ({
  ...cell,
  amountMinor,
  currency,
  returnDateSource: 'vendor',
  vendorPriceMark: null,
});
const deps = (h: Harness) => normaliseDeps(buildContext(h.deps, h.options));
const reasonOf = (r: ReturnType<typeof calendarPriceInGbp>): string => {
  if (!('reason' in r)) throw new Error('expected a refusal');
  return r.reason;
};

describe('calendarPriceInGbp (spec §5.6 money, §6.3)', () => {
  it('GBP passes through unconverted', () => {
    const h = createHarness();
    expect(calendarPriceInGbp(deps(h), 41_200, 'gbp')).toEqual({
      pricePence: 41_200,
      fx: { converted: false },
    });
  });
  it('an ECB currency with a fresh rate converts and records rate, date and source together (52 000 US cents → 40 945 pence)', () => {
    const h = createHarness();
    h.repos.fx.upsert([
      { date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    expect(calendarPriceInGbp(deps(h), 52_000, 'USD')).toEqual({
      pricePence: 40_945,
      fx: { converted: true, rateNano: USD_NANO, rateDate: h.clock.todayLondon(), source: FX_SOURCE },
    });
  });
  it('FX_MAX_RATE_AGE_DAYS 3: a 3-day-old rate converts; a 4-day-old or a future-dated one is fx-unavailable', () => {
    const h = createHarness(); // today (London) 2026-10-14
    h.repos.fx.upsert([
      { date: asIsoDate('2026-10-11'), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    expect(calendarPriceInGbp(deps(h), 52_000, 'USD')).toMatchObject({ pricePence: 40_945 });
    h.repos.fx.upsert([
      { date: asIsoDate('2026-10-10'), currency: 'EUR', rateNano: 860_000_000, source: FX_SOURCE },
      { date: asIsoDate('2026-10-15'), currency: 'CAD', rateNano: 540_000_000, source: FX_SOURCE },
    ]);
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'EUR'))).toBe('fx-unavailable');
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'CAD'))).toBe('fx-unavailable');
  });
  it('a currency outside the ECB list → currency-unsupported', () => {
    const h = createHarness();
    expect(reasonOf(calendarPriceInGbp(deps(h), 52_000, 'ARS'))).toBe('currency-unsupported');
  });
  it('an amount that is not a non-negative integer → parse, in GBP too; never a stored price (arch-r2-002)', () => {
    const h = createHarness();
    expect(reasonOf(calendarPriceInGbp(deps(h), -100, 'GBP'))).toBe('parse');
    expect(reasonOf(calendarPriceInGbp(deps(h), 99.5, 'GBP'))).toBe('parse');
  });
});

describe('reduceTile (spec §5.6 "one calendar price per tile … minimum amountMinor, tie-break on vendor order")', () => {
  it('keeps the minimum, keeps the earlier of equal prices, and counts discards', () => {
    const a = price(500);
    const b = price(400);
    const c = { ...price(400), vendorLink: 'later' };
    const r = reduceTile([a, b, c]);
    if (r.kind !== 'ok') throw new Error('expected one currency');
    expect(r.discarded).toBe(2);
    expect(r.perCell.get(cellKeyString(cell))).toBe(b);
  });
  it('two currencies in one tile is reported, not reduced', () => {
    expect(reduceTile([price(500, 'GBP'), price(600, 'usd')])).toEqual({
      kind: 'mixed-currency',
      currencies: ['GBP', 'USD'],
    });
  });
});

describe('vendorLinkOf (spec §5.2 vendor links)', () => {
  it('keeps only https links on the provider allowlist (core LINK_ALLOWLIST)', () => {
    expect(vendorLinkOf('https://www.aviasales.com/search/LHR0211JFK09111', 'travelpayouts')).toBe(
      'https://www.aviasales.com/search/LHR0211JFK09111',
    );
    expect(vendorLinkOf('http://www.aviasales.com/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://evil.example/x', 'travelpayouts')).toBeNull();
    expect(vendorLinkOf('https://www.aviasales.com/x', 'fixture')).toBeNull(); // the fixture's allowlist is empty
    expect(vendorLinkOf(undefined, 'searchapi')).toBeNull();
  });
});

describe('discovery normalisation through the engine', () => {
  it('every price in USD with no rate → each priced cell becomes error fx-unavailable through writeTileError; no price row; the run completes, never paused (po-009)', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(e.status).toBe('completed');
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors).toHaveLength(28);
    expect(errors.every((o) => o.reason === 'fx-unavailable' && o.attempts === 1)).toBe(true);
    expect(h.count('calendar_prices', e.id)).toBe(0);
  });

  it('with a fresh USD rate the same prices are stored converted, with fx columns set together', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'USD' })) });
    h.repos.fx.upsert([
      { date: h.clock.todayLondon(), currency: 'USD', rateNano: USD_NANO, source: FX_SOURCE },
    ]);
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const rows = h.repos.calendarPrices.fetchedBy(e.id);
    expect(rows).toHaveLength(28);
    // why: an independent figure — the fixture formula (base 41 200 + 7 nights × 900) makes the cheapest cell 47 500 cents
    expect(Math.min(...rows.map((r) => r.priceNativeMinor))).toBe(47_500);
    expect(Math.min(...rows.map((r) => r.pricePence))).toBe(37_402);
    for (const row of rows) {
      expect(row).toMatchObject({
        currencyNative: 'USD',
        fx: { converted: true, rateNano: USD_NANO, rateDate: h.clock.todayLondon(), source: FX_SOURCE },
      });
    }
    expect(h.outcomes(e.id, { status: 'priced' }).every((o) => o.minPence !== null)).toBe(true);
  });

  it('a negative amount fails only its own cell (parse), never pauses the run (arch-r2-002)', async () => {
    const h = createHarness({
      transformFixture: (p) =>
        mapPrices(p, (x) => (cellKeyString(x) === cellKeyString(cell) ? { ...x, amountMinor: -1 } : x)),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    expect(e.status).toBe('completed');
    expect(h.outcomes(e.id, { status: 'error' })).toEqual([
      expect.objectContaining({ ...cell, reason: 'parse', attempts: 1 }),
    ]);
    expect(h.count('calendar_prices', e.id)).toBe(27);
  });

  it("a row's providerObservedAt (decision 35: the day Aviasales found the fare) reaches calendar_prices unchanged", async () => {
    const found = asIsoDateTime('2026-10-09T00:00:00.000Z');
    const h = createHarness({
      transformFixture: (p) => mapPrices(p, (x) => ({ ...x, providerObservedAt: found })),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const rows = h.repos.calendarPrices.fetchedBy(e.id);
    expect(rows).toHaveLength(28);
    expect(
      rows.every((r) => r.providerObservedAt === found && r.provenance.providerObservedAt === found),
    ).toBe(true);
  });

  it('a currency outside the ECB list → error currency-unsupported', async () => {
    const h = createHarness({ transformFixture: (p) => mapPrices(p, (x) => ({ ...x, currency: 'ARS' })) });
    const e = await h.runToCompletion(h.orch(), h.createDefinition().id);
    const errors = h.outcomes(e.id, { status: 'error' });
    expect(errors).toHaveLength(28);
    expect(errors.every((o) => o.reason === 'currency-unsupported')).toBe(true);
  });

  it('a tile mixing two currencies is a parse error for its cells; over an already-priced cell it only counts an attempt (ssr-02)', async () => {
    const h = createHarness();
    await h.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const ctx = buildContext(h.deps, h.options);
    const r = await h.orch().start(h.createDefinition().id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    // why: both tiles must be held before the release, or a tile requested after it would wait forever
    await vi.waitFor(() => expect(h.requests.filter((q) => q.kind === 'calendar')).toHaveLength(2));
    const exec = h.repos.executions.get(r.executionId);
    if (exec === null) throw new Error('missing execution');
    const mixed = {
      kind: 'tile' as const,
      index: 0,
      coveredCells: [cell],
      fetchedAt: h.clock.now(),
      pointOfSale: 'unknown',
      prices: [price(500, 'GBP'), price(600, 'USD')],
      noFares: [],
      notes: [],
    };
    commitTile(
      ctx,
      newRun(ctx, exec, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      discoveryOf(h.fixture).info,
      mixed,
    );
    const before = h
      .outcomes(r.executionId, { stage: 'discovery' })
      .find((x) => cellKeyString(x) === cellKeyString(cell));
    expect(before).toMatchObject({ status: 'error', reason: 'parse', attempts: 1 });
    expect(before?.lastError).toContain('mixed currencies: GBP, USD');
    await h.releaseHolds();
    const done = await h.waitForSettled(r.executionId);
    expect(h.outcomes(done.id).find((x) => cellKeyString(x) === cellKeyString(cell))).toMatchObject({
      status: 'priced',
      attempts: 1,
    });
    commitTile(
      ctx,
      newRun(ctx, done, { manual: true, fresh: false, blocked: new Set() }),
      'fixture',
      discoveryOf(h.fixture).info,
      mixed,
    );
    // why: an error never displaces a stronger outcome; it only counts a failed attempt (decision 17, WP3 merge)
    expect(h.outcomes(done.id).find((x) => cellKeyString(x) === cellKeyString(cell))).toMatchObject({
      status: 'priced',
      attempts: 2,
    });
  });

  it('cellIssues (decision 28): dropped rows beside a price stay priced with offers-dropped:n; a cell with no price is an error, never no_data', async () => {
    const days = {
      window: { kind: 'absolute' as const, from: cell.departureDate, to: cell.departureDate },
      minNights: 7,
      maxNights: 9,
    };
    const nine = { ...cell, returnDate: asIsoDate('2026-11-11') };
    const eight = { ...cell, returnDate: asIsoDate('2026-11-10') };
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile'
            ? r
            : {
                ...r,
                // why: the adapter dropped the 8-night row and never read the 9-night one; it kept the 7-night price
                prices: r.prices.filter((x) => cellKeyString(x) === cellKeyString(cell)),
                cellIssues: [
                  { cell, reason: 'parse', offersDropped: 2, detail: 'two rows without a price' },
                  { cell: eight, reason: 'parse', offersDropped: 1, detail: 'a row without a price' },
                  { cell: nine, reason: 'upstream', offersDropped: 0, detail: 'left unread by the page cap' },
                ],
              },
        ),
    });
    const e = await h.runToCompletion(h.orch(), h.createDefinition(days).id);
    expect(e.status).toBe('completed');
    const byCell = new Map(h.outcomes(e.id).map((o) => [cellKeyString(o), o]));
    expect(byCell.get(cellKeyString(cell))).toMatchObject({ status: 'priced', reason: 'offers-dropped:2' });
    expect(byCell.get(cellKeyString(eight))).toMatchObject({
      status: 'error',
      reason: 'parse',
      lastError: 'a row without a price',
    });
    expect(byCell.get(cellKeyString(nine))).toMatchObject({
      status: 'error',
      reason: 'upstream',
      lastError: 'left unread by the page cap',
    });
    expect(h.count('calendar_prices', e.id)).toBe(1);
  });

  it('a truncated tile (decision 30): its prices are labelled "cheapest of the rows read"; its unread cells are upstream errors', async () => {
    const eight = { ...cell, returnDate: asIsoDate('2026-11-10') };
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile'
            ? r
            : {
                ...r,
                truncated: true,
                prices: r.prices.filter((x) => cellKeyString(x) === cellKeyString(cell)),
                cellIssues: [
                  {
                    cell: eight,
                    reason: 'upstream',
                    offersDropped: 0,
                    detail: 'left unread by the page cap',
                  },
                ],
              },
        ),
    });
    const e = await h.runToCompletion(
      h.orch(),
      h.createDefinition({ window: { kind: 'absolute', from: cell.departureDate, to: cell.departureDate } })
        .id,
    );
    const byCell = new Map(h.outcomes(e.id).map((o) => [cellKeyString(o), o]));
    expect(byCell.get(cellKeyString(cell))).toMatchObject({
      status: 'priced',
      reason: null,
      lastError: 'cheapest of the rows read',
    });
    // why: WP8 reads outcomes through this repository and maps them with core's isTruncated to `truncated`
    // (decisions 36, 37, 47), so the label must lead the column read back there
    const read = h.repos.cells.outcomes(e.id, { stage: 'discovery', cells: [cell] });
    expect(read).toHaveLength(1);
    expect(isTruncated(read[0]?.lastError ?? null)).toBe(true);
    expect(byCell.get(cellKeyString(eight))).toMatchObject({
      status: 'error',
      reason: 'upstream',
      lastError: 'left unread by the page cap',
    });
  });

  it('a truncated tile that leaves an unread cell out of cellIssues still never makes it reusable no_data (prov M1)', async () => {
    const eight = { ...cell, returnDate: asIsoDate('2026-11-10') };
    const h = createHarness({
      transformFixture: (p) =>
        mapTiles(p, (r) =>
          r.kind !== 'tile'
            ? r
            : {
                ...r,
                truncated: true,
                prices: r.prices.filter((x) => cellKeyString(x) === cellKeyString(cell)),
                cellIssues: [],
              },
        ),
    });
    const e = await h.runToCompletion(
      h.orch(),
      h.createDefinition({ window: { kind: 'absolute', from: cell.departureDate, to: cell.departureDate } })
        .id,
    );
    // why: the coverage check treats such a cell as not checked; the outcome must agree, so it is fetched again
    expect(h.outcomes(e.id).find((o) => cellKeyString(o) === cellKeyString(eight))).toMatchObject({
      status: 'error',
      reason: 'upstream',
      lastError: 'pagination truncated: cell left unread',
    });
  });
});
