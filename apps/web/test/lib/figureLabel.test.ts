import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { figureLabelKind, labelDetail } from '../../src/lib/figureLabel.js';
import { calendarFig, figurePairing, pairingFig, provCached, verifiedFig } from '../fixtures.dates.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7): the one label of a figure, from core's `priceLabelKind`.

const D = COPY.trip.labelDetail;

describe('figureLabelKind', () => {
  it("a pairing figure: a seller's price, or Google's price (and a pairing figure missing its pairing never a seller's)", () => {
    expect(figureLabelKind(pairingFig())).toBe('seller');
    const from = pairingFig({
      pairing: figurePairing({ isFrom: true, seller: null, offersRead: 0, complete: false }),
    });
    expect(figureLabelKind(from)).toBe('google-price');
    expect(figureLabelKind({ ...pairingFig(), pairing: null })).toBe('google-price');
  });

  // why: final review I1: the figure says whether SearchApi's booking options gave a seller's booking, so the board
  // and the Trip page decide the label from the same figure the same way
  it("a verified figure: a seller's with booking options, Google's without; not seen again once a search missed it", () => {
    expect(figureLabelKind(verifiedFig({ hasBookingOptions: true }))).toBe('seller');
    expect(figureLabelKind(verifiedFig())).toBe('google-price');
    expect(figureLabelKind(verifiedFig({ hasBookingOptions: true, notSeenInLatest: { ageHours: 30 } }))).toBe(
      'not-seen-again',
    );
  });

  it('a calendar figure: Calendar, Cached from the Aviasales cache, Not seen again once superseded', () => {
    expect(figureLabelKind(calendarFig())).toBe('calendar');
    expect(
      figureLabelKind(calendarFig({ price: { ...calendarFig().price, provenance: provCached() } })),
    ).toBe('cached');
    expect(figureLabelKind(calendarFig({ superseded: true }))).toBe('not-seen-again');
  });
});

describe('labelDetail', () => {
  it('names the seller and its count, or says the price is SearchApi’s; the age is never in these words', () => {
    expect(labelDetail('seller', { name: 'Kiwi.com', offersRead: 16 })).toBe(D.seller('Kiwi.com', 16));
    expect(D.seller('Kiwi.com', 16)).not.toMatch(/\bago\b|\bread \d/);
    expect(labelDetail('seller', null)).toBe(D.sellerSearchApi);
  });
  it.each(['google-price', 'google-list', 'calendar', 'cached', 'not-seen-again'] as const)('%s', (kind) => {
    expect(labelDetail(kind, null)).toBe(D[kind]);
  });
  // why: CodeRabbit PR #58 finding 7: Google's price for a pairing whose booking page was read in part (some sellers
  // read, `google-incomplete`) never says no seller's price was read; unread, and any other Google price, still does
  it("Google's price for a pairing read in part says not every seller was read", () => {
    expect(labelDetail('google-price', null, 'google-incomplete')).toBe(D['google-incomplete']);
    expect(D['google-incomplete']).not.toContain("No seller's price was read");
    expect(labelDetail('google-price', null, 'google-unread')).toBe(D['google-price']);
    expect(labelDetail('google-price', null, null)).toBe(D['google-price']);
    expect(labelDetail('seller', { name: 'Kiwi.com', offersRead: 16 }, 'seller')).toBe(
      D.seller('Kiwi.com', 16),
    );
  });
});
