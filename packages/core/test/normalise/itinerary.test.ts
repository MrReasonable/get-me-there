import { describe, expect, it } from 'vitest';
import { NormalisationError } from '../../src/errors.js';
import { MAX_POST_DATA_LENGTH, type NormaliseResult, normaliseOffer } from '../../src/normalise/itinerary.js';
import type { RawOffer } from '../../src/ports/provider.js';
import type { CellKey } from '../../src/types/definition.js';
import { asIata, asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import { cellOf, deps, offer, seg } from '../helpers/offers.js';

function ok(raw: RawOffer, d = deps(), cell: CellKey = cellOf(raw)): Extract<NormaliseResult, { ok: true }> {
  const r = normaliseOffer(raw, cell, d);
  if (!r.ok) throw new Error(`unexpected ${r.error.reason}: ${r.error.message}`);
  return r;
}
function reason(raw: RawOffer, d = deps(), cell: CellKey = cellOf(raw)): string {
  const r = normaliseOffer(raw, cell, d);
  if (r.ok) return 'normalised';
  expect(r.error).toBeInstanceOf(NormalisationError);
  return r.error.reason;
}

describe('normaliseOffer: identity (spec §6.4 matrix through the full step)', () => {
  const base = ok(offer()).itinerary.hash;

  it('VS 938 / VS938 / 0938 give one itinerary', () => {
    for (const f of ['VS 938', 'VS938', '0938']) {
      const raw = offer();
      raw.outbound = [
        seg({
          flightNumber: f,
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T13:05',
        }),
      ];
      expect(ok(raw).itinerary.hash).toBe(base);
    }
  });

  it('UTC, local and offset inputs for the same flights give one itinerary', () => {
    const utc = offer({
      outbound: [
        seg({
          timeKind: 'utc',
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05:00Z',
          arrive: '2027-03-14T17:05:00Z',
        }),
      ],
      inbound: [
        seg({
          timeKind: 'utc',
          flightNumber: '939',
          from: asIata('JFK'),
          to: asIata('LHR'),
          depart: '2027-03-28T22:30:00Z',
          arrive: '2027-03-29T05:40:00Z',
        }),
      ],
    });
    const offset = offer({
      outbound: [
        seg({
          timeKind: 'offset',
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05:00+00:00',
          arrive: '2027-03-14T13:05:00-04:00',
        }),
      ],
      inbound: [
        seg({
          timeKind: 'offset',
          flightNumber: '939',
          from: asIata('JFK'),
          to: asIata('LHR'),
          depart: '2027-03-28T18:30:00-04:00',
          arrive: '2027-03-29T06:40:00+01:00',
        }),
      ],
    });
    expect(ok(utc).itinerary.hash).toBe(base);
    expect(ok(offset).itinerary.hash).toBe(base);
    expect(ok(utc).itinerary.outbound[0]).toMatchObject({
      departLocal: '2027-03-14T10:05',
      arriveLocal: '2027-03-14T13:05',
      departUtc: '2027-03-14T10:05:00.000Z',
    });
  });

  it('price, cabin, seller, provider, booking and currency do not change identity', () => {
    const other = offer({
      seller: 'Some OTA',
      amountMinor: 999_999,
      currency: 'CNY',
      requestedCabin: 'business',
      booking: { kind: 'get', url: 'https://www.google.com/x' },
    });
    expect(ok(other, deps({ providerId: 'searchapi', cabin: 'business' })).itinerary.hash).toBe(base);
    // Codeshare: an operating carrier, duration and aircraft never enter the hash (spec §6.4).
    const codeshare = offer();
    codeshare.outbound = [
      seg({
        operatingCarrier: 'BA',
        durationMinutes: 420,
        aircraft: '77W',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(ok(codeshare).itinerary.hash).toBe(base);
  });

  it('vendor strings are kept raw (WP11 strips control characters, the web escapes)', () => {
    expect(ok(offer({ seller: 'Seller\r\nInjected' })).offer.seller).toBe('Seller\r\nInjected');
  });

  it('unknown airport tz is returned as unknown-airport-tz, never hashed on UTC', () => {
    const raw = offer();
    raw.outbound = [
      seg({
        timeKind: 'utc',
        from: asIata('LHR'),
        to: asIata('ZZZ'),
        depart: '2027-03-14T10:05:00Z',
        arrive: '2027-03-14T17:05:00Z',
      }),
    ];
    expect(reason(raw)).toBe('unknown-airport-tz');
  });

  it('an unmappable marketing or operating carrier is returned as unmappable-carrier', () => {
    const raw = offer();
    raw.outbound = [
      seg({
        marketingCarrier: 'VIR',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(reason(raw)).toBe('unmappable-carrier');
    const op = offer();
    op.outbound = [
      seg({
        operatingCarrier: 'Virgin Atlantic',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(reason(op)).toBe('unmappable-carrier');
  });

  it('an offer that flies another cell than the one asked is dropped, never re-keyed', () => {
    const asked = cellOf(offer());
    expect(reason(offer(), deps(), { ...asked, returnDate: asIsoDate('2027-03-27') })).toBe('cell-mismatch');
    expect(reason(offer(), deps(), { ...asked, departureDate: asIsoDate('2027-03-13') })).toBe(
      'cell-mismatch',
    );
    expect(reason(offer(), deps(), { ...asked, origin: asIata('LGW') })).toBe('cell-mismatch');
    expect(reason(offer(), deps(), { ...asked, destination: asIata('EWR') })).toBe('cell-mismatch');
    // The inbound must leave the cell's destination and land at its origin (review po-004, prov-004).
    const fromEwr = offer();
    fromEwr.inbound = [
      seg({
        flightNumber: '939',
        from: asIata('EWR'),
        to: asIata('LHR'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ];
    expect(reason(fromEwr, deps(), asked)).toBe('cell-mismatch');
    const toLgw = offer();
    toLgw.inbound = [
      seg({
        flightNumber: '939',
        from: asIata('JFK'),
        to: asIata('LGW'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ];
    const r2 = normaliseOffer(toLgw, asked, deps());
    expect(r2.ok ? '' : r2.error.message).toBe(
      'cell-mismatch: inbound flies JFK→LGW, cell is LHR|JFK|2027-03-14|2027-03-28',
    );
    const r = normaliseOffer(offer(), { ...asked, returnDate: asIsoDate('2027-03-27') }, deps());
    expect(r.ok ? '' : r.error.message).toBe(
      'cell-mismatch: offer flies LHR|JFK|2027-03-14|2027-03-28, cell is LHR|JFK|2027-03-14|2027-03-27',
    );
  });

  it('an airport missing from the airports table is unknown-airport-tz', () => {
    expect(reason(offer(), deps({ tzOf: (a) => (a === 'JFK' ? null : 'Europe/London') }))).toBe(
      'unknown-airport-tz',
    );
  });

  it('missing directions are no-return-legs; impossible times are bad-local-time', () => {
    expect(reason(offer({ inbound: [] }))).toBe('no-return-legs');
    expect(reason(offer({ outbound: [] }))).toBe('no-return-legs');
    const noOut = normaliseOffer(offer({ outbound: [] }), cellOf(offer()), deps());
    expect(noOut.ok ? '' : noOut.error.message).toBe('no-return-legs: no outbound segments');
    const noIn = normaliseOffer(offer({ inbound: [] }), cellOf(offer()), deps());
    expect(noIn.ok ? '' : noIn.error.message).toBe('no-return-legs: no inbound segments');
    expect(
      reason(
        offer({
          outbound: [
            seg({
              from: asIata('LHR'),
              to: asIata('JFK'),
              depart: '2027-03-14T10:05',
              arrive: '2027-03-14T05:00',
            }),
          ],
        }),
      ),
    ).toBe('bad-local-time');
    expect(
      reason(
        offer({
          outbound: [
            seg({
              from: asIata('LHR'),
              to: asIata('AAA'),
              depart: '2027-03-14T10:00',
              arrive: '2027-03-14T13:00',
            }),
            seg({
              flightNumber: '1',
              from: asIata('AAA'),
              to: asIata('JFK'),
              depart: '2027-03-14T12:00',
              arrive: '2027-03-14T15:00',
            }),
          ],
        }),
      ),
    ).toBe('bad-local-time');
  });

  it('a requested cabin that differs from the definition cabin is a caller bug and throws', () => {
    expect(() => normaliseOffer(offer({ requestedCabin: 'business' }), cellOf(offer()), deps())).toThrow(
      /differs from the definition cabin/,
    );
  });

  it('non-normalisation errors (a float amount) are thrown, not returned', () => {
    expect(() => normaliseOffer(offer({ amountMinor: 412.5 }), cellOf(offer()), deps())).toThrow(RangeError);
  });
});

describe('normaliseOffer: derived itinerary fields', () => {
  it('dates, nights, stops, minutes, carriers', () => {
    const it0 = ok(offer()).itinerary;
    expect(it0).toMatchObject({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: '2027-03-14',
      returnDate: '2027-03-28',
      nights: 14,
      stopsOut: 0,
      stopsIn: 0,
      outboundMinutes: 420,
      inboundMinutes: 430,
      layovers: [],
      airportChange: false,
      marketingCarriers: ['VS'],
    });
  });

  it('marketing carriers are de-duplicated and sorted, whatever the segment order', () => {
    const raw = offer({
      outbound: [
        seg({
          marketingCarrier: 'VS',
          flightNumber: '7',
          from: asIata('LHR'),
          to: asIata('AAA'),
          depart: '2027-03-14T08:00',
          arrive: '2027-03-14T11:00',
        }),
        seg({
          marketingCarrier: '4U',
          flightNumber: '8',
          from: asIata('AAA'),
          to: asIata('JFK'),
          depart: '2027-03-14T12:00',
          arrive: '2027-03-14T15:00',
        }),
      ],
    });
    expect(ok(raw).itinerary.marketingCarriers).toEqual(['4U', 'VS']);
  });

  it('a segment of zero length is bad-local-time; a raw "none" booking stays exactly { kind: "none" }', () => {
    const raw = offer({
      outbound: [
        seg({
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05',
          arrive: '2027-03-14T05:05',
        }),
      ],
    });
    expect(reason(raw)).toBe('bad-local-time'); // lands 09:05Z, before it leaves at 10:05Z
    const zero = offer({
      outbound: [
        seg({
          timeKind: 'utc',
          from: asIata('LHR'),
          to: asIata('JFK'),
          depart: '2027-03-14T10:05Z',
          arrive: '2027-03-14T10:05Z',
        }),
      ],
    });
    expect(reason(zero)).toBe('bad-local-time');
    expect(ok(offer()).observation.booking).toEqual({ kind: 'none' });
  });

  it('optional vendor facts are copied only when stated', () => {
    const plain = ok(offer()).itinerary.outbound[0];
    expect(plain).not.toHaveProperty('operatingCarrier');
    expect(plain).not.toHaveProperty('durationMinutes');
    expect(plain).not.toHaveProperty('aircraft');
    const rich = offer();
    rich.outbound = [
      seg({
        operatingCarrier: 'ba',
        durationMinutes: 420,
        aircraft: '77W',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(ok(rich).itinerary.outbound[0]).toMatchObject({
      operatingCarrier: 'BA',
      durationMinutes: 420,
      aircraft: '77W',
    });
  });

  it('layovers: minutes, overnight (00:00–05:00 local at the connection) and airport change', () => {
    const raw = offer({
      outbound: [
        seg({
          marketingCarrier: '4U',
          flightNumber: '4U 8888',
          from: asIata('LHR'),
          to: asIata('AAA'),
          depart: '2027-03-14T20:00',
          arrive: '2027-03-14T23:10',
        }),
        seg({
          marketingCarrier: 'VS',
          flightNumber: '1',
          from: asIata('AAA'),
          to: asIata('JFK'),
          depart: '2027-03-15T06:20',
          arrive: '2027-03-15T08:00',
        }),
      ],
      inbound: [
        seg({
          flightNumber: '2',
          from: asIata('JFK'),
          to: asIata('AAA'),
          depart: '2027-03-28T10:00',
          arrive: '2027-03-28T19:00',
        }),
        seg({
          flightNumber: '3',
          from: asIata('BBB'),
          to: asIata('LHR'),
          depart: '2027-03-28T21:00',
          arrive: '2027-03-29T00:10',
        }),
      ],
    });
    const it0 = ok(raw).itinerary;
    expect(it0.layovers).toEqual([
      { at: 'AAA', minutes: 430, overnight: true, airportChange: false },
      { at: 'AAA', minutes: 120, overnight: false, airportChange: true },
    ]);
    expect(it0).toMatchObject({
      stopsOut: 1,
      stopsIn: 1,
      airportChange: true,
      marketingCarriers: ['4U', 'VS'],
    });
  });

  it.each([
    ['2027-03-14T05:00', '2027-03-14T07:00', false], // arrives as the night window closes
    ['2027-03-14T21:00', '2027-03-14T23:59', false], // evening only
    ['2027-03-14T23:00', '2027-03-15T00:30', true], // crosses midnight
    ['2027-03-14T04:00', '2027-03-14T06:00', true], // inside the window on the same day
    ['2027-03-14T22:00', '2027-03-15T00:00', false], // leaves exactly as the window opens: no time inside it
    ['2027-03-14T10:00', '2027-03-14T10:00', false], // a zero-minute connection is accepted
  ])('overnight boundary: arrive %s, depart %s → %s', (arrive, depart, overnight) => {
    const raw = offer({
      outbound: [
        seg({ from: asIata('LHR'), to: asIata('AAA'), depart: '2027-03-13T20:00', arrive }),
        seg({
          flightNumber: '1',
          from: asIata('AAA'),
          to: asIata('JFK'),
          depart,
          arrive: '2027-03-15T12:00',
        }),
      ],
    });
    expect(ok(raw).itinerary.layovers[0]?.overnight).toBe(overnight);
  });

  it('evidenced cabins only when every segment states one', () => {
    const all = offer();
    all.outbound = [
      seg({
        cabin: 'premium_economy',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    all.inbound = [
      seg({
        cabin: 'economy',
        flightNumber: '939',
        from: asIata('JFK'),
        to: asIata('LHR'),
        depart: '2027-03-28T18:30',
        arrive: '2027-03-29T06:40',
      }),
    ];
    expect(ok(all).observation.segmentCabins).toEqual(['premium_economy', 'economy']);
    const some = offer();
    some.outbound = [
      seg({
        cabin: 'economy',
        from: asIata('LHR'),
        to: asIata('JFK'),
        depart: '2027-03-14T10:05',
        arrive: '2027-03-14T13:05',
      }),
    ];
    expect(ok(some).observation.segmentCabins).toBeNull();
  });
});

describe('normaliseOffer: money and the FX flag (spec §5.6, §6.3)', () => {
  it('GBP is unconverted and keeps pence equal to native minor units', () => {
    expect(ok(offer({ currency: 'gbp' })).observation).toMatchObject({
      pricePence: 41_200,
      priceNativeMinor: 41_200,
      currencyNative: 'GBP',
      fx: { converted: false },
    });
  });

  it('CNY converts with the rate stored beside it', () => {
    expect(ok(offer({ currency: 'CNY', amountMinor: 412_345 })).observation).toMatchObject({
      pricePence: 43_008,
      priceNativeMinor: 412_345,
      currencyNative: 'CNY',
      fx: { converted: true, rateNano: 104_300_000, rateDate: '2027-03-01', source: 'frankfurter' },
    });
  });

  it('a non-ECB currency is currency-unsupported; a missing rate is fx-unavailable', () => {
    expect(reason(offer({ currency: 'XAU' }))).toBe('currency-unsupported');
    expect(reason(offer({ currency: 'USD' }))).toBe('fx-unavailable');
  });

  it('optional fare facts are null when absent and copied when present', () => {
    expect(ok(offer()).observation).toMatchObject({
      taxesIncluded: null,
      selfTransfer: null,
      baggage: null,
      fareConditions: null,
      bookingExpiresAt: null,
    });
    const rich = offer({
      taxesIncluded: true,
      selfTransfer: false,
      baggage: { checkedBags: 1 },
      fareConditions: { refundable: false },
      bookingExpiresAt: asIsoDateTime('2027-03-01T12:00:00.000Z'),
    });
    expect(ok(rich).observation).toMatchObject({
      taxesIncluded: true,
      selfTransfer: false,
      baggage: { checkedBags: 1 },
      fareConditions: { refundable: false },
      bookingExpiresAt: '2027-03-01T12:00:00.000Z',
    });
  });
});

describe('normaliseOffer: booking links (spec §5.2)', () => {
  it('a POST body is kept only when bounded and free of control characters (review sec-002)', () => {
    const url = 'https://www.google.com/travel/clk';
    const at = (postData: string) =>
      ok(offer({ booking: { kind: 'post', url, postData } })).observation.booking.kind;
    expect(at('u'.repeat(MAX_POST_DATA_LENGTH))).toBe('post');
    expect(at('u'.repeat(MAX_POST_DATA_LENGTH + 1))).toBe('none');
    expect(at('u=1\r\nX-Injected: 1')).toBe('none');
    expect(at('u=1\u0000')).toBe('none');
    expect(at('u=1\u007f')).toBe('none');
  });

  it('a GET link on the provider allowlist is kept with its host', () => {
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://www.google.com/travel/flights/booking?x=1' } }))
        .observation.booking,
    ).toEqual({
      kind: 'get',
      url: 'https://www.google.com/travel/flights/booking?x=1',
      host: 'www.google.com',
    });
  });
  it('a POST booking keeps its form data and host', () => {
    expect(
      ok(offer({ booking: { kind: 'post', url: 'https://www.google.com/travel/clk', postData: 'u=abc' } }))
        .observation.booking,
    ).toEqual({
      kind: 'post',
      url: 'https://www.google.com/travel/clk',
      postData: 'u=abc',
      host: 'www.google.com',
    });
  });
  it('anything off the allowlist becomes none, for GET and POST', () => {
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://seller.example/pay' } })).observation.booking,
    ).toEqual({ kind: 'none' });
    expect(
      ok(offer({ booking: { kind: 'post', url: 'http://www.google.com/travel/clk', postData: 'u' } }))
        .observation.booking,
    ).toEqual({ kind: 'none' });
    expect(
      ok(offer({ booking: { kind: 'get', url: 'https://www.aviasales.com/x' } })).observation.booking,
    ).toEqual({ kind: 'none' });
  });
  it('the offer carries provider, seller and the requested cabin', () => {
    const r = ok(offer(), deps({ providerId: 'travelpayouts' }));
    expect(r.offer).toEqual({
      itineraryHash: r.itinerary.hash,
      providerId: 'travelpayouts',
      seller: 'Virgin Atlantic',
      cabin: 'economy',
    });
  });
});
