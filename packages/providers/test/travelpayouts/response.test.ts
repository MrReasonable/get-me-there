import { asIata, asIsoDateTime, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  attributeRows,
  cacheableBody,
  currencyOf,
  itineraryOf,
  readEnvelope,
  searchedAt,
  vendorLinkFor,
} from '../../src/travelpayouts/response.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { asProviderError } from '../support/guards.js';
import { cellsFor, envelope, query, row } from './harness.js';

const covered: CellKey[] = cellsOf(query());
const GBP = { code: 'GBP', exponent: 2 };
const FETCHED = '2026-10-15T03:50:00.000Z' as const;
const input = {
  fetchedAt: asIsoDateTime(FETCHED),
  coveredCells: covered,
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  minNights: 10,
  maxNights: 12,
  currency: GBP,
};
const LINK = 'https://www.aviasales.com/search/synthetic?t=1';
/** The harness's default row link for an LHR → JFK row: a readable closed itinerary (pie-002). */
const ROW_LINK =
  'https://www.aviasales.com/search/X?t=ZZ18146070001814617500000475LHRJFK18158511001815894900000430JFKLHR_1d1bd24f_58507';
const thrown = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return asProviderError(e);
  }
  throw new Error('expected a throw');
};

describe('attributeRows: cell keys from the response, filtered to the pair (spec §5.2)', () => {
  // synthetic shapes, one per outcome; a metro (LON) response also carries the sibling airport's rows
  const rows: unknown[] = [
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), // 11 nights: kept
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }), // same cell, another fare: kept (engine keeps the minimum, §5.6)
    row({
      origin: 'LHR',
      dest: 'JFK',
      dep: '2027-03-14',
      ret: '2027-03-24',
      price: 401,
      link: 'https://evil.example/x',
    }), // kept, link refused
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-30', price: 350 }), // 18 nights: outside-band
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-25', ret: '2027-04-05', price: 380 }), // after the window: outside-tile
    row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // sibling airport of the metro: other-origin
    row({ origin: 'LHR', dest: 'EWR', dep: '2027-03-12', ret: '2027-03-23', price: 300 }), // other-destination
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: null, price: 200 }), // one-way
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: 0 }), // covered cell, unusable price
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-15', ret: '2027-03-26', price: '412' }), // same cell, price not a number
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-16', ret: '2027-03-27', price: 412.555 }), // covered cell, excess precision
    row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: -1 }), // priced cell, one bad row beside the good ones
  ];
  const a = attributeRows(rows, input);

  it('keeps rows whose response dates name a covered cell of the pair, keyed by those dates', () => {
    expect(a.prices).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 41200,
        currency: 'GBP',
        vendorLink: ROW_LINK,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 39800,
        currency: 'GBP',
        vendorLink: ROW_LINK,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-24',
        amountMinor: 40100,
        currency: 'GBP',
      },
    ]);
  });

  it('counts every foreign or out-of-band row, every dropped offer and every refused link in notes', () => {
    expect(a.notes.list()).toEqual([
      'dropped-one-way:1',
      'dropped-other-destination:1',
      'dropped-other-origin:1',
      'dropped-outside-band:1',
      'dropped-outside-tile:1',
      // why: pie-002: the refused off-host link carries no readable itinerary either, so its open-jaw check is counted.
      'itinerary-unreadable:1',
      'link-rejected:1',
      'offers-dropped:4',
    ]);
  });

  it('reports each covered cell with dropped rows (spec §8.1): error reason parse unless the tile also priced it', () => {
    expect(a.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-15', returnDate: '2027-03-26' },
        reason: 'parse',
        offersDropped: 2,
        detail: expect.stringContaining('[bad-price]'),
      },
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-16', returnDate: '2027-03-27' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[bad-price]'),
      },
      // the engine records this one priced with offers-dropped:1, because the tile priced it too
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23' },
        reason: 'parse',
        offersDropped: 1,
        detail: expect.any(String),
      },
    ]);
  });

  it('sets no providerObservedAt when the link carries no search_date: the 48-hour declaration is the fallback (decision 35)', () => {
    expect(a.prices.every((p) => !('providerObservedAt' in p))).toBe(true);
  });

  it("sets providerObservedAt to the link's search_date day at 00:00 UTC (decision 35)", () => {
    const found = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      link: '/search/LON1203JFK23031?t=X_abc&search_date=11102026&expected_price=412',
    };
    expect(attributeRows([found], input).prices.map((p) => p.providerObservedAt)).toEqual([
      '2026-10-11T00:00:00.000Z',
    ]);
  });

  it('ignores a found_at field: no recording carries one, so its format is unknown (provider review M-5)', () => {
    const found = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      found_at: '2026-10-13T09:30:00+03:00',
    };
    expect(attributeRows([found], input).prices.every((p) => !('providerObservedAt' in p))).toBe(true);
  });

  it('throws malformed-row when a row cannot be placed at all (no cell can be told apart)', () => {
    expect(thrown(() => attributeRows([{ origin_airport: 'LHR' }], input))).toMatchObject({
      kind: 'parse',
      reason: 'parse',
      message: expect.stringContaining('[malformed-row]'),
    });
  });
});

describe('a currency core does not know (plan decision 29: currency-unsupported per cell, never a tile error)', () => {
  it('drops every row of a covered cell, counts it, and reports the cell with reason currency-unsupported', () => {
    const qqq = { ...input, currency: { code: 'QQQ', exponent: null } };
    const a = attributeRows(
      [
        row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
        row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 398 }),
        row({ origin: 'LGW', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 300 }),
      ],
      qqq,
    );
    expect(a.prices).toEqual([]);
    expect(a.notes.list()).toEqual(['dropped-other-origin:1', 'offers-dropped:2']);
    expect(a.cellIssues).toEqual([
      {
        cell: { origin: 'LHR', destination: 'JFK', departureDate: '2027-03-12', returnDate: '2027-03-23' },
        reason: 'currency-unsupported',
        offersDropped: 2,
        detail: expect.stringContaining('[currency-unsupported]'),
      },
    ]);
  });
});

describe('response dates are local calendar dates (spec §6.1: never through UTC)', () => {
  it("keys by the vendor's local date: 23:30 at UTC-5 is the next day in UTC", () => {
    const late = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12T23:30:00-05:00',
    };
    expect(attributeRows([late], input).prices.map((p) => p.departureDate)).toEqual(['2027-03-12']);
  });

  it('keys a month-end departure by its local date, not the UTC date in the next month (ts-005)', () => {
    const lateMarch = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2027-03-25', '2027-03-31', 10, 12),
    };
    // 23:30 at UTC-5 on 31 March is 1 April in UTC; the cell (and so the March tile) follows the local date.
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-31', ret: '2027-04-11', price: 412 }),
      departure_at: '2027-03-31T23:30:00-05:00',
    };
    expect(attributeRows([r], lateMarch).prices.map((p) => [p.departureDate, p.returnDate])).toEqual([
      ['2027-03-31', '2027-04-11'],
    ]);
  });

  it('counts nights across a leap day (2028-02-29) and a year end', () => {
    const leap = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2028-02-20', '2028-02-29', 10, 12),
    };
    const viaLeapDay = row({ origin: 'LHR', dest: 'JFK', dep: '2028-02-20', ret: '2028-03-01', price: 412 }); // 10 nights through 29 Feb
    const onLeapDay = row({ origin: 'LHR', dest: 'JFK', dep: '2028-02-29', ret: '2028-03-11', price: 413 }); // departs 29 Feb, 11 nights
    expect(attributeRows([viaLeapDay, onLeapDay], leap).prices.map((p) => p.amountMinor)).toEqual([
      41200, 41300,
    ]);
    const yearEnd = {
      ...input,
      coveredCells: cellsFor(asIata('LHR'), asIata('JFK'), '2027-12-20', '2027-12-31', 10, 12),
    };
    const r = row({ origin: 'LHR', dest: 'JFK', dep: '2027-12-31', ret: '2028-01-12', price: 414 }); // 12 nights into the next year
    expect(attributeRows([r], yearEnd).prices.map((p) => p.returnDate)).toEqual(['2028-01-12']);
  });

  it.each([
    ['an offset-less time', '2027-03-12T08:55:00'],
    ['a non-date', 'next tuesday'],
    ['an impossible date', '2027-02-30T08:55:00+00:00'],
    ['an impossible hour', '2027-03-12T25:55:00+00:00'],
    ['an impossible minute', '2027-03-12T08:61:00+00:00'],
  ])('refuses %s as malformed (local or UTC cannot be told)', (_label, departureAt) => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: departureAt,
    };
    expect(thrown(() => attributeRows([r], input)).message).toContain('[malformed-row]');
  });

  it('accepts a Z time as an explicit +00:00 offset: the local date is the date written (plan decision 33)', () => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12T23:55:00Z',
    };
    expect(attributeRows([r], input).prices.map((p) => p.departureDate)).toEqual(['2027-03-12']);
  });

  it('accepts a Z return_at too, beside an offset departure (a real recording has it, decision 33)', () => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12T16:25:00-05:00',
      return_at: '2027-03-23T06:00:00Z',
    };
    expect(attributeRows([r], input).prices.map((p) => [p.departureDate, p.returnDate])).toEqual([
      ['2027-03-12', '2027-03-23'],
    ]);
  });

  it('accepts the gate key (undocumented by the vendor) and the documented duration_to and duration_back keys on a row (plan decision 33)', () => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      gate: 'Synthetic Agency',
      duration_to: 475,
      duration_back: 430,
    };
    expect(attributeRows([r], input).prices).toHaveLength(1);
  });

  it('accepts a bare date', () => {
    const r = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      departure_at: '2027-03-12',
      return_at: '2027-03-23',
    };
    expect(attributeRows([r], input).prices).toHaveLength(1);
  });
});

describe('readEnvelope and the cache accept hook (spec §2: currency read from the response; §5.2: malformed → parse)', () => {
  it('upper-cases the vendor currency code and finds its exponent', () => {
    expect(readEnvelope(envelope([], 'gbp')).currency).toEqual(GBP);
    expect(readEnvelope(envelope([], 'usd')).currency).toEqual({ code: 'USD', exponent: 2 });
  });

  it.each([
    ['no currency', { success: true, data: [] }, 'currency-missing'],
    ['a malformed currency', { success: true, data: [], currency: 'g1p' }, 'currency-malformed'],
    ['success:false', { success: false, error: 'invalid destination' }, 'vendor-error'],
    ['an array', [], 'malformed-envelope'],
    ['success missing', { data: [] }, 'malformed-envelope'],
    ['data not an array', { success: true, data: {}, currency: 'gbp' }, 'malformed-envelope'],
    ['currency not a string', { success: true, data: [], currency: 7 }, 'malformed-envelope'],
  ] as const)('%s → parse [%s], never cached', (_label, body, cause) => {
    expect(thrown(() => readEnvelope(body))).toMatchObject({
      kind: 'parse',
      retryable: false,
      reason: 'parse',
      message: expect.stringContaining(`[${cause}]`),
    });
    expect(cacheableBody(body)).toBe(false);
  });

  it('carries the vendor text of success:false in the message only', () => {
    const e = thrown(() => readEnvelope({ success: false, error: 'invalid destination' }));
    expect(e.reason).toBe('parse');
    expect(e.message).toContain('invalid destination');
  });

  it('caches a usable envelope, rows or none', () => {
    expect(cacheableBody(envelope([]))).toBe(true);
    expect(
      cacheableBody(
        envelope([row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 })]),
      ),
    ).toBe(true);
  });

  it('currencyOf reports the cause and a short detail', () => {
    expect(currencyOf(undefined)).toEqual({ ok: false, cause: 'currency-missing', detail: null });
    expect(currencyOf('g1p')).toEqual({ ok: false, cause: 'currency-malformed', detail: 'currency g1p' });
  });

  it('a readable currency core has no exponent for is not a parse error (plan decision 29): exponent null, cacheable', () => {
    expect(readEnvelope(envelope([], 'qqq')).currency).toEqual({ code: 'QQQ', exponent: null });
    expect(currencyOf('qqq')).toEqual({ ok: true, code: 'QQQ', exponent: null });
    expect(cacheableBody(envelope([], 'qqq'))).toBe(true);
  });
});

describe('vendorLinkFor (spec §5.2 vendor links: LINK_ALLOWLIST.travelpayouts)', () => {
  it('prefixes the relative link with the Aviasales site', () => {
    expect(vendorLinkFor('/search/synthetic?t=1')).toBe(LINK);
  });
  it.each(['https://evil.example/x', '//evil.example/x', 'search/relative', '', 7, null])(
    'refuses %j',
    (link) => {
      expect(vendorLinkFor(link)).toBeNull();
    },
  );
});

describe('searchedAt (the row age, decision 35)', () => {
  it.each([
    ['/search/X?search_date=14102026', '2026-10-14T00:00:00.000Z'],
    ['/search/X?t=A_b&search_date=01012027&z=1', '2027-01-01T00:00:00.000Z'],
    ['/search/X?search_date=29022028', '2028-02-29T00:00:00.000Z'],
    ['/search/X?search_date=29022027', null],
    ['/search/X?search_date=2026-10-14', null],
    ['/search/X?search_date=', null],
    ['/search/X', null],
    ['not a path', null],
    [undefined, null],
    [42, null],
  ] as const)('%j → %j', (link, expected) => {
    expect(searchedAt(link)).toBe(expected);
  });
});

/** A link whose t token is the vendor's real shape: carrier, then per direction 26 digits and an airport chain. */
const linkOf = (out: string, back: string, carrier = 'UA'): string =>
  `/search/X?t=${carrier}18146070001814617500000475${out}18158511001815894900000430${back}_1d1bd24f_58507&search_date=14102026`;

describe('itineraryOf (decision 35: both airport chains of the link t token)', () => {
  it.each([
    ['direct', linkOf('LHREWR', 'EWRLHR'), { out: ['LHR', 'EWR'], back: ['EWR', 'LHR'] }],
    [
      'with connections',
      linkOf('LHRFRAEWR', 'EWRFRALCY'),
      { out: ['LHR', 'FRA', 'EWR'], back: ['EWR', 'FRA', 'LCY'] },
    ],
    [
      'a carrier code with a digit',
      linkOf('LGWKEFJFK', 'JFKKEFLGW', 'S7'),
      { out: ['LGW', 'KEF', 'JFK'], back: ['JFK', 'KEF', 'LGW'] },
    ],
    ['one direction only', '/search/X?t=UA18146070001814617500000475LHREWR_abc', null],
    ['no t token', '/search/X?search_date=14102026', null],
    ['a t token that is not the itinerary shape', '/search/X?t=1', null],
    ['not a path', 'https://evil.example/x', null],
    ['a protocol-relative link', '//[', null],
    ['a backslash link', '/\\[', null],
    ['an unparsable host', '//', null],
    ['not a string', 42, null],
  ] as const)('%s → %j', (_label, link, expected) => {
    expect(itineraryOf(link)).toEqual(expected);
  });
});

describe('closed round trips only (decision 35): an open-jaw row, on either end, is a per-cell issue', () => {
  const closed = {
    ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
    link: linkOf('LHRJFK', 'JFKLHR'),
  };
  const openJaw = {
    ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-14', ret: '2027-03-25', price: 380 }),
    link: linkOf('LHRJFK', 'JFKLGW'),
  };

  it('keeps a row that returns to the pair origin and drops one that returns elsewhere', () => {
    const r = attributeRows([closed, openJaw], input);
    expect(r.prices.map((p) => p.amountMinor)).toEqual([41200]);
    expect(r.notes.list()).toEqual(['offers-dropped:1']);
    expect(r.cellIssues).toEqual([
      {
        cell: expect.objectContaining({ departureDate: '2027-03-14', returnDate: '2027-03-25' }),
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[open-jaw]'),
      },
    ]);
  });

  it.each([
    ['the outbound starts elsewhere', linkOf('LGWJFK', 'JFKLHR')],
    ['the outbound lands at another airport of the destination city', linkOf('LHREWR', 'JFKLHR')],
    ['the return leaves from another airport of the destination city', linkOf('LHRJFK', 'EWRJFKLHR')],
    ['the return lands at another airport', linkOf('LHRJFK', 'JFKLGW')],
  ])('drops a row where %s', (_label, link) => {
    const r = attributeRows(
      [{ ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }), link }],
      input,
    );
    expect(r.prices).toEqual([]);
    expect(r.cellIssues[0]?.detail).toContain('[open-jaw]');
  });

  it('reports an open-jaw row for a cell the tile also priced, so the engine records priced with offers-dropped', () => {
    const sameCell = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 380 }),
      link: linkOf('LHRJFK', 'JFKLGW'),
    };
    const r = attributeRows([closed, sameCell], input);
    expect(r.prices).toHaveLength(1);
    expect(r.cellIssues).toHaveLength(1);
    expect(r.cellIssues[0]).toMatchObject({ offersDropped: 1, reason: 'parse' });
  });

  it('merges bad-price and open-jaw rows of one cell into one issue with both tags', () => {
    const bad = { ...openJaw, price: 0, link: linkOf('LHRJFK', 'JFKLHR') };
    const r = attributeRows([openJaw, bad], input);
    expect(r.cellIssues).toHaveLength(1);
    expect(r.cellIssues[0]?.offersDropped).toBe(2);
    expect(r.cellIssues[0]?.detail).toContain('[bad-price]');
    expect(r.cellIssues[0]?.detail).toContain('[open-jaw]');
  });

  it('prices a row whose link has no readable itinerary on its airports, and counts it (pie-002): the return cannot be checked', () => {
    const r = attributeRows(
      [
        row({
          origin: 'LHR',
          dest: 'JFK',
          dep: '2027-03-12',
          ret: '2027-03-23',
          price: 412,
          link: '/search/synthetic?t=1',
        }),
      ],
      input,
    );
    expect(r.prices).toHaveLength(1);
    expect(r.cellIssues).toEqual([]);
    // why: the open-jaw guard could not run, so the tile says so rather than pricing the row silently.
    expect(r.notes.list()).toContain('itinerary-unreadable:1');
  });

  it('a row without any link is not counted as unreadable: there was nothing to read', () => {
    const { link: _none, ...noLink } = row({
      origin: 'LHR',
      dest: 'JFK',
      dep: '2027-03-12',
      ret: '2027-03-23',
      price: 412,
    });
    const r = attributeRows([noLink], input);
    expect(r.prices).toHaveLength(1);
    expect(r.notes.list().some((n) => n.startsWith('itinerary-unreadable'))).toBe(false);
  });
});

describe('a malformed vendor link never throws (one guarded parser for vendorLinkFor, searchedAt and itineraryOf)', () => {
  it.each([
    '//[',
    '/\\[',
    '//evil.example/x',
    '/\\evil.example/x',
    '/\t/evil.example/x',
    '/\n/evil.example/x',
  ])('link %j', (link) => {
    expect(vendorLinkFor(link)).toBeNull();
    expect(searchedAt(link)).toBeNull();
    expect(itineraryOf(link)).toBeNull();
  });

  it('a row with such a link is a per-cell parse issue [bad-link], counted offers-dropped, never an exception', () => {
    const r = attributeRows(
      [
        {
          ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
          link: '//[',
        },
      ],
      input,
    );
    expect(r.prices).toEqual([]);
    expect(r.notes.list()).toEqual(['offers-dropped:1']);
    expect(r.cellIssues).toEqual([
      {
        cell: expect.objectContaining({ departureDate: '2027-03-12' }),
        reason: 'parse',
        offersDropped: 1,
        detail: expect.stringContaining('[bad-link]'),
      },
    ]);
  });

  it('an absolute link is still only refused (link-rejected), the row stays priced', () => {
    const r = attributeRows(
      [
        {
          ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
          link: 'https://evil.example/x',
        },
      ],
      input,
    );
    expect(r.prices).toHaveLength(1);
    expect(r.notes.list()).toContain('link-rejected:1');
  });
});

describe('providerObservedAt on the fetch day (decision 35, day resolution)', () => {
  const sameDay = (searchDate: string) => ({
    ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
    link: `/search/X?search_date=${searchDate}`,
  });

  it('is fetchedAt, never "just now" from a midnight, when the search day is the fetch day', () => {
    const r = attributeRows([sameDay('15102026')], input);
    expect(r.prices.map((p) => p.providerObservedAt)).toEqual([FETCHED]);
  });

  it('is fetchedAt for a search day after the fetch day (never later than the fetch)', () => {
    const r = attributeRows([sameDay('16102026')], input);
    expect(r.prices.map((p) => p.providerObservedAt)).toEqual([FETCHED]);
  });

  it('stays the search day at 00:00 UTC for an earlier day', () => {
    const r = attributeRows([sameDay('14102026')], input);
    expect(r.prices.map((p) => p.providerObservedAt)).toEqual(['2026-10-14T00:00:00.000Z']);
  });
});
