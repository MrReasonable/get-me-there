import { describe, expect, it } from 'vitest';
import { cellKeyString, isScheduled, parseCellKeyString } from '../../src/types/definition.js';
import { asIata, asIsoDate, asIsoDateTime } from '../../src/types/ids.js';

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

describe("isScheduled (spec rev 55 §8.1: the engine's one schedule predicate)", () => {
  const scheduled = { enabled: true, scheduleCron: '0 5 * * 1', deletedAt: null };
  it('is true for an enabled search with a cron that is not deleted', () => {
    expect(isScheduled(scheduled)).toBe(true);
  });
  it.each([
    ['not enabled', { ...scheduled, enabled: false }],
    ['no cron', { ...scheduled, scheduleCron: null }],
    ['deleted', { ...scheduled, deletedAt: asIsoDateTime('2027-03-01T10:00:00.000Z') }],
  ])('is false when %s', (_name, d) => {
    expect(isScheduled(d)).toBe(false);
  });
});
