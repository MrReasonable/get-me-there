import { beforeEach, describe, expect, it } from 'vitest';
import { PAIRING_KINDS } from '../../src/datePairs/pairing.js';
import {
  PRICE_LABEL_KINDS,
  type PricedThing,
  type PriceLabelKind,
  priceLabelKind,
} from '../../src/labels/priceLabel.js';

beforeEach(() => {
  expect.hasAssertions();
});

type Variant = PricedThing['kind'];

// why: a Record over the variant names, so a variant added to PricedThing without a row fails to compile
const TABLE: Record<Variant, { thing: PricedThing; kind: PriceLabelKind; notSeenAgain: PriceLabelKind }[]> = {
  pairing: [
    { thing: { kind: 'pairing', pairingKind: 'seller' }, kind: 'seller', notSeenAgain: 'seller' },
    {
      thing: { kind: 'pairing', pairingKind: 'google-unread' },
      kind: 'google-price',
      notSeenAgain: 'google-price',
    },
    {
      thing: { kind: 'pairing', pairingKind: 'google-incomplete' },
      kind: 'google-price',
      notSeenAgain: 'google-price',
    },
  ],
  verified: [
    { thing: { kind: 'verified', hasBookingOptions: true }, kind: 'seller', notSeenAgain: 'not-seen-again' },
    {
      thing: { kind: 'verified', hasBookingOptions: false },
      kind: 'google-price',
      notSeenAgain: 'not-seen-again',
    },
  ],
  'list-return': [{ thing: { kind: 'list-return' }, kind: 'google-price', notSeenAgain: 'not-seen-again' }],
  'list-outbound': [
    { thing: { kind: 'list-outbound' }, kind: 'google-list', notSeenAgain: 'not-seen-again' },
  ],
  calendar: [
    { thing: { kind: 'calendar', providerId: 'camoufox' }, kind: 'calendar', notSeenAgain: 'not-seen-again' },
    {
      thing: { kind: 'calendar', providerId: 'searchapi' },
      kind: 'calendar',
      notSeenAgain: 'not-seen-again',
    },
    {
      thing: { kind: 'calendar', providerId: 'travelpayouts' },
      kind: 'cached',
      notSeenAgain: 'not-seen-again',
    },
  ],
};

describe('priceLabelKind', () => {
  for (const rows of Object.values(TABLE))
    for (const row of rows) {
      const name = JSON.stringify(row.thing);
      it(`${name} is ${row.kind}`, () => {
        expect(priceLabelKind(row.thing, false)).toBe(row.kind);
      });
      it(`${name} not seen again is ${row.notSeenAgain}`, () => {
        expect(priceLabelKind(row.thing, true)).toBe(row.notSeenAgain);
      });
    }

  it('covers every pairing kind', () => {
    expect(TABLE.pairing.map((r) => (r.thing.kind === 'pairing' ? r.thing.pairingKind : null))).toEqual([
      ...PAIRING_KINDS,
    ]);
  });

  it('names every kind it can return', () => {
    const returned = new Set(
      Object.values(TABLE).flatMap((rows) => rows.flatMap((r) => [r.kind, r.notSeenAgain])),
    );
    expect([...returned].sort()).toEqual([...PRICE_LABEL_KINDS].sort());
  });
});
