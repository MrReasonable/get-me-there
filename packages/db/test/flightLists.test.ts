import { asIsoDate, asIsoDateTime, type CellKey, type IsoDateTime, type ListedFlight } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { FlightListsRepo } from '../src/repositories/flightLists.js';
import type { FlightListInsert } from '../src/types.js';
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
    expect(() => repo.insert(list({ flights: [flight(), flight({ durationMinutes: 0 })] }))).toThrow();
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

  it('the table CHECK refuses a forced fixture row and a zero price', () => {
    const { db, definitionId } = setup();
    const raw = (provider: string, kind: string) =>
      db.raw
        .prepare(
          `INSERT INTO flight_lists (definition_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, fetched_at, point_of_sale, currency_native, status, listed, options_unparsed, options_other_cell)
           VALUES (?, ?, ?, 'economy', 'LHR', 'JFK', '2027-03-14', '2027-03-24', '2026-10-14T12:00:00.000Z', 'GB', 'GBP', 'read', 'no-flights', 0, 0)`,
        )
        .run(definitionId, provider, kind);
    expect(() => raw('fixture', 'synthetic')).toThrow(/CHECK/);
    expect(() => raw('camoufox', 'synthetic')).toThrow(/CHECK/);
  });

  it('refuses a price of 0 and a list of more than 30 flights', () => {
    const { repo, list, db } = setup();
    expect(() => repo.insert(list({ flights: [flight({ amountMinor: 0 })] }))).toThrow(/integer/);
    expect(() => repo.insert(list({ flights: Array.from({ length: 31 }, () => flight()) }))).toThrow();
    expect(count(db, 'flight_lists')).toBe(0);
  });

  it('refuses a reason on a read list and a missing one on a failed list, as the CHECKs do', () => {
    const { repo, list, db } = setup();
    expect(() => repo.insert(list({ reason: 'parse' }))).toThrow();
    expect(() => repo.insert(list({ status: 'failed', reason: null, listed: null, flights: [] }))).toThrow();
    expect(count(db, 'flight_lists')).toBe(0);
  });
});

describe('FlightListsRepo.newestPerCell (spec rev 55 §8.1, data-001)', () => {
  it('returns the newest list per requested cell in request order, in one statement', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list({ fetchedAt: hoursAt(9) }));
    const newer = repo.insert(list({ fetchedAt: hoursAt(11), minMinor: 40_000 }));
    const lgw = repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(10) }));
    const asked = [c(LGW, EWR), c()];
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerCell(definitionId, asked, 'economy', 'GB'),
    );
    expect(statements).toBe(1);
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
  it('returns, per date pair, the newest list of any airport pair inside the space, in one statement', () => {
    const { db, repo, list, definitionId } = setup();
    repo.insert(list({ fetchedAt: hoursAt(9) }));
    const lgw = repo.insert(list({ origin: LGW, destination: EWR, fetchedAt: hoursAt(10) }));
    const d2 = repo.insert(list({ ...D2, fetchedAt: hoursAt(8) }));
    const { result, statements } = statementsOf(db, () =>
      repo.newestPerDatePair(definitionId, [D2, D1], space, 'economy', 'GB'),
    );
    expect(statements).toBe(1);
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
    const { repo, list, definitionId, executionId, db } = setup();
    repo.insert(list({ ...failed, fetchedAt: hoursAt(9) })); // D1 failed, then read: counts as read
    repo.insert(list({ fetchedAt: hoursAt(10) }));
    repo.insert(list({ ...D2, ...failed, fetchedAt: hoursAt(9) })); // D2 failed only
    repo.insert(list({ origin: LGW, destination: EWR, listed: 'no-flights', flights: [] })); // read, empty
    repo.insert(list({ ...D2, executionId: null })); // an on-demand list is nobody's
    const other = rawExecution(db, budget);
    repo.insert(list({ executionId: other.executionId, origin: LGW, ...D2 })); // another execution's
    const planned = [c(), c(LHR, JFK, D2), c(LGW, EWR), c(LGW, JFK, D2)];
    expect(repo.forExecution(executionId, planned)).toEqual({ read: 2, failed: 1 });
    expect(definitionId).toBeTruthy();
  });

  it('is zero for no planned cell and for an execution that read nothing', () => {
    const { repo, executionId } = setup();
    expect(repo.forExecution(executionId, [])).toEqual({ read: 0, failed: 0 });
    expect(repo.forExecution(executionId, [c()])).toEqual({ read: 0, failed: 0 });
  });
});
