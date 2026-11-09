import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { figureLabelKind, labelDetail } from '../../src/lib/figureLabel.js';
import { calendarFig, figurePairing, pairingFig, provCached, verifiedFig } from '../fixtures.dates.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7): the one label of a figure, from core's `priceLabelKind`.

const D = COPY.trip.labelDetail;

describe('figureLabelKind', () => {
  it("a pairing figure: a seller's price, or Google's price (and a pairing figure missing its pairing never a seller's)", () => {
    expect(figureLabelKind(pairingFig(), null)).toBe('seller');
    const from = pairingFig({
      pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }),
    });
    expect(figureLabelKind(from, null)).toBe('google-price');
    expect(figureLabelKind({ ...pairingFig(), pairing: null }, null)).toBe('google-price');
  });

  it("a verified figure: a seller's with a seller's booking, Google's without; not seen again once a search missed it", () => {
    const get = {
      kind: 'get' as const,
      url: 'https://www.google.com/travel/clk/f?id=1',
      host: 'www.google.com',
    };
    expect(figureLabelKind(verifiedFig(), get)).toBe('seller');
    expect(figureLabelKind(verifiedFig(), { kind: 'none' })).toBe('google-price');
    expect(figureLabelKind(verifiedFig(), null)).toBe('google-price');
    expect(figureLabelKind(verifiedFig({ notSeenInLatest: { ageHours: 30 } }), get)).toBe('not-seen-again');
  });

  it('a calendar figure: Calendar, Cached from the Aviasales cache, Not seen again once superseded', () => {
    expect(figureLabelKind(calendarFig(), null)).toBe('calendar');
    expect(
      figureLabelKind(calendarFig({ price: { ...calendarFig().price, provenance: provCached() } }), null),
    ).toBe('cached');
    expect(figureLabelKind(calendarFig({ superseded: true }), null)).toBe('not-seen-again');
  });
});

describe('labelDetail', () => {
  it('names the seller and its count, or says the price is SearchApi’s', () => {
    expect(labelDetail('seller', { seller: { name: 'Kiwi.com', offersRead: 16 }, ageHours: 3 })).toBe(
      D.seller('Kiwi.com', 16, '3h ago'),
    );
    expect(labelDetail('seller', { seller: null, ageHours: 3 })).toBe(D.sellerSearchApi);
  });
  it('says how long ago a price no longer seen was read, or that its age is not known', () => {
    expect(labelDetail('not-seen-again', { seller: null, ageHours: 120 })).toBe(
      D['not-seen-again']('5d ago'),
    );
    expect(labelDetail('not-seen-again', { seller: null, ageHours: 'unknown' })).toBe(
      D['not-seen-again'](COPY.ageUnknown),
    );
  });
  it.each(['google-price', 'google-list', 'calendar', 'cached'] as const)('%s', (kind) => {
    expect(labelDetail(kind, { seller: null, ageHours: 3 })).toBe(D[kind]);
  });
});
