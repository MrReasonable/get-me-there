// Revision 74: an airport in words, one rule for the web and the Status report.
import { describe, expect, it } from 'vitest';
import { airportLabel, airportShortName, airportWithCode } from '../../src/labels/airport.js';

const heathrow = { name: 'London Heathrow Airport', city: 'London' };

describe('airportShortName', () => {
  it('drops a trailing Airport or International Airport, and keeps a name that is only that', () => {
    expect(airportShortName('London Heathrow Airport')).toBe('London Heathrow');
    expect(airportShortName('John F Kennedy International Airport')).toBe('John F Kennedy');
    expect(airportShortName('Newark Liberty')).toBe('Newark Liberty');
    expect(airportShortName(' Airport')).toBe(' Airport');
  });
});

describe('airportLabel', () => {
  it('drops the city in front, and is the code with no row', () => {
    expect(airportLabel('LHR', heathrow)).toBe('Heathrow');
    expect(airportLabel('JFK', { name: 'John F Kennedy International Airport', city: 'New York' })).toBe(
      'John F Kennedy',
    );
    expect(airportLabel('QQA', undefined)).toBe('QQA');
    expect(airportLabel('QQA', null)).toBe('QQA');
    expect(airportLabel('QQB', { name: 'Testville Airport', city: 'Testville' })).toBe('Testville');
  });
});

describe('airportWithCode', () => {
  it('adds the code to a name, and is the code alone when there is no name', () => {
    expect(airportWithCode('LHR', heathrow)).toBe('Heathrow (LHR)');
    expect(airportWithCode('QQA', null)).toBe('QQA');
  });
});
