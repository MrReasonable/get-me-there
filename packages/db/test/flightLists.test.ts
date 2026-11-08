import {
  asIsoDate,
  asIsoDateTime,
  type BookingRead,
  type CellKey,
  type FlightLimits,
  type IsoDateTime,
  type ListedFlight,
  type ListedReturn,
  type ReturnRead,
  returnReadSchema,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { FlightListsRepo } from '../src/repositories/flightLists.js';
import type { FlightListInsert, NewestFlightList, StoredFlightList } from '../src/types.js';
import { freshDb } from './helpers/db.js';
import { EWR, JFK, LGW, LHR, rawExecution } from './helpers/factories.js';
import { statementsOf } from './helpers/history.js';

// Spec revision 55 §7 `flight_lists` / `flight_list_flights` and §8.1: the repository over the two flight-list tables.
// Worked example only: London to New York, LHR/LGW to JFK/EWR.

const budget = { maxCalls: 100, maxFreeCalls: 100, maxCostMicroGbp: 100_000 };
const D1 = { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-28') };
const D2 = { departureDate: asIsoDate('2027-03-15'), returnDate: asIsoDate('2027-03-29') };
/** The cell of an airport pair on a date pair. */
const c = (origin = LHR, destination = JFK, d = D1): CellKey => ({ origin, destination, ...d });
const hoursAt = (h: number): IsoDateTime =>
  asIsoDateTime(`2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`);

function flight(over: Partial<ListedFlight> = {}): ListedFlight {
  return {
    departsLocal: '09:15',
    arrivesLocal: '12:05',
    arrivesDayOffset: 0,
    durationMinutes: 470,
    stops: 0,
    carriers: ['Virgin Atlantic'],
    operatedBy: null,
    amountMinor: 41_200,
    ...over,
  };
}

function setup() {
  const db = freshDb();
  const { definitionId, executionId } = rawExecution(db, budget);
  const repo = new FlightListsRepo(db);
  /** A read list for LHR to JFK on D1 by default. */
  const list = (over: Partial<FlightListInsert> = {}): FlightListInsert => ({
    definitionId,
    executionId,
    providerId: 'camoufox',
    sourceKind: 'scraped-self',
    cabin: 'economy',
    origin: LHR,
    destination: JFK,
    ...D1,
    fetchedAt: hoursAt(12),
    pointOfSale: 'GB',
    status: 'read',
    reason: null,
    listed: 'flights',
    minMinor: 41_200,
    tabMinor: 41_200,
    cheapestView: 'cheapest',
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    resultsStated: 12,
    flights: [flight(), flight({ departsLocal: '18:40', amountMinor: 45_000 })],
    ...over,
  });
  return { db, repo, definitionId, executionId, list };
}
/** The fields of a failed list: a reason, and neither an outcome, a figure nor a flight. */
const failed: Partial<FlightListInsert> = {
  status: 'failed',
  reason: 'parse',
  listed: null,
  minMinor: null,
  tabMinor: null,
  cheapestView: null,
  resultsStated: null,
  flights: [],
};
const count = (db: Db, table: string) =>
  db.raw.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;

describe('FlightListsRepo.insert (spec rev 55 §7)', () => {
  it('writes the list and its flights in page order, and the list reads back whole', () => {
    const { repo, list, definitionId } = setup();
    const id = repo.insert(
      list({
        flights: [
          flight({ departsLocal: '18:40', amountMinor: 45_000 }),
          flight({ carriers: ['British Airways', 'Iberia'], operatedBy: 'American Airlines' }),
          flight({ departsLocal: '07:00', arrivesDayOffset: 1, stops: 1 }),
        ],
      }),
    );
    const [got] = repo.newestPerCell(definitionId, [c()], 'economy', 'GB');
    expect(got?.id).toBe(id);
    expect(got?.flights.map((f) => f.departsLocal)).toEqual(['18:40', '09:15', '07:00']);
    expect(got?.flights[1]).toEqual(
      flight({ carriers: ['British Airways', 'Iberia'], operatedBy: 'American Airlines' }),
    );
    expect(got).toMatchObject({
      origin: LHR,
      destination: JFK,
      status: 'read',
      listed: 'flights',
      reason: null,
      minMinor: 41_200,
      cheapestView: 'cheapest',
      pointOfSale: 'GB',
      resultsStated: 12,
    });
  });

  it('a failed list stores its reason word and no flights; an on-demand list has no execution', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(
      list({
        executionId: null,
        status: 'failed',
        reason: 'parse',
        listed: null,
        minMinor: null,
        tabMinor: null,
        cheapestView: null,
        resultsStated: null,
        flights: [],
      }),
    );
    const [got] = repo.newestPerCell(definitionId, [c()], 'economy', 'GB');
    expect(got).toMatchObject({
      executionId: null,
      status: 'failed',
      reason: 'parse',
      listed: null,
      flights: [],
    });
  });

  it('a refused flight rolls the list back: neither table keeps a row', () => {
    const { db, repo, list } = setup();
    // durationMinutes 0 passes the repository's own checks and is refused by the table's CHECK, after the list row is written
    expect(() => repo.insert(list({ flights: [flight(), flight({ durationMinutes: 0 })] }))).toThrow(
      /flight_list_flights_duration_ck/,
    );
    expect(count(db, 'flight_lists')).toBe(0);
    expect(count(db, 'flight_list_flights')).toBe(0);
  });

  it('refuses a fixture or synthetic list before any SQL, naming the rule', () => {
    const { db, repo, list } = setup();
    const { statements } = statementsOf(db, () => {
      expect(() => repo.insert(list({ providerId: 'fixture', sourceKind: 'synthetic' }))).toThrow(
        /provider-kind/,
      );
      expect(() => repo.insert(list({ sourceKind: 'synthetic' }))).toThrow(/provider-kind/);
      expect(() => repo.insert(list({ providerId: 'searchapi', sourceKind: 'scraped-search' }))).toThrow(
        /provider-kind/,
      );
    });
    expect(statements).toBe(0);
    expect(count(db, 'flight_lists')).toBe(0);
  });

  it('the table CHECKs refuse a forced fixture row, a synthetic kind and a zero price, and accept the genuine row', () => {
    const { db, definitionId } = setup();
    const raw = (provider: string, kind: string, price?: number) => {
      const id = Number(
        db.raw
          .prepare(
            `INSERT INTO flight_lists (definition_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, fetched_at, point_of_sale, currency_native, status, listed, options_unparsed, options_other_cell)
           VALUES (?, ?, ?, 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-24', '2026-10-14T12:00:00.000Z', 'GB', 'GBP', 'read', ?, 0, 0)`,
          )
          .run(definitionId, provider, kind, price === undefined ? 'no-flights' : 'flights').lastInsertRowid,
      );
      if (price !== undefined)
        db.raw
          .prepare(
            `INSERT INTO flight_list_flights (list_id, position, departs_local, arrives_local, arrives_day_offset, duration_minutes, stops, carriers_json, price_pence)
             VALUES (?, 0, '09:15', '12:05', 0, 470, 0, '["Virgin Atlantic"]', ?)`,
          )
          .run(id, price);
    };
    expect(() => raw('fixture', 'synthetic')).toThrow(/flight_lists_provider_ck|flight_lists_kind_ck/);
    expect(() => raw('camoufox', 'synthetic')).toThrow(/flight_lists_kind_ck/);
    expect(() => raw('camoufox', 'scraped-self', 0)).toThrow(/flight_list_flights_price_ck/);
    // the controls: the same inserts with the genuine provider, kind and a positive price succeed, so the throws above are the named CHECKs
    expect(() => raw('camoufox', 'scraped-self')).not.toThrow();
    expect(() => raw('camoufox', 'scraped-self', 41_200)).not.toThrow();
  });

  it('refuses a price of 0 and a list of more than 30 flights', () => {
    const { repo, list, db } = setup();
    expect(() => repo.insert(list({ flights: [flight({ amountMinor: 0 })] }))).toThrow(/integer/);
    expect(() => repo.insert(list({ flights: Array.from({ length: 31 }, () => flight()) }))).toThrow(
      /at most 30 flights/,
    );
    expect(count(db, 'flight_lists')).toBe(0);
  });

  it('refuses a reason on a read list and a missing one on a failed list, as the CHECKs do', () => {
    const { repo, list, db } = setup();
    expect(() => repo.insert(list({ reason: 'parse' }))).toThrow(/a reason exactly when/);
    expect(() => repo.insert(list({ ...failed, reason: null }))).toThrow(/a reason exactly when/);
    expect(count(db, 'flight_lists')).toBe(0);
  });

  it('refuses a failed list that carries flights, a listed word, a minimum, a tab price or a view', () => {
    const { repo, list, db } = setup();
    const f = { ...failed };
    for (const extra of [
      { flights: [flight()] },
      { listed: 'flights' },
      { minMinor: 41_200 },
      { tabMinor: 41_200 },
      { cheapestView: 'cheapest' },
    ] satisfies Partial<FlightListInsert>[])
      expect(() => repo.insert(list({ ...f, ...extra }))).toThrow(/a failed list lists nothing/);
    expect(count(db, 'flight_lists')).toBe(0);
  });
});

describe('FlightListsRepo.newestPerCell (spec rev 55 §8.1, data-001)', () => {
  it('returns the newest list per requested cell in request order, in three statements', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list({ fetchedAt: hoursAt(9) }));
    const newer = repo.insert(list({ fetchedAt: hoursAt(11), minMinor: 40_000 }));
    const lgw = repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(10) }));
    const asked = [c(LGW, EWR), c()];
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerCell(definitionId, asked, 'economy', 'GB'),
    );
    // why: spec rev 56 §7: the lists, then their attempts and returns, then their offers (three statements a lookup)
    expect(statements).toBe(3);
    expect(result.map((l) => l.id)).toEqual([lgw, newer]);
    expect(result[1]?.flights).toHaveLength(2);
  });

  it('returns nothing for a cell never read, and an LHR to JFK list is not LGW to EWR on the same dates', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list());
    expect(repo.newestPerCell(definitionId, [c(LGW, EWR)], 'economy', 'GB')).toEqual([]);
    expect(repo.newestPerCell(definitionId, [c(LHR, JFK, D2)], 'economy', 'GB')).toEqual([]);
    expect(repo.newestPerCell(definitionId, [], 'economy', 'GB')).toEqual([]);
  });

  it('is keyed by point of sale: a list read for another point of sale is not returned', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list({ pointOfSale: 'US' }));
    expect(repo.newestPerCell(definitionId, [c()], 'economy', 'GB')).toEqual([]);
    expect(repo.newestPerCell(definitionId, [c()], 'economy', 'US')).toHaveLength(1);
  });

  it('is keyed by definition: another search’s list is not returned', () => {
    const { db, repo, list } = setup();
    repo.insert(list());
    const other = rawExecution(db, budget);
    expect(repo.newestPerCell(other.definitionId, [c()], 'economy', 'GB')).toEqual([]);
  });

  it('the newest list wins whichever status it has: read newer than failed, and failed newer than read', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list({ ...failed, fetchedAt: hoursAt(9) }));
    const read = repo.insert(list({ fetchedAt: hoursAt(10) }));
    expect(repo.newestPerCell(definitionId, [c()], 'economy', 'GB').map((l) => l.id)).toEqual([read]);
    const lastFailed = repo.insert(list({ ...failed, fetchedAt: hoursAt(11) }));
    expect(repo.newestPerCell(definitionId, [c()], 'economy', 'GB').map((l) => l.id)).toEqual([lastFailed]);
  });

  it('a tie on fetched_at goes to the later row', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list());
    const later = repo.insert(list());
    expect(repo.newestPerCell(definitionId, [c()], 'economy', 'GB').map((l) => l.id)).toEqual([later]);
  });
});

describe('FlightListsRepo.newestPerDatePair', () => {
  const space = { origins: [LHR, LGW], destinations: [JFK, EWR] };
  it('returns, per date pair, the newest list of any airport pair inside the space, in three statements', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list({ fetchedAt: hoursAt(9) }));
    const lgw = repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(10) }));
    const d2 = repo.insert(list({ ...D2, fetchedAt: hoursAt(8) }));
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerDatePair(definitionId, [D2, D1], space, 'economy', 'GB'),
    );
    // why: spec rev 56 §7: the lists, then their attempts and returns, then their offers (three statements a lookup)
    expect(statements).toBe(3);
    expect(result.map((l) => l.id)).toEqual([d2, lgw]);
  });

  it('leaves out an airport pair outside the space and one for another point of sale', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list({ origin: LGW, destination: EWR }));
    repo.insert(list({ pointOfSale: 'US' }));
    expect(
      repo.newestPerDatePair(definitionId, [D1], { origins: [LHR], destinations: [JFK] }, 'economy', 'GB'),
    ).toEqual([]);
    expect(repo.newestPerDatePair(definitionId, [], space, 'economy', 'GB')).toEqual([]);
  });
});

describe('FlightListsRepo.forExecution', () => {
  it('counts the newest row per planned cell of that execution: a pair read twice counts once', () => {
    const { repo, list, executionId, db } = setup();
    repo.insert(list({ ...failed, fetchedAt: hoursAt(9) })); // D1 failed, then read: counts as read
    repo.insert(list({ fetchedAt: hoursAt(10) }));
    repo.insert(list({ ...D2, ...failed, fetchedAt: hoursAt(9) })); // D2 failed only
    repo.insert(list({ origin: LGW, destination: EWR, listed: 'no-flights', flights: [] })); // read, empty
    repo.insert(list({ ...D2, executionId: null })); // an on-demand list is nobody's
    const other = rawExecution(db, budget);
    repo.insert(list({ executionId: other.executionId, origin: LGW, ...D2 })); // another execution's
    const planned = [c(), c(LHR, JFK, D2), c(LGW, EWR), c(LGW, JFK, D2)];
    expect(repo.forExecution(executionId, planned)).toEqual({ read: 2, failed: 1 });
  });

  it('is zero for no planned cell and for an execution that read nothing', () => {
    const { repo, executionId } = setup();
    expect(repo.forExecution(executionId, [])).toEqual({ read: 0, failed: 0 });
    expect(repo.forExecution(executionId, [c()])).toEqual({ read: 0, failed: 0 });
  });
});

// Spec rev 55 §8.1 (Task 20.9): a resumed flight-list step reads only planned cells with no row of this execution, so
// it never writes a pair twice; this is the read it asks.
describe('FlightListsRepo.cellsOfExecution', () => {
  it('lists each cell this execution has a row for once, read or failed, and none of another run or on demand', () => {
    const { repo, list, executionId, db } = setup();
    repo.insert(list({ ...failed, fetchedAt: hoursAt(9) }));
    repo.insert(list({ fetchedAt: hoursAt(10) })); // D1 twice: listed once
    repo.insert(list({ ...D2, ...failed })); // D2 failed only
    repo.insert(list({ origin: LGW, destination: EWR, executionId: null })); // on demand: nobody's
    const other = rawExecution(db, budget);
    repo.insert(list({ executionId: other.executionId, origin: LGW })); // another execution's
    expect(repo.cellsOfExecution(executionId)).toEqual([c(), c(LHR, JFK, D2)]);
    expect(repo.cellsOfExecution('no-such-execution')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Spec revision 56 §7 (migration 0012): the return read and the booking read of a list, written with it in one
// transaction and read back through core's schema. Synthetic carriers (QQ Air, QQ Atlantic) and sellers (QQ Travel,
// QQ Fares); the limits are the test's own.

/** The limits the selection used: 25 h a leg, at most one stop, an outbound departure window. */
const LIMITS: FlightLimits = {
  maxJourneyMinutes: 1500,
  maxStops: 1,
  departureWindowLocal: { from: '06:00', to: '22:00' },
  arrivalWindowLocal: null,
};
function back(over: Partial<ListedReturn> = {}): ListedReturn {
  return {
    departsLocal: '18:05',
    arrivesLocal: '06:20',
    arrivesDayOffset: 1,
    durationMinutes: 435,
    stops: 0,
    carriers: ['QQ Atlantic'],
    operatedBy: null,
    fromMinor: 82_000,
    ...over,
  };
}
/** A finished booking read of attempt 1's second return: three offers, cheapest first. */
function booking(over: Partial<BookingRead> = {}): BookingRead {
  return {
    status: 'read',
    rule: null,
    attempt: 1,
    returnIndex: 1,
    expanded: true,
    moreControl: false,
    grouped: 1,
    offers: [
      { seller: 'QQ Travel', fare: null, priceMinor: 84_500 },
      { seller: 'QQ Fares', fare: 'Economy Light', priceMinor: 85_100 },
      { seller: 'QQ Fares', fare: 'Economy Flex', priceMinor: 91_000 },
    ],
    unparsed: 2,
    nonGbp: 1,
    offersStated: 45,
    ...over,
  };
}
/**
 * A two-attempt return read, through the contract's schema: the first outbound's one return has two stops (over the
 * limits), so the worker tried the second outbound, whose two returns it read and whose second it booked.
 */
function returnRead(over: Partial<ReturnRead> = {}): ReturnRead {
  return returnReadSchema.parse({
    limits: LIMITS,
    status: 'read',
    rule: null,
    attempts: [
      {
        outboundIndex: 0,
        outboundFits: true,
        listed: 'returns',
        moreListed: true,
        returns: [back({ stops: 2, durationMinutes: 900, arrivesDayOffset: 0, fromMinor: 79_000 })],
        optionsUnparsed: 1,
        optionsOtherCell: 0,
        resultsStated: 14,
      },
      {
        outboundIndex: 1,
        outboundFits: true,
        listed: 'returns',
        moreListed: false,
        returns: [
          back(),
          back({
            departsLocal: '21:30',
            arrivesLocal: '09:45',
            durationMinutes: 495,
            stops: 1,
            carriers: ['QQ Atlantic', 'QQ Air'],
            operatedBy: 'QQ Air',
            arrivesDayOffset: -1,
            fromMinor: 84_500,
          }),
        ],
        optionsUnparsed: 0,
        optionsOtherCell: 2,
        resultsStated: null,
      },
    ],
    triedAll: true,
    booking: booking(),
    ...over,
  });
}
/** A return phase that ended without a read (no attempt, no booking), with its rule. */
const ended = (status: ReturnRead['status'], rule: string | null): ReturnRead =>
  returnReadSchema.parse({ limits: LIMITS, status, rule, attempts: [], triedAll: false, booking: null });
/** A read return phase whose booking read ended transient (the offers read before the expansion kept). */
const bookingTransient = (): ReturnRead =>
  returnRead({
    booking: booking({ status: 'expand-failed', rule: 'more-options', expanded: false, offersStated: null }),
  });

describe('FlightListsRepo.insert with returns (spec rev 56 §7, migration 0012)', () => {
  it('writes the columns, the attempts, the returns and the offers in order, and both reads give them back field for field', () => {
    const { db, repo, list, definitionId } = setup();
    const r = returnRead();
    const id = repo.insert(list({ returns: r }));
    expect(
      db.raw
        .prepare(
          'SELECT return_status, return_rule, return_tried_all, booking_status, booking_attempt, booking_return_position, booking_expanded, booking_more_control, booking_grouped, booking_unparsed, booking_non_gbp, booking_offers_stated FROM flight_lists',
        )
        .get(),
    ).toEqual({
      return_status: 'read',
      return_rule: null,
      return_tried_all: 1,
      booking_status: 'read',
      booking_attempt: 1,
      booking_return_position: 1,
      booking_expanded: 1,
      booking_more_control: 0,
      booking_grouped: 1,
      booking_unparsed: 2,
      booking_non_gbp: 1,
      booking_offers_stated: 45,
    });
    expect(
      db.raw.prepare('SELECT attempt, outbound_position FROM flight_list_attempts ORDER BY rowid').all(),
    ).toEqual([
      { attempt: 0, outbound_position: 0 },
      { attempt: 1, outbound_position: 1 },
    ]);
    expect(
      db.raw.prepare('SELECT attempt, position, from_pence FROM flight_list_returns ORDER BY rowid').all(),
    ).toEqual([
      { attempt: 0, position: 0, from_pence: 79_000 },
      { attempt: 1, position: 0, from_pence: 82_000 },
      { attempt: 1, position: 1, from_pence: 84_500 },
    ]);
    expect(
      db.raw
        .prepare('SELECT position, seller, fare, price_pence FROM flight_list_offers ORDER BY rowid')
        .all(),
    ).toEqual([
      { position: 0, seller: 'QQ Travel', fare: null, price_pence: 84_500 },
      { position: 1, seller: 'QQ Fares', fare: 'Economy Light', price_pence: 85_100 },
      { position: 2, seller: 'QQ Fares', fare: 'Economy Flex', price_pence: 91_000 },
    ]);
    const [cell] = repo.newestPerCell(definitionId, [c()], 'economy', 'GB');
    expect(cell?.id).toBe(id);
    expect(cell?.returns).toEqual(r);
    const [pair] = repo.newestPerDatePair(
      definitionId,
      [D1],
      { origins: [LHR], destinations: [JFK] },
      'economy',
      'GB',
    );
    expect(pair?.returns).toEqual(r);
  });

  it('a return phase that ended with no attempt, and one with a transient booking read, read back whole', () => {
    const { repo, list, definitionId } = setup();
    const skipped = ended('skipped', 'spacing');
    repo.insert(list({ returns: skipped }));
    const noOutbound = ended('no-outbound', null);
    repo.insert(list({ ...D2, listed: 'no-flights', flights: [], returns: noOutbound }));
    const transient = bookingTransient();
    repo.insert(list({ origin: LGW, destination: EWR, returns: transient }));
    expect(
      repo
        .newestPerCell(definitionId, [c(), c(LHR, JFK, D2), c(LGW, EWR)], 'economy', 'GB')
        .map((l) => l.returns),
    ).toEqual([skipped, noOutbound, transient]);
  });

  it('an attempt whose return view listed no return for the pair reads back with none, beside the next attempt', () => {
    const { repo, list, definitionId } = setup();
    const base = returnRead();
    const [first, second] = base.attempts;
    if (first === undefined || second === undefined) throw new Error('fixture has two attempts');
    const r = returnReadSchema.parse({
      ...base,
      attempts: [{ ...first, listed: 'none-for-cell', returns: [], optionsOtherCell: 3 }, second],
    });
    repo.insert(list({ returns: r }));
    const [got] = repo.newestPerCell(definitionId, [c()], 'economy', 'GB');
    expect(got?.returns).toEqual(r);
    expect(got?.returns?.attempts.map((a) => a.returns.length)).toEqual([0, 2]);
  });

  it('without returns stores return_status NULL and reads back returns null; so does an explicit null', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list());
    repo.insert(list({ ...D2, returns: null }));
    expect(db.raw.prepare('SELECT return_status, booking_status FROM flight_lists').all()).toEqual([
      { return_status: null, booking_status: null },
      { return_status: null, booking_status: null },
    ]);
    expect(
      repo.newestPerCell(definitionId, [c(), c(LHR, JFK, D2)], 'economy', 'GB').map((l) => l.returns),
    ).toEqual([null, null]);
    expect(count(db, 'flight_list_attempts')).toBe(0);
  });

  it('refuses before any SQL an outbound past the flights, a failed list with returns and a return read the schema refuses', () => {
    const { db, repo, list } = setup();
    const past = returnRead();
    const { statements } = statementsOf(db, () => {
      expect(() =>
        repo.insert(
          list({ returns: { ...past, attempts: past.attempts.map((a) => ({ ...a, outboundIndex: 2 })) } }),
        ),
      ).toThrow(/^return-read: attempt 0's outbound 2 is not one of the list's 2 flights/);
      expect(() => repo.insert(list({ ...failed, returns: ended('skipped', 'spacing') }))).toThrow(
        /a failed list carries no return read/,
      );
      // a read return phase with no attempt: returnReadSchema refuses it
      expect(() => repo.insert(list({ returns: { ...past, attempts: [], booking: null } }))).toThrow(
        /^return-read: .*attempts exactly when/s,
      );
      // an offer of 0 pence
      expect(() =>
        repo.insert(
          list({
            returns: {
              ...past,
              booking: booking({ offers: [{ seller: 'QQ Travel', fare: null, priceMinor: 0 }] }),
            },
          }),
        ),
      ).toThrow(/^return-read: /);
    });
    expect(statements).toBe(0);
    expect(count(db, 'flight_lists')).toBe(0);
  });

  it.each<[string, string, string, string]>([
    ['a return', 'flight_list_returns', 'from_pence', 'flight_list_returns_from_ck'],
    ['an offer', 'flight_list_offers', 'price_pence', 'flight_list_offers_price_ck'],
  ])(
    '%s the table refuses rolls the list, its flights, attempts and returns back',
    (_, table, column, ck) => {
      const { db, repo, list } = setup();
      // why: the schema refuses 0 pence before any SQL, so the table's CHECK is reached by rewriting the row the
      // repository has just written to 0 (a temporary trigger stands in for a stubbed statement; no cast needed)
      db.raw.exec(
        `CREATE TEMP TRIGGER zero_${table} AFTER INSERT ON ${table} BEGIN UPDATE ${table} SET ${column} = 0 WHERE rowid = NEW.rowid; END`,
      );
      expect(() => repo.insert(list({ returns: returnRead() }))).toThrow(new RegExp(ck));
      for (const t of [
        'flight_lists',
        'flight_list_flights',
        'flight_list_attempts',
        'flight_list_returns',
        'flight_list_offers',
      ])
        expect(count(db, t), t).toBe(0);
    },
  );

  it('an on-demand list with returns has no execution', () => {
    const { repo, list, definitionId } = setup();
    repo.insert(list({ executionId: null, returns: returnRead() }));
    const [got] = repo.newestPerCell(definitionId, [c()], 'economy', 'GB');
    expect(got?.executionId).toBeNull();
    expect(got?.returns?.booking?.offers).toHaveLength(3);
  });

  it('a corrupt row names its column: an outbound position past the flights, and stored limits the schema refuses', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list({ returns: returnRead() }));
    db.raw.prepare('UPDATE flight_list_attempts SET outbound_position = 2 WHERE attempt = 1').run();
    expect(() => repo.newestPerCell(definitionId, [c()], 'economy', 'GB')).toThrow(
      /stored flight_list_attempts\.outbound_position is not valid/,
    );
    db.raw.prepare('UPDATE flight_list_attempts SET outbound_position = 1 WHERE attempt = 1').run();
    db.raw.prepare(`UPDATE flight_lists SET return_limits_json = '{"maxJourneyMinutes":0}'`).run();
    expect(() => repo.newestPerCell(definitionId, [c()], 'economy', 'GB')).toThrow(
      /stored flight_lists\.return_\* is not valid/,
    );
  });
});

describe('the lookups with nothing to read (spec rev 56 §7)', () => {
  it('no ask runs no statement, a lookup that chooses no list runs one, and a booking that kept no offer reads back with none', () => {
    const { db, repo, list, definitionId } = setup();
    const space = { origins: [LHR], destinations: [JFK] };
    expect(statementsOf(db, () => repo.newestPerCell(definitionId, [], 'economy', 'GB'))).toEqual({
      result: [],
      statements: 0,
    });
    expect(statementsOf(db, () => repo.newestPerDatePair(definitionId, [], space, 'economy', 'GB'))).toEqual({
      result: [],
      statements: 0,
    });
    expect(statementsOf(db, () => repo.newestOfCells(definitionId, [], 'economy', 'GB', null))).toEqual({
      result: [],
      statements: 0,
    });
    expect(statementsOf(db, () => repo.newestOfCells(definitionId, [c()], 'economy', 'GB', null))).toEqual({
      result: [],
      statements: 1,
    });
    const none = returnRead({
      booking: booking({
        status: 'expand-failed',
        rule: 'more-options',
        expanded: false,
        offersStated: null,
        offers: [],
      }),
    });
    repo.insert(list({ returns: none }));
    expect(repo.newestOfCells(definitionId, [c()], 'economy', 'GB', null)[0]?.returns).toEqual(none);
  });
});

describe('transientStreak (spec rev 56 §7, §8.1 reuse: one retry, then refresh)', () => {
  it('counts the cell’s two newest lists that ended transient, newest first, stopping at the first finished one', () => {
    const { db, repo, list, definitionId } = setup();
    // LHR-JFK on D1: two transient ends (a not-settled return, then a transient booking read) → 2
    repo.insert(list({ fetchedAt: hoursAt(8), returns: returnRead() }));
    repo.insert(list({ fetchedAt: hoursAt(9), returns: bookingTransient() }));
    repo.insert(list({ fetchedAt: hoursAt(10), returns: ended('not-settled', 'not-settled') }));
    // LHR-JFK on D2: a finished read under a transient one → 1
    repo.insert(list({ ...D2, fetchedAt: hoursAt(9), returns: returnRead() }));
    repo.insert(list({ ...D2, fetchedAt: hoursAt(10), returns: ended('skipped', 'spacing') }));
    // LGW-EWR on D1: a transient end under a finished newest → 0
    repo.insert(
      list({
        origin: LGW,
        destination: EWR,
        fetchedAt: hoursAt(9),
        returns: ended('select-failed', 'click'),
      }),
    );
    repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(10), returns: returnRead() }));
    // LGW-JFK on D1: a failed newest ended no return phase → 0; LHR-EWR on D1: one transient list alone → 1
    repo.insert(
      list({ origin: LGW, destination: JFK, fetchedAt: hoursAt(9), returns: ended('unrecognised', 'shape') }),
    );
    repo.insert(list({ origin: LGW, destination: JFK, fetchedAt: hoursAt(10), ...failed }));
    repo.insert(list({ origin: LHR, destination: EWR, returns: ended('not-settled', 'not-settled') }));
    const asked = [c(), c(LHR, JFK, D2), c(LGW, EWR), c(LGW, JFK), c(LHR, EWR)];
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerCell(definitionId, asked, 'economy', 'GB'),
    );
    expect(statements).toBe(3);
    expect(result.map((l) => l.transientStreak)).toEqual([2, 1, 0, 0, 1]);
    // a list with no return phase (an outbound-only read) is not transient
    repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(11) }));
    expect(repo.newestPerCell(definitionId, [c(LGW, EWR)], 'economy', 'GB')[0]?.transientStreak).toBe(0);
    const space = { origins: [LHR], destinations: [JFK] };
    expect(
      repo.newestPerDatePair(definitionId, [D1, D2], space, 'economy', 'GB').map((l) => l.transientStreak),
    ).toEqual([2, 1]);
  });

  it('a booking read that ended skipped counts toward the streak, whatever its rule (ruling 21.6 I1)', () => {
    const { repo, list, definitionId } = setup();
    const skipped = (rule: string): ReturnRead =>
      returnRead({
        booking: booking({
          status: 'skipped',
          rule,
          attempt: null,
          returnIndex: null,
          expanded: false,
          moreControl: false,
          grouped: 0,
          offers: [],
          unparsed: 0,
          nonGbp: 0,
          offersStated: null,
        }),
      });
    // LHR-JFK on D1: two skipped booking reads in a row → 2; D2: one, under a finished read → 1
    repo.insert(list({ fetchedAt: hoursAt(9), returns: skipped('not-cheapest-view') }));
    repo.insert(list({ fetchedAt: hoursAt(10), returns: skipped('spacing') }));
    repo.insert(list({ ...D2, fetchedAt: hoursAt(9), returns: returnRead() }));
    repo.insert(list({ ...D2, fetchedAt: hoursAt(10), returns: skipped('second-selection') }));
    expect(
      repo.newestPerCell(definitionId, [c(), c(LHR, JFK, D2)], 'economy', 'GB').map((l) => l.transientStreak),
    ).toEqual([2, 1]);
  });

  it('a page of 50 cells is still three statements', () => {
    const { db, repo, list, definitionId } = setup();
    const cells = Array.from({ length: 50 }, (_, i) =>
      c(LHR, JFK, {
        departureDate: asIsoDate(`2027-0${1 + Math.floor(i / 25)}-${String(1 + (i % 25)).padStart(2, '0')}`),
        returnDate: asIsoDate('2027-04-28'),
      }),
    );
    for (const k of cells) repo.insert(list({ ...k, returns: returnRead() }));
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerCell(definitionId, cells, 'economy', 'GB'),
    );
    expect(statements).toBe(3);
    expect(result).toHaveLength(50);
    expect(result.every((l) => l.returns?.booking?.offers.length === 3)).toBe(true);
  });
});

/** A list as `newestOfCells` returns it: the stored list, without the streak `newestPerCell` adds. */
function storedOf(l: NewestFlightList | undefined): StoredFlightList | undefined {
  if (l === undefined) return undefined;
  const { transientStreak: _streak, ...stored } = l;
  return stored;
}
/** A second completed execution of the definition, for the scope tests. */
function insertExecution(db: Db, definitionId: string, id: string): void {
  db.raw
    .prepare(
      `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at) VALUES (?, ?, '{}', 'manual', 'completed', ?)`,
    )
    .run(id, definitionId, hoursAt(8));
}

describe('FlightListsRepo.newestOfCells (spec rev 56 §6.9, §7; 21.6 review M6, prov-002)', () => {
  it('returns the newest list of each asked cell, any status, with its returns and offers, in three statements', () => {
    const { db, repo, list, definitionId } = setup();
    // LHR-JFK on D1: an older read under a newer one → the newer
    repo.insert(list({ fetchedAt: hoursAt(9), returns: returnRead() }));
    const newest = repo.insert(list({ fetchedAt: hoursAt(10), returns: returnRead({ triedAll: false }) }));
    // LGW-EWR on D1: a finished read under a newer not-settled one → the newer (the api reads it outbound-only)
    repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(9), returns: returnRead() }));
    const transient = repo.insert(
      list({
        origin: LGW,
        destination: EWR,
        fetchedAt: hoursAt(10),
        returns: ended('not-settled', 'not-settled'),
      }),
    );
    // LHR-EWR on D1: a failed newest → the failed list (the api words its cause)
    repo.insert(list({ origin: LHR, destination: EWR, fetchedAt: hoursAt(9), returns: returnRead() }));
    const failedList = repo.insert(
      list({ origin: LHR, destination: EWR, fetchedAt: hoursAt(10), ...failed }),
    );
    // LHR-JFK on D2: a list of a cell not asked is never read (M6: not every finished list of the search)
    repo.insert(list({ ...D2, listed: 'no-flights', flights: [], returns: ended('no-outbound', null) }));
    // another point of sale is not read
    repo.insert(list({ pointOfSale: 'US', fetchedAt: hoursAt(11), returns: returnRead() }));
    const asked = [c(), c(LGW, EWR), c(LHR, EWR), c(LGW, JFK)];
    const { result, statements } = statementsOf(db, () =>
      repo.newestOfCells(definitionId, asked, 'economy', 'GB', null),
    );
    expect(statements).toBe(3);
    expect(result.map((l) => l.id)).toEqual([newest, transient, failedList]);
    // the same lists newestPerCell gives, field for field, less the streak that read adds
    const all = repo.newestPerCell(definitionId, asked, 'economy', 'GB');
    expect(result).toEqual(all.map(storedOf));
    expect(result[0]?.returns).toEqual(returnRead({ triedAll: false }));
    expect(repo.newestOfCells(definitionId, [], 'economy', 'GB', null)).toEqual([]);
    expect(repo.newestOfCells(rawExecution(db, budget).definitionId, asked, 'economy', 'GB', null)).toEqual(
      [],
    );
  });

  // why: 21.5 review M1: the streak is the step's reuse rule (newestPerCell); this read carries none, scoped or not, so
  // no caller reads a streak built partly from another execution's list
  it('returns stored lists without a transientStreak, scoped or not', () => {
    const { db, repo, list, definitionId, executionId } = setup();
    insertExecution(db, definitionId, 'e-other');
    repo.insert(list({ executionId: 'e-other', fetchedAt: hoursAt(8), returns: bookingTransient() }));
    const mine = repo.insert(list({ fetchedAt: hoursAt(9), returns: bookingTransient() }));
    repo.insert(list({ executionId: 'e-other', fetchedAt: hoursAt(10), returns: bookingTransient() }));
    const scoped = repo.newestOfCells(definitionId, [c()], 'economy', 'GB', { executionIds: [executionId] });
    expect(scoped.map((l) => l.id)).toEqual([mine]);
    expect(scoped[0]).not.toHaveProperty('transientStreak');
    const all = repo.newestOfCells(definitionId, [c()], 'economy', 'GB', null);
    expect(all).toHaveLength(1);
    expect(all[0]).not.toHaveProperty('transientStreak');
  });

  // why: prov-002: inside a scope the newest list is the scope's own, whatever its status, so a newer list outside the
  // scope (an on-demand one here) never makes a cell the scoped run did read look unread
  it('within a scope: the newest in-scope list of any status; a newer list outside the scope does not hide it', () => {
    const { repo, list, definitionId, executionId } = setup();
    const scope = { executionIds: [executionId] };
    repo.insert(list({ fetchedAt: hoursAt(9), returns: returnRead() }));
    const transient = repo.insert(
      list({ fetchedAt: hoursAt(10), returns: ended('not-settled', 'not-settled') }),
    );
    repo.insert(list({ executionId: null, fetchedAt: hoursAt(11), returns: returnRead() }));
    const outboundOnly = repo.insert(list({ ...D2, fetchedAt: hoursAt(9) }));
    const onDemand = repo.insert(
      list({ ...D2, executionId: null, fetchedAt: hoursAt(11), returns: returnRead() }),
    );
    const cells = [c(), c(LHR, JFK, D2)];
    expect(repo.newestOfCells(definitionId, cells, 'economy', 'GB', scope).map((l) => l.id)).toEqual([
      transient,
      outboundOnly,
    ]);
    expect(
      repo.newestOfCells(definitionId, [c(LHR, JFK, D2)], 'economy', 'GB', null).map((l) => l.id),
    ).toEqual([onDemand]);
  });

  it('under an executionIds scope reads only lists of those executions; an on-demand list is in no scope', () => {
    const { db, repo, list, definitionId, executionId } = setup();
    const other = { executionId: 'e-other' };
    insertExecution(db, definitionId, other.executionId);
    const mine = repo.insert(list({ fetchedAt: hoursAt(9), returns: returnRead() }));
    const theirs = repo.insert(
      list({ executionId: other.executionId, fetchedAt: hoursAt(10), returns: returnRead() }),
    );
    const onDemand = repo.insert(list({ ...D2, executionId: null, returns: returnRead() }));
    const cells = [c(), c(LHR, JFK, D2)];
    const ids = (scope: { executionIds: readonly string[] } | null) =>
      repo.newestOfCells(definitionId, cells, 'economy', 'GB', scope).map((l) => l.id);
    expect(ids({ executionIds: [executionId] })).toEqual([mine]);
    expect(ids({ executionIds: [other.executionId] })).toEqual([theirs]);
    expect(ids({ executionIds: [] })).toEqual([]);
    expect(ids(null)).toEqual([theirs, onDemand]);
  });
});
