import { asIata, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  attributeRows,
  cacheableBody,
  currencyOf,
  observedAt,
  readEnvelope,
  vendorLinkFor,
} from '../../src/travelpayouts/response.js';
import { cellsOf } from '../../src/travelpayouts/tiles.js';
import { asProviderError } from '../support/guards.js';
import { cellsFor, envelope, query, row } from './harness.js';

const covered: CellKey[] = cellsOf(query());
const GBP = { code: 'GBP', exponent: 2 };
const input = {
  coveredCells: covered,
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  minNights: 10,
  maxNights: 12,
  currency: GBP,
};
const LINK = 'https://www.aviasales.com/search/synthetic?t=1';
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
        vendorLink: LINK,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-12',
        returnDate: '2027-03-23',
        amountMinor: 39800,
        currency: 'GBP',
        vendorLink: LINK,
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

  it('never sets providerObservedAt when rows carry no found_at (spec §2 fact 1)', () => {
    expect(a.prices.every((p) => !('providerObservedAt' in p))).toBe(true);
  });

  it('uses a row found_at, when the vendor states one, as providerObservedAt (ruling 9)', () => {
    const found = {
      ...row({ origin: 'LHR', dest: 'JFK', dep: '2027-03-12', ret: '2027-03-23', price: 412 }),
      found_at: '2026-10-13T09:30:00+03:00',
    };
    expect(attributeRows([found], input).prices.map((p) => p.providerObservedAt)).toEqual([
      '2026-10-13T06:30:00.000Z',
    ]);
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

  it('accepts the undocumented gate, duration_to and duration_back keys on a row (plan decision 33)', () => {
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

describe('observedAt', () => {
  it.each([
    ['2026-10-13T09:30:00Z', '2026-10-13T09:30:00.000Z'],
    ['2026-10-13T09:30:00+03:00', '2026-10-13T06:30:00.000Z'],
    ['2026-10-13', null],
    ['2026-10-13T09:30:00', null],
    [1_760_000_000, null],
    [undefined, null],
  ] as const)('%j → %j', (raw, expected) => {
    expect(observedAt(raw)).toBe(expected);
  });
});
