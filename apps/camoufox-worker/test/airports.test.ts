import { describe, expect, it } from 'vitest';
import { airportMatches, fold } from '../src/airports.js';

const HEATHROW = ['London Heathrow Airport'];
const GATWICK = ['London Gatwick Airport'];
const THIRD = ['London Qqthird Airport'];
const JFK = ['John F Kennedy International Airport'];
const NEWARK = ['Newark Liberty International Airport'];

describe('airportMatches (prov-006; spec §2 "Airport names")', () => {
  it('a word-suffix matches: "Heathrow Airport" in "London Heathrow Airport"', () => {
    expect(airportMatches('Heathrow Airport', HEATHROW, [])).toBe(true);
    expect(airportMatches('London Heathrow Airport', ['Heathrow Airport'], [])).toBe(true);
  });
  it('punctuation and case fold: "John F. Kennedy International Airport" matches "John F Kennedy International Airport"', () => {
    expect(airportMatches('John F. Kennedy International Airport', JFK, [])).toBe(true);
    // why: the worked example's airport only; a synthetic diacritic keeps the NFKD fold covered
    expect(fold('  John F. Kennedy–Internatiönal ')).toBe('john f kennedy international');
  });
  it('a page name sharing one distinctive word matches the one chosen airport: "Kennedy Airport" is JFK', () => {
    // why: the dataset's "<City> Airport" where the page says "<City> <Name> Airport" (seen 2026-11-03)
    expect(airportMatches('Qqcity Example Airport', ['Qqcity Airport'], [])).toBe(true);
    expect(airportMatches('Kennedy Airport', JFK, [])).toBe(true);
  });
  it('a name sharing only generic words, or nothing, never matches', () => {
    expect(airportMatches('Newark Liberty International Airport', JFK, [])).toBe(false);
    expect(airportMatches('International Airport', JFK, [])).toBe(false);
  });
  it('among the chosen airports the best fit wins: London (all) tells Heathrow from Gatwick and a third London airport', () => {
    const others = [GATWICK, THIRD];
    expect(airportMatches('Heathrow Airport', HEATHROW, others)).toBe(true);
    expect(airportMatches('London Heathrow Airport', HEATHROW, others)).toBe(true);
    expect(airportMatches('Gatwick Airport', HEATHROW, others)).toBe(false);
    expect(airportMatches('Gatwick Airport', GATWICK, [HEATHROW, THIRD])).toBe(true);
  });
  it('a close fit beats a shared word: with both chosen, the longer name is its own airport, the shorter its own', () => {
    const plain = ['Qqcity Airport'];
    const longer = ['Qqcity South Example Airport'];
    expect(airportMatches('Qqcity South Example Airport', plain, [longer])).toBe(false);
    expect(airportMatches('Qqcity South Example Airport', longer, [plain])).toBe(true);
    expect(airportMatches('Qqcity Airport', plain, [longer])).toBe(true);
    expect(airportMatches('Qqcity Airport', longer, [plain])).toBe(false);
  });
  it('more shared words beat fewer; a tie between chosen airports is no match', () => {
    expect(airportMatches('Qqcity North Airport', ['Qqcity North Field'], [['Qqcity Field']])).toBe(true);
    expect(airportMatches('London Airport', HEATHROW, [GATWICK])).toBe(false);
    expect(airportMatches('London Airport', GATWICK, [HEATHROW])).toBe(false);
  });
  it('a chosen airport the page did not name does not stop a match: Newark chosen beside JFK', () => {
    expect(airportMatches('John F. Kennedy International Airport', JFK, [NEWARK])).toBe(true);
    expect(airportMatches('John F. Kennedy International Airport', NEWARK, [JFK])).toBe(false);
  });
  it('an alias listed in the table matches', () => {
    expect(airportMatches('JFK Terminal', JFK, [])).toBe(false);
    expect(
      airportMatches(
        'JFK Terminal',
        JFK,
        [],
        [{ google: 'JFK Terminal', dataset: 'John F Kennedy International Airport', recorded: '2026-10-20' }],
      ),
    ).toBe(true);
  });
  it('an empty dataset list, or an empty Google name, never matches', () => {
    expect(airportMatches('Heathrow Airport', [], [])).toBe(false);
    expect(airportMatches('', HEATHROW, [])).toBe(false);
    expect(airportMatches('Heathrow Airport', [''], [])).toBe(false);
    expect(airportMatches('Heathrow Airport', HEATHROW, [['']])).toBe(true);
  });
});
