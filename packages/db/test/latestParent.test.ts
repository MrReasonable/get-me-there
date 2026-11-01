// Spec revision 55 §10 (the cards): `latestParentPerDefinition` is the newest parent run of each definition, by
// created_at then rowid, children and tool runs left out, read in one statement; `searchedDatePairs` is each card's
// searched date pairs, by core's one predicate, in one statement bounded by the spaces read.
import {
  asIata,
  asIsoDate,
  type Buckets,
  type CellOutcomeStatus,
  datePairSearched,
  fixedClock,
} from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CellsRepo, SEARCHED_DATE_PAIR_SQL } from '../src/repositories/cells.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import { freshDb, T0 } from './helpers/db.js';
import { exampleDefinitionInput, snapshotOf } from './helpers/factories.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('ExecutionsRepo.latestParentPerDefinition (revision 55 §10)', () => {
  it('returns the newest parent per definition, children and tool runs excluded, ties broken by insertion', () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const defs = new DefinitionsRepo(db, clock);
    const repo = new ExecutionsRepo(db, clock);
    const a = defs.create(exampleDefinitionInput({ name: 'a' }));
    const b = defs.create(exampleDefinitionInput({ name: 'b' }));
    const c = defs.create(exampleDefinitionInput({ name: 'c' }));
    defs.create(exampleDefinitionInput({ name: 'never run' }));
    const run = (d: typeof a, over: { trigger?: 'manual' | 'schedule' | 'tool'; child?: boolean } = {}) => {
      const e = repo.create({
        definitionId: d.id,
        isChild: over.child === true,
        cell:
          over.child === true
            ? {
                origin: asIata('LHR'),
                destination: asIata('JFK'),
                departureDate: asIsoDate('2027-03-14'),
                returnDate: asIsoDate('2027-03-24'),
              }
            : null,
        snapshot: snapshotOf(d),
        estimate: null,
        trigger: over.trigger ?? 'manual',
        status: 'running',
      });
      repo.setStatus(e.id, 'completed', { finishedAt: clock.now() });
      return e.id;
    };
    run(a);
    clock.advance(1000);
    const aNew = run(a, { trigger: 'schedule' });
    clock.advance(1000);
    run(a, { child: true }); // a child after it is no parent
    // why: the same created_at twice; the later insert is the newer
    run(b);
    const bNew = run(b);
    clock.advance(1000);
    run(b, { trigger: 'tool' }); // a tool run after it is no search run
    run(c, { trigger: 'tool' }); // a definition with tool runs only has none
    const latest = repo.latestParentPerDefinition();
    expect([...latest.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(latest.get(a.id)?.id).toBe(aNew);
    expect(latest.get(b.id)?.id).toBe(bNew);
    expect(latest.get(a.id)).toEqual(repo.get(aNew));
  });
});

describe('SEARCHED_DATE_PAIR_SQL is core’s datePairSearched (revision 55 §6.6)', () => {
  it('agrees with datePairSearched for every mix of the six buckets (0 to 2 airport pairs each)', () => {
    const db = freshDb();
    const stmt = db.raw.prepare<Record<string, number>, { s: number | null }>(
      `SELECT (${SEARCHED_DATE_PAIR_SQL}) AS s FROM (SELECT @priced AS priced, @shown AS shown, @failed AS failed, @not_run AS not_run)`,
    );
    const n = [0, 1, 2];
    let mixes = 0;
    for (const priced of n)
      for (const empty of n)
        for (const no_data of n)
          for (const error of n)
            for (const skipped of n)
              for (const not_run of n) {
                const buckets: Buckets = { priced, empty, no_data, error, skipped, not_run, reused: 0 };
                const sql = stmt.get({ priced, shown: empty + no_data, failed: error, not_run })?.s === 1;
                expect(sql, JSON.stringify(buckets)).toBe(datePairSearched(buckets));
                mixes += 1;
              }
    expect(mixes).toBe(729);
  });
});

describe('CellsRepo.searchedDatePairs (revision 55 §10, the cards in one bounded read)', () => {
  const D14 = { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-24') };
  const D15 = { departureDate: asIsoDate('2027-03-15'), returnDate: asIsoDate('2027-03-25') };
  const D16 = { departureDate: asIsoDate('2027-03-16'), returnDate: asIsoDate('2027-03-26') };
  const SPACE = {
    origins: [asIata('LHR'), asIata('LGW')],
    destinations: [asIata('JFK'), asIata('EWR')],
    departureFrom: asIsoDate('2027-03-14'),
    departureTo: asIsoDate('2027-03-16'),
    minNights: 10,
    maxNights: 10,
  };
  type Pair = typeof D14;
  /** One parent run seeding `cells` (each `[origin, destination, pair, status]`), then completed. */
  function world() {
    const db = freshDb();
    const clock = fixedClock(T0);
    const defs = new DefinitionsRepo(db, clock);
    const repo = new ExecutionsRepo(db, clock);
    const cells = new CellsRepo(db, clock, { allowSynthetic: true });
    const def = defs.create(exampleDefinitionInput());
    const run = (
      seeded: ReadonlyArray<readonly [string, string, Pair, CellOutcomeStatus]>,
      o: { trigger?: 'manual' | 'tool'; child?: boolean } = {},
    ) => {
      const [first] = seeded;
      const e = repo.create({
        definitionId: def.id,
        isChild: o.child === true,
        cell:
          o.child === true && first !== undefined
            ? { origin: asIata(first[0]), destination: asIata(first[1]), ...first[2] }
            : null,
        snapshot: snapshotOf(def),
        estimate: null,
        trigger: o.trigger ?? 'manual',
        status: 'running',
      });
      cells.seed(
        e.id,
        seeded.map(([origin, destination, pair]) => ({
          origin: asIata(origin),
          destination: asIata(destination),
          ...pair,
          nights: 10,
        })),
        ['travelpayouts'],
      );
      // why: the read under test reads only the stored roll-up; each status is set on it directly
      const set = db.raw.prepare(
        'UPDATE search_cells SET discovery_status = ? WHERE execution_id = ? AND origin = ? AND destination = ? AND departure_date = ?',
      );
      for (const [origin, destination, pair, status] of seeded)
        set.run(status, e.id, origin, destination, pair.departureDate);
      repo.setStatus(e.id, 'completed', { finishedAt: clock.now() });
      clock.advance(1000);
      return e.id;
    };
    return { db, def, run, cells };
  }

  it('judges each run on its own over the space: two half-searched runs make no searched date pair; a priced cell does', () => {
    const { def, run, cells } = world();
    // 14 Mar: each of two runs saw only half the airport pairs (the other half never seeded), so neither searched it
    run([
      ['LHR', 'JFK', D14, 'empty'],
      ['LHR', 'EWR', D14, 'empty'],
      // 15 Mar: every airport pair answered (no fares, no data): searched, by an older run
      ['LHR', 'JFK', D15, 'empty'],
      ['LHR', 'EWR', D15, 'no_data'],
      ['LGW', 'JFK', D15, 'empty'],
      ['LGW', 'EWR', D15, 'empty'],
    ]);
    run([
      ['LGW', 'JFK', D14, 'empty'],
      ['LGW', 'EWR', D14, 'empty'],
    ]);
    // a tool run and a child that priced 16 Mar are no search runs
    run([['LHR', 'JFK', D16, 'priced']], { trigger: 'tool' });
    run([['LHR', 'JFK', D16, 'priced']], { child: true });
    // the latest run: one priced airport pair and three not run is searched; an error with the rest empty is not
    const latest = run([
      ['LHR', 'JFK', D16, 'priced'],
      ['LHR', 'EWR', D16, 'not_run'],
      ['LGW', 'JFK', D16, 'not_run'],
      ['LGW', 'EWR', D16, 'not_run'],
      ['LHR', 'JFK', D14, 'error'],
      ['LHR', 'EWR', D14, 'empty'],
      ['LGW', 'JFK', D14, 'empty'],
      ['LGW', 'EWR', D14, 'empty'],
    ]);
    const got = cells.searchedDatePairs([{ definitionId: def.id, latestRunId: latest, space: SPACE }]);
    expect(got.get(def.id)).toEqual({
      ever: new Set(['2027-03-15|2027-03-25', '2027-03-16|2027-03-26']),
      mine: new Set(['2027-03-16|2027-03-26']),
    });
  });

  it('reads only the space: another airport, departure day or stay length is no date pair of it', () => {
    const { def, run, cells } = world();
    const latest = run([
      ['LHR', 'JFK', D14, 'priced'],
      [
        'LHR',
        'JFK',
        { departureDate: asIsoDate('2027-03-17'), returnDate: asIsoDate('2027-03-27') },
        'priced',
      ],
      [
        'LHR',
        'JFK',
        { departureDate: asIsoDate('2027-03-14'), returnDate: asIsoDate('2027-03-25') },
        'priced',
      ],
    ]);
    const narrow = { ...SPACE, origins: [asIata('LGW')] };
    expect(
      cells.searchedDatePairs([{ definitionId: def.id, latestRunId: latest, space: narrow }]).get(def.id),
    ).toEqual({ ever: new Set(), mine: new Set() });
    expect(
      cells.searchedDatePairs([{ definitionId: def.id, latestRunId: latest, space: SPACE }]).get(def.id),
    ).toEqual({ ever: new Set(['2027-03-14|2027-03-24']), mine: new Set(['2027-03-14|2027-03-24']) });
  });

  it('returns one row per searched date pair however many runs searched it (bounded by the space, not the history)', () => {
    const { db, def, run, cells } = world();
    let latest = '';
    for (let i = 0; i < 5; i++) latest = run([['LHR', 'JFK', D14, 'priced']]);
    const rows: number[] = [];
    const prepare = db.raw.prepare.bind(db.raw);
    vi.spyOn(db.raw, 'prepare').mockImplementation((sql: string) => {
      const stmt = prepare(sql);
      const all = stmt.all.bind(stmt);
      vi.spyOn(stmt, 'all').mockImplementation((...args: unknown[]) => {
        const out = all(...args);
        rows.push(out.length);
        return out;
      });
      return stmt;
    });
    cells.searchedDatePairs([{ definitionId: def.id, latestRunId: latest, space: SPACE }]);
    vi.restoreAllMocks();
    expect(rows).toEqual([1]);
  });

  it('answers an empty set for a card none of whose runs searched anything, and nothing for no cards', () => {
    const { def, run, cells } = world();
    const latest = run([['LHR', 'JFK', D14, 'not_run']]);
    expect(
      cells.searchedDatePairs([{ definitionId: def.id, latestRunId: latest, space: SPACE }]).get(def.id),
    ).toEqual({ ever: new Set(), mine: new Set() });
    expect(cells.searchedDatePairs([]).size).toBe(0);
  });
});
