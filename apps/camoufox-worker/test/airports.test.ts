import { describe, expect, it } from 'vitest';
import { airportMatches, fold } from '../src/airports.js';

describe('airportMatches (prov-006)', () => {
  it('a word-suffix matches: "Heathrow Airport" in "London Heathrow Airport"', () => {
    expect(airportMatches('Heathrow Airport', ['London Heathrow Airport'])).toBe(true);
    expect(airportMatches('London Heathrow Airport', ['Heathrow Airport'])).toBe(true);
  });
  it('punctuation and case fold: "John F. Kennedy International Airport" matches "John F Kennedy International Airport"', () => {
    expect(
      airportMatches('John F. Kennedy International Airport', ['John F Kennedy International Airport']),
    ).toBe(true);
    // why: the worked example's airport only; a synthetic diacritic keeps the NFKD fold covered
    expect(fold('  John F. Kennedy–Internatiönal ')).toBe('john f kennedy international');
  });
  it('Newark does not match JFK’s names; a generic suffix never matches', () => {
    expect(
      airportMatches('Newark Liberty International Airport', ['John F Kennedy International Airport']),
    ).toBe(false);
    expect(airportMatches('International Airport', ['John F Kennedy International Airport'])).toBe(false);
    expect(airportMatches('Kennedy Airport', ['John F Kennedy International Airport'])).toBe(false);
  });
  it('an alias listed in the table matches', () => {
    expect(airportMatches('JFK Terminal', ['John F Kennedy International Airport'])).toBe(false);
    expect(
      airportMatches(
        'JFK Terminal',
        ['John F Kennedy International Airport'],
        [{ google: 'JFK Terminal', dataset: 'John F Kennedy International Airport', recorded: '2026-10-20' }],
      ),
    ).toBe(true);
  });
  it('an empty dataset list, or an empty Google name, never matches', () => {
    expect(airportMatches('Heathrow Airport', [])).toBe(false);
    expect(airportMatches('', ['London Heathrow Airport'])).toBe(false);
    expect(airportMatches('Heathrow Airport', [''])).toBe(false);
  });
});
