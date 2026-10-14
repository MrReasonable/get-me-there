import { describe, expect, it } from 'vitest';
import { cellKeyString, parseCellKeyString } from '../../src/types/definition.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

describe('cellKeyString', () => {
  const cell = {
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureDate: asIsoDate('2027-03-14'),
    returnDate: asIsoDate('2027-03-28'),
  };
  it('joins the four keys with | and parses back', () => {
    expect(cellKeyString(cell)).toBe('LHR|JFK|2027-03-14|2027-03-28');
    expect(parseCellKeyString('LHR|JFK|2027-03-14|2027-03-28')).toEqual(cell);
  });
  it.each(['LHR|JFK|2027-03-14', 'LHR|JFK|2027-03-14|2027-02-30', 'LHRX|JFK|2027-03-14|2027-03-28', ''])(
    'rejects %j',
    (s) => {
      expect(() => parseCellKeyString(s)).toThrow();
    },
  );
});
