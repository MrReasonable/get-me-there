import { describe, expect, it } from 'vitest';
import { DETAIL_LINK_PARAMS, detailLinkQuery } from '../../src/datePairs/detailLink.js';
import { asIsoDate } from '../../src/types/ids.js';

describe('detailLinkQuery (design 2026-11-08 §6.1: the Trip page URL, in its order)', () => {
  // why: this literal is the one the engine's alert link and the web landing tests also use.
  it('is exactly view=trip, def, depart, return', () => {
    expect(
      detailLinkQuery({
        definitionId: 'def-1',
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
      }),
    ).toBe('view=trip&def=def-1&depart=2027-03-14&return=2027-03-28');
  });

  it('encodes a value as a query component (an id with a space)', () => {
    expect(
      detailLinkQuery({
        definitionId: 'my def',
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
      }),
    ).toBe('view=trip&def=my+def&depart=2027-03-14&return=2027-03-28');
  });

  // why: basis and row named a row of the retired Results view; they stay named only so the web can read old links
  it('names its parameters once, for the engine and the web (basis and row kept for old links)', () => {
    expect(DETAIL_LINK_PARAMS).toEqual({
      view: 'view',
      def: 'def',
      depart: 'depart',
      return: 'return',
      basis: 'basis',
      row: 'row',
    });
  });
});
