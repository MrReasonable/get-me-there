// Spec revision 56 §2 "The booking read": the offer grammar and the offer reader over a booking view's buttons. Every
// name here is synthetic (the recorded name form with the synthetic sellers QQ Travel and QQ Fares), never a recording's.
import { BOOKING_OFFERS_MAX, offerSchema } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { OFFER_GRAMMAR_VERSION, parseOfferName, readOffers } from '../src/offers.js';
import { currencyOf, minorOf } from '../src/pence.js';

const offer = (seller: string, pounds: string, fare?: string, currency = 'British pounds'): string =>
  `Continue to book with ${seller}${fare === undefined ? '' : `, ${fare}`} for ${pounds} ${currency}`;

beforeEach(() => {
  expect.hasAssertions();
});

describe('parseOfferName (spec rev 56 §2: "Continue to book with <seller>[, <fare>] for <price> <currency>")', () => {
  it('reads the seller, no fare, the stated price in pence and the currency phrase', () => {
    expect(parseOfferName('Continue to book with QQ Travel for 1,180 British pounds')).toEqual({
      seller: 'QQ Travel',
      fare: null,
      amountMinor: 118_000,
      currency: 'British pounds',
    });
  });
  it('reads a fare name after the seller', () => {
    expect(parseOfferName(offer('QQ Fares', '1,195', 'Economy Basic'))).toEqual({
      seller: 'QQ Fares',
      fare: 'Economy Basic',
      amountMinor: 119_500,
      currency: 'British pounds',
    });
  });
  it('reads a US-dollar phrase, in that currency’s minor units', () => {
    expect(parseOfferName(offer('QQ Travel', '1,500', undefined, 'US dollars'))).toEqual({
      seller: 'QQ Travel',
      fare: null,
      amountMinor: 150_000,
      currency: 'US dollars',
    });
  });
  it('cleans the seller and fare as a carrier is cleaned (format characters out, spaces collapsed)', () => {
    expect(parseOfferName(offer('QQ​  Travel', '900', 'Economy‮ Light'))).toMatchObject({
      seller: 'QQ Travel',
      fare: 'Economy Light',
    });
  });
  it.each([
    ['a "From" price', 'Continue to book with QQ Travel for From 1,180 British pounds'],
    ['"From" anywhere in the name', 'Continue to book with QQ Travel From London for 1,180 British pounds'],
    ['an empty seller', 'Continue to book with  for 1,180 British pounds'],
    ['a seller of format characters only', offer('​​', '1,180')],
    ['an unknown currency phrase', offer('QQ Travel', '1,180', undefined, 'Galactic credits')],
    ['an appended sentence', `${offer('QQ Travel', '1,180')}. Includes one bag`],
    ['an appended word', `${offer('QQ Travel', '1,180')} only`],
    ['an 81-character seller', offer('Q'.repeat(81), '1,180')],
    ['an 81-character fare', offer('QQ Travel', '1,180', 'E'.repeat(81))],
    ['a malformed price', offer('QQ Travel', '1,18,0')],
    ['another sentence form', 'Book with QQ Travel for 1,180 British pounds'],
  ])('%s is null', (_what, name) => {
    expect(parseOfferName(name)).toBeNull();
  });
  it('keeps every parsed offer inside the contract’s offer shape', () => {
    const p = parseOfferName(offer('Q'.repeat(80), '1', 'F'.repeat(80)));
    expect(p).not.toBeNull();
    expect(
      offerSchema.safeParse({ seller: p?.seller, fare: p?.fare, priceMinor: p?.amountMinor }).success,
    ).toBe(true);
  });
  it('is dated', () => {
    expect(OFFER_GRAMMAR_VERSION).toBe('2026-11-01-offers');
  });
});

describe('the one pence helper (the 21.0 Lows: the currency from its phrase, minor units by ISO 4217)', () => {
  it('names the currency of a phrase it knows and nothing else (never a GBP fallback)', () => {
    expect(currencyOf('British pounds')).toBe('GBP');
    expect(currencyOf('US dollars')).toBe('USD');
    expect(currencyOf('Euros')).toBe('EUR');
    expect(currencyOf('Japanese yen')).toBe('JPY');
    expect(currencyOf('Galactic credits')).toBeNull();
    expect(currencyOf('british pounds')).toBeNull();
  });
  it('turns a stated figure into minor units by the currency’s exponent, exact digits', () => {
    expect(minorOf('1,204', 'GBP')).toBe(120_400);
    expect(minorOf('478', 'USD')).toBe(47_800);
    // why: a currency with no minor unit (ISO 4217 exponent 0) is never multiplied by a hundred
    expect(minorOf('12,000', 'JPY')).toBe(12_000);
    expect(minorOf('478', 'XXX')).toBeNull();
    expect(minorOf('4,78', 'GBP')).toBeNull();
    expect(minorOf('', 'GBP')).toBeNull();
  });
});

describe('readOffers (spec rev 56 §2: the offers read, the cheapest kept first)', () => {
  it('23 offer buttons, two unparsable and one in dollars: 20 GBP offers by price then page order', () => {
    const gbp = Array.from({ length: 20 }, (_, i) =>
      // why: two offers tie on price, so page order breaks the tie
      offer(i % 2 === 0 ? 'QQ Travel' : 'QQ Fares', String(1400 - (i === 7 ? 6 : i) * 10)),
    );
    const names = [
      ...gbp.slice(0, 5),
      'Reworded offer text',
      ...gbp.slice(5, 12),
      offer('QQ Travel', '1,500', undefined, 'US dollars'),
      null,
      ...gbp.slice(12),
    ];
    const r = readOffers({ offerNames: names, moreOptions: 1, grouped: 2 });
    expect(r.offers).toHaveLength(20);
    expect(r.offers.map((o) => o.priceMinor)).toEqual(
      [...r.offers.map((o) => o.priceMinor)].sort((a, b) => a - b),
    );
    // the tie at 1,340: index 6 (QQ Travel, page order first) before index 7 (QQ Fares)
    const tie = r.offers.filter((o) => o.priceMinor === 134_000);
    expect(tie.map((o) => o.seller)).toEqual(['QQ Travel', 'QQ Fares']);
    expect(r).toMatchObject({
      unparsed: 2,
      nonGbp: 1,
      allGbp: false,
      grouped: 2,
      moreControl: true,
      offersStated: null,
    });
    for (const o of r.offers) expect(offerSchema.safeParse(o).success).toBe(true);
  });
  it('45 GBP offers: the 40 cheapest kept, the 5 dearest dropped (ties by page order), offersStated 45', () => {
    // 45 offers: 40 at 1,000..1,390, then five at 2,000, interleaved so the cut is decided by price, then page order
    const names = Array.from({ length: 45 }, (_, i) =>
      offer(`QQ Seller ${i}`, i < 40 ? String(1000 + i * 10) : '2,000'),
    );
    // a 41st offer at the 40th's price, later in page order, is dropped
    names[44] = offer('QQ Seller late', '1,390');
    const r = readOffers({ offerNames: names, moreOptions: 0, grouped: 0 });
    expect(r.offers).toHaveLength(BOOKING_OFFERS_MAX);
    expect(r.offers.map((o) => o.seller)).not.toContain('QQ Seller late');
    expect(r.offers.some((o) => o.priceMinor === 200_000)).toBe(false);
    expect(r).toMatchObject({ offersStated: 45, unparsed: 0, nonGbp: 0, allGbp: true, moreControl: false });
  });
  it('the mixed-currency case: a page whose offers are in two currencies reads none as GBP but its GBP ones', () => {
    const r = readOffers({
      offerNames: [offer('QQ Travel', '1,180'), offer('QQ Fares', '1,100', undefined, 'Euros')],
      moreOptions: 0,
      grouped: 0,
    });
    expect(r.offers).toEqual([{ seller: 'QQ Travel', fare: null, priceMinor: 118_000 }]);
    expect([r.nonGbp, r.allGbp]).toEqual([1, false]);
  });
  it('no button: no offer, nothing dropped', () => {
    expect(readOffers({ offerNames: [], moreOptions: 0, grouped: 0 })).toEqual({
      offers: [],
      offersStated: null,
      unparsed: 0,
      nonGbp: 0,
      grouped: 0,
      moreControl: false,
      allGbp: true,
    });
  });
});
