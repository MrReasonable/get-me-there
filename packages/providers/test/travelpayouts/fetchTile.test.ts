import { AbortedError, asIata, asIsoDate, BudgetExceeded, cellKeyString, type Iata } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  envelope,
  errorOf,
  eventsOf,
  type Harness,
  makeHarness,
  makeProvider,
  NOW,
  only,
  query,
  row,
  tileOf,
} from './harness.js';

const covered = cellsOf(query());

/** Synthetic rows cycling over the 33 covered cells, every one inside the band; `origin` picks the airport. */
function rowsFor(n: number, offset = 0, origin = 'LHR'): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => {
    const c = covered[(i + offset) % covered.length];
    if (c === undefined) throw new Error('no covered cell');
    return row({
      origin,
      dest: c.destination,
      dep: c.departureDate,
      ret: c.returnDate,
      price: 300 + ((i + offset) % 50),
    });
  });
}
const pageOf = (request: Request) => new URL(request.url).searchParams.get('page') ?? '?';
const tileIndexes = (h: Harness, type: 'reserve' | 'cache-hit') => eventsOf(h, type).map((e) => e.tileIndex);

describe('fetchTile pagination (spec §5.2: one tile, every page ledgered under its tile_index)', () => {
  it('fetches page 2 after a full page of 1000 and stops at a short page (synthetic 1000 + 3)', async () => {
    const pages: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : rowsFor(3, 1000)));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = tileOf(await d.fetchTile(tile, q, ctx()));
    expect(pages).toEqual(['1', '2']);
    // two upstream attempts, both first attempts under the tile's index, at zero cost, each finalised once
    expect(eventsOf(h, 'reserve').map((e) => [e.tileIndex, e.httpAttempt, e.costMicroGbp])).toEqual([
      [tile.index, 1, 0],
      [tile.index, 1, 0],
    ]);
    expect(eventsOf(h, 'finalise')).toHaveLength(2);
    expect(r.prices).toHaveLength(1003);
    expect(r.truncated).toBeUndefined();
    expect(r.notes).toEqual(['pages:2', 'rows-received:1003']);
  });

  it('a full last page costs one more request that returns zero rows', async () => {
    const pages: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const page = pageOf(request);
        pages.push(page);
        return HttpResponse.json(envelope(page === '1' ? rowsFor(1000) : []));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(pages).toEqual(['1', '2']);
    expect(r.prices).toHaveLength(1000);
    expect(r.notes).toEqual(['pages:2', 'rows-received:1000']);
  });

  it(`stops at MAX_PAGES (${MAX_PAGES}): rows read still price their cells; every other covered cell is an upstream issue, never no_data (ruling 10)`, async () => {
    // every page carries 1000 rows over cells 0..5: cells 0..4 priced, cell 5 only with price 0 (distinct prices per
    // page, so no page repeats)
    const firstSix = covered.slice(0, 6);
    server.use(
      http.get(TP, ({ request }) => {
        const n = Number(pageOf(request));
        const data = Array.from({ length: 1000 }, (_, i) => {
          const c = firstSix[i % 6];
          if (c === undefined) throw new Error('no cell');
          const price = i % 6 === 5 ? 0 : 300 + n + (i % 7);
          return row({ origin: 'LHR', dest: 'JFK', dep: c.departureDate, ret: c.returnDate, price });
        });
        return HttpResponse.json(envelope(data));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const tile = only(d.plan(q));
    const r = tileOf(await d.fetchTile(tile, q, ctx()));
    expect(eventsOf(h, 'reserve')).toHaveLength(MAX_PAGES);
    expect(tileIndexes(h, 'reserve').every((i) => i === tile.index)).toBe(true);
    expect(new Set(r.prices.map(cellKeyString))).toEqual(new Set(firstSix.slice(0, 5).map(cellKeyString)));
    const [badPrice, ...unread] = r.cellIssues ?? [];
    // the cell whose rows were all unusable keeps its parse issue; it is not reported twice
    expect(badPrice).toMatchObject({ cell: firstSix[5], reason: 'parse' });
    expect(unread).toHaveLength(covered.length - 6);
    expect(
      unread.every(
        (i) =>
          i.reason === 'upstream' &&
          i.offersDropped === 0 &&
          i.detail === `pagination truncated at ${MAX_PAGES} pages`,
      ),
    ).toBe(true);
    expect(r.notes).toContain(`pages-truncated:${MAX_PAGES}`);
    // ruling 5: priced cells hold the cheapest of the rows read, and the tile says so
    expect(r.truncated).toBe(true);
  });

  it(`a short page at MAX_PAGES (${MAX_PAGES}) is the last page, not a truncation (ts2-004)`, async () => {
    server.use(
      http.get(TP, ({ request }) => {
        const n = Number(pageOf(request));
        return HttpResponse.json(envelope(n < MAX_PAGES ? rowsFor(1000, n) : rowsFor(999, n)));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(eventsOf(h, 'reserve')).toHaveLength(MAX_PAGES);
    expect(r.truncated).toBeUndefined();
    expect(r.cellIssues).toBeUndefined();
    expect(r.notes.some((n) => n.startsWith('pages-truncated'))).toBe(false);
  });

  it('BudgetExceeded on page 2 propagates; page 1 prices are never returned as a partial tile (ts2-004)', async () => {
    let hits = 0;
    server.use(
      http.get(TP, ({ request }) => {
        hits += 1;
        return HttpResponse.json(envelope(pageOf(request) === '1' ? rowsFor(1000) : rowsFor(3)));
      }),
    );
    const h = makeHarness({ refuse: 2 });
    const d = discoveryOf(makeProvider(h));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx())).rejects.toBeInstanceOf(BudgetExceeded);
    // the budget is the hard stop: one reservation, and exactly one HTTP request reached the vendor (ts3-002)
    expect(eventsOf(h, 'reserve')).toHaveLength(1);
    expect(hits).toBe(1);
  });

  it('an abort between page 1 and page 2 raises AbortedError, sends no page 2 and returns no page-1 prices (ts3-001)', async () => {
    const ac = new AbortController();
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        return HttpResponse.json(envelope(rowsFor(1000)));
      }),
    );
    const h = makeHarness();
    // why: the abort lands after page 1 has fully arrived and before page 2 is asked for, not while a fetch is in flight
    const kit = h.http;
    h.http = {
      request: async (r) => {
        const res = await kit.request(r);
        ac.abort();
        return res;
      },
      stats: () => kit.stats(),
    };
    const d = discoveryOf(makeProvider(h));
    const q = query();
    await expect(d.fetchTile(only(d.plan(q)), q, ctx(ac.signal))).rejects.toBeInstanceOf(AbortedError);
    expect(hits).toBe(1);
    expect(eventsOf(h, 'reserve')).toHaveLength(1);
  });

  it('a vendor that ignores `page` (the same full page again) is a parse error, not a silent loop', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        return HttpResponse.json(envelope(rowsFor(1000)));
      }),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'parse',
      reason: 'parse',
      message: expect.stringContaining('[page-repeated]'),
    });
    expect(hits).toBe(2);
  });

  it('stamps fetchedAt with the oldest page (spec §2), which differs from the newest here', async () => {
    const h = makeHarness();
    server.use(
      http.get(TP, ({ request }) => {
        if (pageOf(request) === '1') return HttpResponse.json(envelope(rowsFor(1000)));
        return HttpResponse.json(envelope(rowsFor(3)));
      }),
    );
    // why: the clock moves between the two pages, so page 2's fetchedAt is later and only "oldest" gives NOW.
    const kit = h.http;
    h.http = {
      request: async (r) => {
        const res = await kit.request(r);
        h.clock.advance(60_000);
        return res;
      },
      stats: () => kit.stats(),
    };
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.fetchedAt).toBe(NOW);
    expect(h.clock.now()).toBe('2026-10-14T15:02:00.000Z');
  });
});

describe('currency on every page (spec §2: a response that states no currency is a parse error)', () => {
  it('passes a non-GBP currency through unconverted (upper-cased ISO code); FX is WP7 normalisation', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope(
            [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 500 })],
            'usd',
          ),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.prices.map((p) => [p.amountMinor, p.currency])).toEqual([[50000, 'USD']]);
  });

  it('rows under an envelope without currency are a parse error', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json({
          success: true,
          data: [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })],
        }),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'parse',
      retryable: false,
      message: expect.stringContaining('[currency-missing]'),
    });
  });

  it('page 2 with rows and no currency is a parse error; its rows never take page 1’s currency (prov-wp06-002)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(
          pageOf(request) === '1' ? envelope(rowsFor(1000)) : { success: true, data: rowsFor(3) },
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain('[currency-missing]');
  });

  it('a currency core does not know is a tile with per-cell currency-unsupported issues, never a tile error (plan decision 29)', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope(
            [row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 500 })],
            'qqq',
          ),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.prices).toEqual([]);
    expect(r.cellIssues).toEqual([
      expect.objectContaining({ reason: 'currency-unsupported', offersDropped: 1 }),
    ]);
  });

  it('a currency that changes between pages is a parse error', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3), 'eur')),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain(
      '[currency-changed-between-pages]',
    );
  });
});

describe('fetchTile returns raw vendor shapes (spec §2, §5.2 "Raw only")', () => {
  it('keys prices by the response dates, reports a covered cell whose only row was unusable, and counts the rest in notes', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }),
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-13', ret: '2027-03-24', price: 0 }),
          ]),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r.prices).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 41200,
        currency: 'GBP',
        vendorLink: 'https://www.aviasales.com/search/synthetic?t=1',
      },
    ]);
    // the 13 → 24 March cell had a row, so the engine records it error (reason parse), never no_data (spec §8.1)
    expect(r.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-13', returnDate: '2027-03-24' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[bad-price]'),
      },
    ]);
    expect(r.noFares).toEqual([]);
    expect(r.pointOfSale).toBe('unknown');
    expect(r.notes).toEqual(['dropped-outside-band:1', 'offers-dropped:1', 'pages:1', 'rows-received:3']);
  });

  it('a malformed row anywhere makes the tile a parse error: its cells cannot be told apart', async () => {
    server.use(
      http.get(TP, () =>
        HttpResponse.json(
          envelope([
            row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
            { price: 1 },
          ]),
        ),
      ),
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = query();
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx())).message).toContain('[malformed-row]');
  });
});

/** The worked example's pairs over its 182-day window, 10–21 nights. */
const workedQuery = (origin: Iata, destination: Iata) =>
  query({
    origin,
    destination,
    departureFrom: asIsoDate('2027-01-01'),
    departureTo: asIsoDate('2027-07-01'),
    minNights: 10,
    maxNights: 21,
  });

describe('estimate parity: every airport pair is its own request (plan decision 34, spec §5.2 rev 17, §8.1)', () => {
  it('worked example: 28 tiles, 28 upstream calls, 0 cache hits, every ledger row under its own tile index', async () => {
    const upstream: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const u = new URL(request.url);
        upstream.push(
          `${u.searchParams.get('origin')}|${u.searchParams.get('destination')}|${u.searchParams.get('departure_at')}`,
        );
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    let tiles = 0;
    for (const origin of [asIata('LHR'), asIata('LGW')]) {
      for (const destination of [asIata('JFK'), asIata('EWR')]) {
        const q = workedQuery(origin, destination);
        for (const p of d.plan(q)) {
          tiles += 1;
          const before = h.events.length;
          tileOf(await d.fetchTile(p, q, ctx()));
          // each tile leaves exactly one ledger row (an upstream reserve) with its own index
          const rows = h.events.slice(before).filter((e) => e.type === 'reserve' || e.type === 'cache-hit');
          expect(
            rows.map((e) => (e.type === 'reserve' || e.type === 'cache-hit' ? e.tileIndex : null)),
          ).toEqual([p.index]);
        }
      }
    }
    expect(tiles).toBe(28);
    expect(upstream).toHaveLength(28);
    expect(new Set(upstream).size).toBe(28);
    expect(upstream.some((s) => s.startsWith('LON|'))).toBe(false);
    expect(eventsOf(h, 'reserve')).toHaveLength(28);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(0);
  });

  it('a repeat of a 2-page tile inside the TTL (a re-run) is one cache-hit row, not one per page (plan decision 24)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3, 7))),
      ),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    for (let i = 0; i < 2; i += 1) tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    // parity = upstream tile (1) + cache-hit rows (1) = the two fetches of the tile
    expect(eventsOf(h, 'reserve')).toHaveLength(2);
    expect(new Set(tileIndexes(h, 'reserve')).size).toBe(1);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(1);
    expect(h.requests.map((r) => [r.url.searchParams.get('page'), r.ledgerCacheHit])).toEqual([
      ['1', true],
      ['2', false],
      ['1', true],
      ['2', false],
    ]);
  });

  it('known gap, pinned so a fix flips it on purpose: page 1 cached but page 2 expired counts the tile twice in parity (ts2-004)', async () => {
    server.use(
      http.get(TP, ({ request }) =>
        HttpResponse.json(pageOf(request) === '1' ? envelope(rowsFor(1000)) : envelope(rowsFor(3))),
      ),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    // page 2's cache entry expires before the repeat reads it
    const page2 = h.cache.sets[1];
    if (page2 === undefined) throw new Error('page 2 was not cached');
    h.cache.entries.delete(page2.key);
    tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    // the repeat leaves a cache-hit row (page 1) and an upstream row (page 2) under one tile index
    expect(eventsOf(h, 'cache-hit')).toHaveLength(1);
    expect(eventsOf(h, 'reserve')).toHaveLength(3);
  });

  it('each airport pair sends its own origin and prices only that airport', async () => {
    const sent: string[] = [];
    server.use(
      http.get(TP, ({ request }) => {
        const origin = new URL(request.url).searchParams.get('origin') ?? '?';
        sent.push(origin);
        return HttpResponse.json(
          envelope([
            row({
              origin,
              dest: 'JFK',
              dep: '2027-03-12',
              ret: '2027-03-23',
              price: origin === 'LHR' ? 412 : 377,
            }),
          ]),
        );
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const lhrQ = query({ origin: asIata('LHR') });
    const lgwQ = query({ origin: asIata('LGW') });
    const lhr = tileOf(await d.fetchTile(only(d.plan(lhrQ)), lhrQ, ctx()));
    const lgw = tileOf(await d.fetchTile(only(d.plan(lgwQ)), lgwQ, ctx()));
    expect(sent).toEqual(['LHR', 'LGW']);
    expect(lhr.prices.map((p) => [p.origin, p.amountMinor])).toEqual([['LHR', 41200]]);
    expect(lgw.prices.map((p) => [p.origin, p.amountMinor])).toEqual([['LGW', 37700]]);
    expect(eventsOf(h, 'fetch')).toHaveLength(2);
    expect(eventsOf(h, 'cache-hit')).toHaveLength(0);
  });

  it.each<[string, { origin?: string; destination?: string }]>([
    ['a metro code as the origin, answered with a different airport', { origin: 'LON' }],
    ['a metro code as the destination, answered with a different airport', { destination: 'NYC' }],
  ])(
    'refuses %s loudly: a parse tile-error, never every covered cell read as no_data (decision 35)',
    async (_label, over) => {
      server.use(
        http.get(TP, () =>
          HttpResponse.json(
            envelope([
              row({ origin: 'LTN', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
              row({ origin: 'LHR', dest: 'EWR', dep: '2027-03-12', ret: '2027-03-23', price: 400 }),
            ]),
          ),
        ),
      );
      const d = discoveryOf(makeProvider(makeHarness()));
      const q = query({
        ...(over.origin === undefined ? {} : { origin: asIata(over.origin) }),
        ...(over.destination === undefined ? {} : { destination: asIata(over.destination) }),
      });
      expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
        kind: 'parse',
        reason: 'parse',
        retryable: false,
        message: expect.stringContaining('[airport-mismatch]'),
      });
    },
  );
});
