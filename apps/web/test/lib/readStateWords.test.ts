import { PAIRING_READ, type PairingRead, stopDetailClause } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';
import { readStateWords } from '../../src/lib/readStateWords.js';

// Ruling 5 (Trips and Search plan): a calendar price's flight read in one line, from the figure's own fields.

const words = (
  pairingRead: PairingRead,
  listReason: Parameters<typeof readStateWords>[0]['listReason'] = null,
) => readStateWords({ pairingRead, listReason });

describe('readStateWords', () => {
  it('has words for every PairingRead, each its own', () => {
    const all = PAIRING_READ.map((r) => words(r));
    expect(all.every((w) => w.length > 0)).toBe(true);
    expect(new Set(all).size).toBe(PAIRING_READ.length);
  });
  it("says the three lower-on-the-calendar reads in the plan's words", () => {
    expect(words('not-read')).toBe('Flights not read');
    expect(words('outbound-only')).toBe('Return flights not read');
    expect(words('list-failed')).toBe("Flights couldn't be read");
  });
  // why: CodeRabbit CR43 (coordinator ruling): `over-limit` means no trip met every limit (journey, stops, the
  // windows), so its words name the limits as a whole, never the journey limit alone
  it('says an over-limit read is outside the limits as a whole, as the Trip card does', () => {
    expect(words('over-limit')).toBe('Flights read, none within your limits');
    expect(words('over-limit')).not.toMatch(/journey/);
  });
  it('names the reason of a failed read and never says "not read" of it', () => {
    const w = words('list-failed', 'network');
    expect(w).toBe(`Flights couldn't be read: ${stopDetailClause('network', 'camoufox', true)}`);
    expect(w).not.toMatch(/not read/i);
  });
  it('says every other read without "not read" unless it is about sellers or returns', () => {
    for (const r of PAIRING_READ.filter((x) => x !== 'list-failed')) expect(words(r)).not.toMatch(/couldn't/);
  });
  it("is what the Trip card's calendar sentence starts with, so the two cannot drift", () => {
    expect(COPY.trip.calendarOnly.startsWith(words('not-read'))).toBe(true);
  });
});
