import { describe, expect, it } from 'vitest';
import { DETAIL_LINK_PARAMS, detailLinkQuery } from '../../src/datePairs/detailLink.js';
import { asIsoDate } from '../../src/types/ids.js';

const HASH = '9f3c2a7b41d0e6f85a1c3b2d4e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b9';

describe('detailLinkQuery (spec §8.3: the date pair detail URL, in its order)', () => {
  // why: this literal is the one the engine's alert link (Task 19.3) and the web landing (Task 19.7) tests also use.
  it('is exactly view, def, depart, return, basis, row', () => {
    expect(
      detailLinkQuery({
        definitionId: 'def-1',
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        basis: 'verified',
        row: HASH,
      }),
    ).toBe(`view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=verified&row=${HASH}`);
  });

  it('leaves out row when none is given', () => {
    expect(
      detailLinkQuery({
        definitionId: 'def-1',
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        basis: 'calendar',
      }),
    ).toBe('view=results&def=def-1&depart=2027-03-14&return=2027-03-28&basis=calendar');
  });

  it('encodes a value as a query component (a calendar row key, an id with a space)', () => {
    expect(
      detailLinkQuery({
        definitionId: 'my def',
        departureDate: asIsoDate('2027-03-14'),
        returnDate: asIsoDate('2027-03-28'),
        basis: 'calendar',
        row: 'calendar:7',
      }),
    ).toBe('view=results&def=my+def&depart=2027-03-14&return=2027-03-28&basis=calendar&row=calendar%3A7');
  });

  it('names its parameters once, for the engine and the web', () => {
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
