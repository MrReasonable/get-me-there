// The moved-database marker's one format (spec §13; WP16a review R26): written and read by the same two functions.
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { MOVED_MARKER, movedMarkerText, parseMovedMarker } from '../../src/local/movedMarker.js';
import { asIsoDateTime } from '../../src/types/ids.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('the MOVED-TO-NATIVE marker (spec §13)', () => {
  it('its first line is the move’s ISO instant in UTC; the reader reads back what the writer wrote', () => {
    const at = asIsoDateTime('2027-03-01T23:30:00.000Z');
    expect(MOVED_MARKER).toBe('MOVED-TO-NATIVE');
    expect(movedMarkerText(at)).toBe('2027-03-01T23:30:00.000Z\n');
    expect(parseMovedMarker(movedMarkerText(at))).toBe(at);
    expect(parseMovedMarker('2027-03-01T23:30:00.000Z\nmoved by gmt import\n')).toBe(at);
    // a marker with no newline, or one edited on another system (spaces, a CR) reads the same
    expect(parseMovedMarker('2027-03-01T23:30:00.000Z')).toBe(at);
    expect(parseMovedMarker('  2027-03-01T23:30:00.000Z \r\nnote')).toBe(at);
  });
  it.each(['', '2027-03-01', '2027-13-45T00:00:00.000Z', 'moved\n2027-03-01T23:30:00.000Z'])(
    'a first line that is no instant (%j) reads as none',
    (text) => {
      expect(parseMovedMarker(text)).toBeNull();
    },
  );
  it('is in the barrel', () => {
    expect(core.parseMovedMarker).toBe(parseMovedMarker);
    expect(core.MOVED_MARKER).toBe(MOVED_MARKER);
  });
});
