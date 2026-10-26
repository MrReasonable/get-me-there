import { asIsoDate, cellKeyString, fixedClock, rollUp } from '@gmt/core';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import type { CalendarPriceRow } from '../src/types.js';
import { at, count, freshDb, sqliteCode, T0 } from './helpers/db.js';
import {
  calendarPrice,
  cell,
  EWR,
  exampleDefinitionInput,
  JFK,
  LGW,
  LHR,
  newExecution,
  withNights,
} from './helpers/factories.js';
import { historySeed, statementsOf } from './helpers/history.js';

function setup(allowSynthetic = false, onlyLhrJfk = false) {
  const db = freshDb();
  const clock = fixedClock(T0);
  // why: a definition of just LHR → JFK leaves LGW and EWR as example-route airports outside the definition.
  const definition = onlyLhrJfk
    ? new DefinitionsRepo(db, clock).create(exampleDefinitionInput({ origins: [LHR], destinations: [JFK] }))
    : undefined;
  const { execution } = newExecution(db, clock, definition ? { definition } : {});
  return {
    db,
    clock,
    executionId: execution.id,
    repo: new CalendarPricesRepo(db, clock, { allowSynthetic }),
  };
}

/** Raw insert bypassing the repository, to prove the SQL constraints hold on their own. */
function rawInsert(db: Db, executionId: string, over: Record<string, unknown>): void {
  const row = {
    execution_id: executionId,
    provider_id: 'travelpayouts',
    source_kind: 'authorised-cached',
    cabin: 'economy',
    origin: 'LHR',
    destination: 'JFK',
    departure_date: '2027-03-14',
    return_date: '2027-03-28',
    price_pence: 41_200,
    price_native_minor: 41_200,
    currency_native: 'GBP',
    fx_rate_nano: null,
    fx_rate_date: null,
    fx_source: null,
    fx_converted: 0,
    point_of_sale: 'unknown',
    fetched_at: T0,
    return_date_source: 'vendor',
    ...over,
  };
  const cols = Object.keys(row);
  db.raw
    .prepare(
      `INSERT INTO calendar_prices (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
    )
    .run(row);
}

describe('calendar_prices writes (spec §5.5, §6.3, §7)', () => {
  // why: spec §7 rev 34: a grid price states its return-date source and Google's mark; only camoufox may say grid-cell
  it('a camoufox grid price reads back its return-date source and mark in its provenance; another provider is refused grid-cell', () => {
    const { repo, executionId } = setup();
    repo.insert(executionId, [
      calendarPrice(cell(), {
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        maxAgeHours: 24,
        returnDateSource: 'grid-cell',
        vendorPriceMark: 'low',
      }),
    ]);
    expect(repo.fetchedBy(executionId)[0]).toMatchObject({
      returnDateSource: 'grid-cell',
      vendorPriceMark: 'low',
      provenance: { returnDateSource: 'grid-cell', vendorPriceMark: 'low', maxAgeHours: 24 },
    });
    expect(() =>
      repo.insert(executionId, [
        calendarPrice(cell(undefined, undefined, '2027-03-15', '2027-03-29'), {
          returnDateSource: 'grid-cell',
        }),
      ]),
    ).toThrow(/grid cell/);
    expect(repo.fetchedBy(executionId)[0]?.provenance).toEqual(
      expect.not.objectContaining({ vendorPriceMark: null }),
    );
  });
  it('stores provenance explicitly and reads it back: max_age_hours NULL ⇔ unknown, FX columns when converted', () => {
    const { repo, executionId } = setup();
    const converted = calendarPrice(cell(undefined, undefined, '2027-03-15', '2027-03-29'), {
      providerId: 'searchapi',
      sourceKind: 'scraped-aggregate',
      maxAgeHours: null,
      pointOfSale: 'GB',
      currencyNative: 'USD',
      priceNativeMinor: 54_900,
      pricePence: 41_175,
      fx: {
        converted: true,
        rateNano: 750_000_000,
        rateDate: asIsoDate('2026-10-13'),
        source: 'frankfurter',
      },
      providerObservedAt: at('2026-10-14T11:00:00.000Z'),
    });
    const ids = repo.insert(executionId, [calendarPrice(cell()), converted]);
    expect(ids).toHaveLength(2);
    const [first, second] = repo.fetchedBy(executionId);
    expect(first).toMatchObject({
      id: ids[0],
      executionId,
      maxAgeHours: 48,
      provenance: {
        providerId: 'travelpayouts',
        sourceKind: 'authorised-cached',
        fetchedAt: T0,
        maxAgeHours: 48,
        fx: { converted: false },
        pointOfSale: 'unknown',
        cabin: 'economy',
      },
    });
    expect(first?.provenance).not.toHaveProperty('providerObservedAt');
    expect(second).toMatchObject({
      maxAgeHours: null,
      currencyNative: 'USD',
      provenance: {
        maxAgeHours: 'unknown',
        providerObservedAt: '2026-10-14T11:00:00.000Z',
        fx: { converted: true, rateNano: 750_000_000, rateDate: '2026-10-13', source: 'frankfurter' },
      },
    });
  });

  it('provider ⇔ kind, both directions, in the repository and in SQL; the gate refuses fixture rows unless allowed', () => {
    const { db, repo, executionId } = setup(true);
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ providerId: 'fixture', sourceKind: 'authorised-cached' })).toThrow(
      expect.objectContaining({ rule: 'provider-kind' }),
    );
    expect(write({ providerId: 'searchapi', sourceKind: 'synthetic' })).toThrow(
      expect.objectContaining({ rule: 'provider-kind' }),
    );
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, { provider_id: 'fixture', source_kind: 'authorised-cached' }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawInsert(db, executionId, { provider_id: 'searchapi', source_kind: 'synthetic' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(write({ providerId: 'fixture', sourceKind: 'synthetic' })).not.toThrow();
    const closed = new CalendarPricesRepo(db, fixedClock(T0), { allowSynthetic: false });
    expect(() =>
      closed.insert(executionId, [
        calendarPrice(cell(undefined, undefined, '2027-03-20', '2027-04-03'), {
          providerId: 'fixture',
          sourceKind: 'synthetic',
        }),
      ]),
    ).toThrow(expect.objectContaining({ rule: 'synthetic-gate' }));
  });

  it('FX CHECK constraints, both directions, and price_pence = price_native_minor when unconverted', () => {
    const { db, repo, executionId } = setup();
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, {
          fx_converted: 1,
          currency_native: 'GBP',
          fx_rate_nano: 1,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(() => rawInsert(db, executionId, { fx_converted: 0, currency_native: 'USD' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(
      sqliteCode(() =>
        rawInsert(db, executionId, {
          fx_converted: 1,
          currency_native: 'USD',
          fx_rate_nano: null,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ currencyNative: 'USD' })).toThrow(expect.objectContaining({ rule: 'fx' }));
    expect(write({ priceNativeMinor: 41_201 })).toThrow(/must equal price_native_minor/);
    expect(
      write({ fx: { converted: true, rateNano: 1, rateDate: asIsoDate('2026-10-13'), source: 'x' } }),
    ).toThrow(/GBP price cannot be FX-converted/);
  });

  it('price tables reject non-integers and non-toISOString timestamps (repository and SQL); a numeric text is stored as an integer by affinity', () => {
    const { db, repo, executionId } = setup();
    const write = (over: Parameters<typeof calendarPrice>[1]) => () =>
      repo.insert(executionId, [calendarPrice(cell(), over)]);
    expect(write({ pricePence: 412.5, priceNativeMinor: 412.5 })).toThrow(
      expect.objectContaining({ rule: 'integer' }),
    );
    // why: a non-ISO timestamp cannot reach the typed repository without a cast; the SQL CHECK below is its guard (arch-r2-006).
    expect(write({ maxAgeHours: 1.5 })).toThrow(/max_age_hours/);
    expect(write({ pointOfSale: 'gb' })).toThrow(/point_of_sale/);
    expect(write({ reusedFromExecutionId: 'someone-else' })).toThrow(
      expect.objectContaining({ rule: 'reused' }),
    );
    expect(
      sqliteCode(() => rawInsert(db, executionId, { price_pence: 412.5, price_native_minor: 412.5 })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawInsert(db, executionId, { price_pence: 'abc', price_native_minor: 'abc' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(() => rawInsert(db, executionId, { fetched_at: '2026-10-14T12:00:00Z' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(sqliteCode(() => rawInsert(db, executionId, { fetched_at: '2026-10-14 12:00:00.000' }))).toBe(
      'SQLITE_CONSTRAINT_CHECK',
    );
    expect(count(db, 'calendar_prices')).toBe(0);
    rawInsert(db, executionId, { price_pence: '412', price_native_minor: '412' }); // test-017: INTEGER affinity stores 412, which is an integer
    expect(
      db.raw.prepare('SELECT typeof(price_pence) AS t, price_pence AS p FROM calendar_prices').get(),
    ).toEqual({ t: 'integer', p: 412 });
  });

  it('UNIQUE (execution, provider, cell): a second row for the same key throws; another provider or execution does not', () => {
    const { db, clock, repo, executionId } = setup();
    repo.insert(executionId, [calendarPrice(cell())]);
    expect(
      sqliteCode(() =>
        repo.insert(executionId, [calendarPrice(cell(), { pricePence: 40_000, priceNativeMinor: 40_000 })]),
      ),
    ).toBe('SQLITE_CONSTRAINT_UNIQUE');
    repo.insert(executionId, [
      calendarPrice(cell(), { providerId: 'searchapi', sourceKind: 'scraped-aggregate', pointOfSale: 'GB' }),
    ]);
    repo.insert(newExecution(db, clock, { status: 'completed' }).execution.id, [calendarPrice(cell())]);
    expect(count(db, 'calendar_prices')).toBe(3);
  });
});

describe('plan Review Focus 5: a SqliteError inside a repository transaction', () => {
  it('propagates with its SQLite code and message, holds no URL, and rolls the whole transaction back', () => {
    const { db, clock, repo, executionId } = setup();
    const link = 'https://www.aviasales.com/search/LON1403NYC28031?marker=SECRET-TOKEN-0123456789';
    let thrown: unknown;
    try {
      db.transaction(() => {
        repo.insert(executionId, [calendarPrice(cell(), { vendorLink: link })]);
        repo.insert(executionId, [calendarPrice(cell(), { vendorLink: link })]); // same key
      });
    } catch (e) {
      thrown = e;
    }
    if (!(thrown instanceof Database.SqliteError)) throw new Error('expected a SqliteError');
    expect(thrown.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(thrown.message).toMatch(/^UNIQUE constraint failed: calendar_prices\./);
    expect(thrown.message).not.toMatch(/https?:|SECRET|marker=/);
    expect(count(db, 'calendar_prices')).toBe(0);
    // the engine records it on the execution (WP7); the column never holds a URL query or userinfo
    const executions = new ExecutionsRepo(db, clock);
    executions.setStatus(executionId, 'paused_error', {
      errorText: `${thrown.message} while writing tile 3 (${link.replace('https://', 'https://user:pw@')})`,
    });
    const text = executions.get(executionId)?.errorText ?? '';
    expect(text).toContain('UNIQUE constraint failed: calendar_prices.');
    expect(text).not.toMatch(/SECRET|marker=|pw@/);
  });
});

describe('CalendarPricesRepo.insert is a prices-only tile write (spec §3, §7 atomic unit; ruling 2026-10-15)', () => {
  const outcomesRepo = (db: Db, allowSynthetic = false) =>
    new CellsRepo(db, fixedClock(T0), { allowSynthetic });

  it('seeds the cell when absent and stores a priced outcome whose min_pence and provenance are the row’s; roll-up equals core', () => {
    const { db, repo, executionId } = setup();
    const c = cell();
    repo.insert(executionId, [calendarPrice(c, { pricePence: 39_900, priceNativeMinor: 39_900 })]);
    const cells = outcomesRepo(db);
    expect(cells.outcomes(executionId, { cells: [c] })).toEqual([
      expect.objectContaining({
        stage: 'discovery',
        providerId: 'travelpayouts',
        status: 'priced',
        reason: null,
        minPence: 39_900,
        fetchedAt: T0,
        cabin: 'economy',
        pointOfSale: 'unknown',
        sourceKind: 'authorised-cached',
        reusedFromExecutionId: null,
      }),
    ]);
    const stored = cells.rollUps(executionId).get(cellKeyString(c))?.discovery;
    expect(stored).toEqual({ status: 'priced', reason: null, minPence: 39_900 });
    expect(stored).toEqual(rollUp(cells.outcomes(executionId, { stage: 'discovery', cells: [c] })));
  });

  it('merges over a seeded outcome and keeps the other providers’ outcomes in the roll-up', () => {
    const { db, repo, executionId } = setup();
    const cells = outcomesRepo(db);
    const c = cell();
    cells.seed(executionId, [withNights(c)], ['travelpayouts', 'searchapi']);
    repo.insert(executionId, [calendarPrice(c)]);
    expect(cells.outcomes(executionId, { cells: [c] }).map((o) => [o.providerId, o.status])).toEqual([
      ['searchapi', 'not_run'],
      ['travelpayouts', 'priced'],
    ]);
    const stored = cells.rollUps(executionId).get(cellKeyString(c))?.discovery;
    expect(stored).toEqual(rollUp(cells.outcomes(executionId, { stage: 'discovery', cells: [c] })));
    expect(stored?.status).toBe('priced');
  });

  it.each([
    ['an origin outside the definition', cell(LGW)],
    ['a destination outside the definition', cell(undefined, EWR)],
    ['a departure before the resolved window', cell(undefined, undefined, '2026-10-20', '2026-11-03')],
    ['a departure after the resolved window', cell(undefined, undefined, '2027-04-21', '2027-05-05')],
    ['too few nights', cell(undefined, undefined, '2027-03-14', '2027-03-23')],
    ['too many nights', cell(undefined, undefined, '2027-03-14', '2027-04-05')],
  ])('refuses a row for %s and writes nothing', (_name, c) => {
    const { db, repo, executionId } = setup(false, true);
    expect(() => repo.insert(executionId, [calendarPrice(cell()), calendarPrice(c)])).toThrow(
      expect.objectContaining({ rule: 'cell-outside-definition' }),
    );
    expect([count(db, 'calendar_prices'), count(db, 'cell_outcomes'), count(db, 'search_cells')]).toEqual([
      0, 0, 0,
    ]);
  });

  it('a child execution accepts only its own cell', () => {
    const { db, clock } = setup();
    const own = cell();
    const child = newExecution(db, clock, { cell: own }).execution.id;
    const repo = new CalendarPricesRepo(db, clock, { allowSynthetic: false });
    expect(() => repo.insert(child, [calendarPrice(cell(undefined, EWR))])).toThrow(
      expect.objectContaining({ rule: 'cell-outside-definition' }),
    );
    repo.insert(child, [calendarPrice(own)]);
    expect(
      outcomesRepo(db)
        .outcomes(child)
        .map((o) => o.status),
    ).toEqual(['priced']);
  });

  it('refuses an unknown execution', () => {
    const { repo } = setup();
    expect(() => repo.insert('no-such-execution', [calendarPrice(cell())])).toThrow(
      expect.objectContaining({ rule: 'missing' }),
    );
  });
});

// WP19 Task 19.2: the grouped reads, each one statement, equal to the per-execution algorithms they replace (the api's
// old truncationOf, supersessionOf and heldBy loop, written out here as the reference).
describe('grouped calendar reads with their marks (WP19 Task 19.2, spec §10 bounds)', () => {
  /** The statement latestPerCell ran before WP19, kept verbatim as the reference for its rows. */
  const OLD_LATEST_PER_CELL_SQL = `
WITH ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.provider_id, p.origin, p.destination, p.departure_date, p.return_date ORDER BY p.fetched_at DESC, p.id DESC) AS rn
  FROM calendar_prices p JOIN search_executions e ON e.id = p.execution_id
  WHERE e.definition_id = @definitionId AND p.cabin = @cabin AND p.reused_from_execution_id IS NULL
)
SELECT id FROM ranked WHERE rn = 1`;

  function reference(seed: ReturnType<typeof historySeed>) {
    const all = seed.executions.listForDefinition(seed.definition.id, {
      limit: 'all',
      includeChildren: true,
    });
    const truncation = (r: CalendarPriceRow): string | null =>
      seed.cells
        .outcomes(r.reusedFromExecutionId ?? r.executionId, { stage: 'discovery' })
        .find((o) => o.providerId === r.providerId && cellKeyString(o) === cellKeyString(r.cell))
        ?.lastError ?? null;
    // the old supersessionOf: the newest parent's searched, non-reused outcome per (provider, cell), by position
    const position = new Map(all.map((e, i) => [e.id, i]));
    const lastSearch = new Map<string, { at: number; found: boolean }>();
    all.forEach((e, at) => {
      if (e.isChild) return;
      for (const o of seed.cells.outcomes(e.id, { stage: 'discovery' })) {
        const key = `${o.providerId}|${cellKeyString(o)}`;
        if (!['priced', 'empty', 'no_data'].includes(o.status) || o.reusedFromExecutionId !== null) continue;
        if (lastSearch.has(key)) continue;
        lastSearch.set(key, { at, found: o.status === 'priced' });
      }
    });
    const superseded = (r: CalendarPriceRow): boolean => {
      const fetchedBy = position.get(r.executionId);
      const last = lastSearch.get(`${r.providerId}|${cellKeyString(r.cell)}`);
      return fetchedBy !== undefined && last !== undefined && last.at < fetchedBy && !last.found;
    };
    const marked = (r: CalendarPriceRow) => ({
      ...r,
      sourceLastError: truncation(r),
      searchedEmptyLater: superseded(r),
    });
    return { marked };
  }

  const key = (r: CalendarPriceRow) => `${r.providerId}|${cellKeyString(r.cell)}`;
  const sorted = <T extends CalendarPriceRow>(rows: readonly T[]) =>
    [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  it('latestPerCell: the old rows, with the reference truncation and supersession over five parent runs, in one statement', () => {
    const seed = historySeed();
    const { marked } = reference(seed);
    const { result, statements } = statementsOf(seed.db, () =>
      seed.prices.latestPerCell(seed.definition.id, 'economy', null),
    );
    expect(statements).toBe(1);
    const oldIds = seed.db.raw
      .prepare<Record<string, unknown>, { id: number }>(OLD_LATEST_PER_CELL_SQL)
      .all({ definitionId: seed.definition.id, cabin: 'economy' })
      .map((r) => r.id)
      .sort((a, b) => a - b);
    expect(result.map((r) => r.id).sort((a, b) => a - b)).toEqual(oldIds);
    expect(sorted(result)).toEqual(sorted(result.map((r) => marked(r))));
    // why: the seed must exercise every arm, or the equality above proves nothing
    expect(result.some((r) => r.searchedEmptyLater)).toBe(true);
    expect(result.some((r) => !r.searchedEmptyLater)).toBe(true);
    expect(result.some((r) => r.sourceLastError?.startsWith('truncated') === true)).toBe(true);
  });

  it('latestPerCell: a newer run that skipped, errored on or reused the cell is not a search', () => {
    const seed = historySeed();
    const all = seed.executions.listForDefinition(seed.definition.id, {
      limit: 'all',
      includeChildren: true,
    });
    const rows = seed.prices.latestPerCell(seed.definition.id, 'economy', null);
    // every row marked superseded has a newer searched empty/no_data outcome; none is marked by a skip, error or copy
    for (const r of rows.filter((x) => x.searchedEmptyLater)) {
      const newer = all
        .slice(
          0,
          all.findIndex((e) => e.id === r.executionId),
        )
        .filter((e) => !e.isChild)
        .flatMap((e) => seed.cells.outcomes(e.id, { stage: 'discovery', cells: [r.cell] }))
        .filter((o) => o.providerId === r.providerId && o.reusedFromExecutionId === null);
      expect(newer.find((o) => ['priced', 'empty', 'no_data'].includes(o.status))?.status).toMatch(
        /^(empty|no_data)$/,
      );
    }
  });

  it('latestPerCell: restricted to the scope when given (airports, dates and nights in the SQL)', () => {
    const seed = historySeed();
    const all = seed.prices.latestPerCell(seed.definition.id, 'economy', null);
    const space = {
      origins: [LHR],
      destinations: [JFK],
      departureFrom: asIsoDate('2027-03-15'),
      departureTo: asIsoDate('2027-03-15'),
      minNights: 14,
      maxNights: 14,
    };
    const scoped = seed.prices.latestPerCell(seed.definition.id, 'economy', space);
    expect(scoped.length).toBeGreaterThan(0);
    expect(sorted(scoped)).toEqual(
      sorted(
        all.filter(
          (r) => r.cell.origin === LHR && r.cell.destination === JFK && r.cell.departureDate === '2027-03-15',
        ),
      ),
    );
    expect(
      seed.prices.latestPerCell(seed.definition.id, 'economy', { ...space, minNights: 15, maxNights: 15 }),
    ).toEqual([]);
  });

  it('latestHeldBy: for one and for several executions, the latest held row per (provider, cell), reused copies included, each with its marks', () => {
    const seed = historySeed();
    const { marked } = reference(seed);
    const heldLoop = (ids: readonly string[]) => {
      const best = new Map<string, CalendarPriceRow>();
      for (const r of ids.flatMap((id) => seed.prices.heldBy(id)).filter((x) => x.cabin === 'economy')) {
        const cur = best.get(key(r));
        if (
          cur === undefined ||
          r.fetchedAt > cur.fetchedAt ||
          (r.fetchedAt === cur.fetchedAt && r.id > cur.id)
        )
          best.set(key(r), r);
      }
      return [...best.values()];
    };
    for (const ids of [
      [seed.runs[0] ?? ''],
      [seed.runs[3] ?? ''],
      seed.runs,
      [seed.runs[1] ?? '', seed.runs[4] ?? ''],
    ]) {
      const { result, statements } = statementsOf(seed.db, () =>
        seed.prices.latestHeldBy(ids, 'economy', null),
      );
      expect(statements).toBe(1);
      expect(sorted(result)).toEqual(sorted(heldLoop(ids).map(marked)));
    }
    // why: a reused copy's truncation is its source run's (decision 58), so the seed must hold one
    const held = seed.prices.latestHeldBy(seed.runs, 'economy', null);
    expect(seed.runs.some((id) => seed.prices.heldBy(id).some((r) => r.reusedFromExecutionId !== null))).toBe(
      true,
    );
    expect(held.length).toBeGreaterThan(0);
    expect(seed.prices.latestHeldBy(seed.runs, 'business', null)).toEqual([]);
  });
});
