// The recorder's command line for the select-outbound kind (WP21 Task 21.0): the mode flag, its page bound, and the
// same request checks the results kind applies. The other kinds' cases live in record.test.ts's `parseRecordArgs`.
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGES, parseRecordArgs } from '../src/recordArgs.js';

const Q = ['--origin', 'LHR', '--destination', 'JFK', '--depart', '2027-03-14', '--return', '2027-03-24'];

beforeEach(() => {
  expect.hasAssertions();
});

describe('parseRecordArgs --select-outbound (WP21 Task 21.0)', () => {
  it('parses to the select-outbound kind, one page by default, with the request', () => {
    expect(parseRecordArgs(['--select-outbound', ...Q])).toEqual({
      kind: 'select-outbound',
      request: {
        origin: 'LHR',
        destination: 'JFK',
        departureDate: '2027-03-14',
        returnDate: '2027-03-24',
      },
      pages: 1,
      moves: [],
    });
  });
  it('accepts --pages 2 and refuses 3, though the other kinds keep their bound of 3', () => {
    expect(parseRecordArgs(['--select-outbound', ...Q, '--pages', '2']).pages).toBe(2);
    expect(() => parseRecordArgs(['--select-outbound', ...Q, '--pages', '3'])).toThrow(
      '--pages must be 1 to 2 for --select-outbound',
    );
    expect(MAX_PAGES).toBe(3);
    expect(parseRecordArgs([...Q, '--pages', '3']).pages).toBe(3);
  });
  it('is a mode flag: with another one it is refused', () => {
    for (const other of ['--cheapest', '--view-more', '--no-flights', '--grid'])
      expect(() => parseRecordArgs(['--select-outbound', other, ...Q]), other).toThrow(/at most one/);
    expect(() => parseRecordArgs(['--select-outbound', '--cheapest', ...Q])).toThrow(/--select-outbound/);
  });
  it('needs the request the results kind needs', () => {
    expect(() => parseRecordArgs(['--select-outbound', ...Q.slice(2)])).toThrow(
      '--origin and --destination must be IATA codes',
    );
    expect(() => parseRecordArgs(Q.slice(2))).toThrow('--origin and --destination must be IATA codes');
    expect(() =>
      parseRecordArgs([
        '--select-outbound',
        ...Q.slice(0, 4),
        '--depart',
        '2027-03-24',
        '--return',
        '2027-03-14',
      ]),
    ).toThrow(/return after/);
  });
});
