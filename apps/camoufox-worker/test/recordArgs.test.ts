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
      forceSecond: false,
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

// why: Ian's ruling of 2026-11-01 (read the booking options): a sibling kind that selects the outbound, then the
// cheapest return, and records the booking view without activating anything on it
describe('parseRecordArgs --select-return', () => {
  it('parses to the select-return kind with the request, one page by default, at most 2', () => {
    expect(parseRecordArgs(['--select-return', ...Q])).toMatchObject({
      kind: 'select-return',
      pages: 1,
      moves: [],
    });
    expect(parseRecordArgs(['--select-return', ...Q, '--pages', '2']).pages).toBe(2);
    expect(() => parseRecordArgs(['--select-return', ...Q, '--pages', '3'])).toThrow(
      '--pages must be 1 to 2 for --select-return',
    );
  });
  it('is a mode flag, and needs the request', () => {
    expect(() => parseRecordArgs(['--select-return', '--select-outbound', ...Q])).toThrow(/at most one/);
    expect(() => parseRecordArgs(['--select-return', ...Q.slice(2)])).toThrow(
      '--origin and --destination must be IATA codes',
    );
  });
});

// why: WP21 Task 21.3 (R-e2e): the end-to-end recording of the full served path before the flags flip: the first
// outbound's returns treated as not fitting, the reload, the second outbound, its return, the booking view, the expansion
describe('parseRecordArgs --force-second (WP21 Task 21.3)', () => {
  it('is an option of --select-return only', () => {
    expect(parseRecordArgs(['--select-return', '--force-second', ...Q])).toMatchObject({
      kind: 'select-return',
      forceSecond: true,
    });
    expect(parseRecordArgs(['--select-return', ...Q]).forceSecond).toBe(false);
    for (const other of [[], ['--select-outbound'], ['--cheapest']])
      expect(() => parseRecordArgs([...other, '--force-second', ...Q]), other.join(' ')).toThrow(
        '--force-second needs --select-return',
      );
  });
  it('is no mode flag: it never counts as a second one', () => {
    expect(() => parseRecordArgs(['--select-return', '--force-second', '--cheapest', ...Q])).toThrow(
      /at most one/,
    );
    expect(parseRecordArgs(['--force-second', '--select-return', ...Q]).kind).toBe('select-return');
  });
});
