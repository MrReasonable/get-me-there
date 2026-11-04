import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { type AirportNames, cellAirportNames } from '../../src/stages/discovery.js';

const LHR = asIata('LHR');
const LGW = asIata('LGW');
const LCY = asIata('LCY');
const JFK = asIata('JFK');
const EWR = asIata('EWR');
const QQX = asIata('QQX');
// why: QQX stands for a chosen code the airports dataset does not know
const DATASET: Partial<Record<string, string>> = {
  LHR: 'London Heathrow Airport',
  LGW: 'London Gatwick Airport',
  LCY: 'London City Airport',
  JFK: 'John F Kennedy International Airport',
  EWR: 'Newark Liberty International Airport',
};
const names: AirportNames = (iata) => {
  const n = DATASET[iata];
  return n === undefined ? [] : [n];
};

describe('cellAirportNames (spec §2 "Airport names")', () => {
  it('names the cell’s two airports and, apart, the search’s other chosen airports on each side', () => {
    expect(cellAirportNames(names, { origins: [LHR, LGW, LCY], destinations: [JFK, EWR] }, LGW, JFK)).toEqual(
      {
        origin: ['London Gatwick Airport'],
        destination: ['John F Kennedy International Airport'],
        otherOrigins: [['London Heathrow Airport'], ['London City Airport']],
        otherDestinations: [['Newark Liberty International Airport']],
      },
    );
  });
  it('one airport a side has no others; a chosen code the dataset does not know is left out', () => {
    expect(cellAirportNames(names, { origins: [LHR], destinations: [JFK] }, LHR, JFK)).toEqual({
      origin: ['London Heathrow Airport'],
      destination: ['John F Kennedy International Airport'],
      otherOrigins: [],
      otherDestinations: [],
    });
    expect(
      cellAirportNames(names, { origins: [LHR, QQX], destinations: [JFK] }, LHR, JFK).otherOrigins,
    ).toEqual([]);
  });
});
