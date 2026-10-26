// Spec §10 bounds and §9 (WP19 Task 19.2): the date-pairs route and `/results` read through a fixed number of grouped
// statements whatever the history's depth, the children, the itineraries or the cells; the route answers a 50,000-cell
// scope 20 runs deep within 3 s (× GMT_TIMING_FACTOR on CI, revision 50), at most 4 MiB, and 512 KiB gzip-compressed.
// The statement counts and byte sizes are exact gates; only the time is multiplied, and no test is retried.
import { gzipSync } from 'node:zlib';
import {
  type CellKey,
  type DefinitionInput,
  generateCells,
  isoDateTimeOfEpochMs,
  type SearchDefinition,
} from '@gmt/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { currentSpace } from '../../src/read/space.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR } from '../helpers/examples.js';
import { createHarness, type Harness, T0 } from '../helpers/harness.js';
import { at, type Seeder, seeder } from '../helpers/seed.js';

/** Revision 50: the time limits are multiplied by GMT_TIMING_FACTOR (CI sets 3); counts and sizes never are. */
const timingFactor = (() => {
  const f = Number(process.env.GMT_TIMING_FACTOR ?? 1);
  if (!(Number.isFinite(f) && f > 0))
    throw new Error(`GMT_TIMING_FACTOR must be a positive number, got ${f}`);
  return f;
})();
const MiB = 1024 * 1024;
const KiB = 1024;

/** The cells of a definition's current space, in generation order. */
const cellsOf = (x: Harness, def: SearchDefinition): CellKey[] =>
  generateCells(currentSpace(def, x.clock.todayLondon()));

/**
 * One parent run over `cells`, every cell priced by a calendar price, written with raw statements in one transaction
 * (the repositories' per-tile writes would take minutes at this size). Each run's prices differ, and the fetch time
 * steps one second every 49 cells, so the response holds about one distinct provenance per 49 cells.
 */
function bulkRun(
  x: Harness,
  s: Seeder,
  name: string,
  def: SearchDefinition,
  cells: readonly CellKey[],
  run: number,
) {
  const exec = s.execution(name, {
    def,
    status: 'completed',
    startedAt: at(-200 + run * 5),
    finishedAt: at(-199 + run * 5),
  });
  const raw = x.ports.db.raw;
  const cell = raw.prepare(
    `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date, discovery_status, discovery_min_pence)
     VALUES (?, ?, ?, ?, ?, 'priced', ?)`,
  );
  const outcome = raw.prepare(
    `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, attempts,
       fetched_at, min_pence, cabin, point_of_sale, source_kind)
     VALUES (?, ?, ?, ?, ?, 'discovery', 'fixture', 'priced', 1, ?, ?, 'economy', 'GB', 'synthetic')`,
  );
  const price = raw.prepare(
    `INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date,
       price_pence, price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours, return_date_source)
     VALUES (?, 'fixture', 'synthetic', 'economy', ?, ?, ?, ?, ?, ?, 'GBP', 0, 'GB', ?, 24, 'vendor')`,
  );
  const base = Date.parse(T0) + (-199 + run * 5) * 3_600_000;
  raw.transaction(() => {
    cells.forEach((c, i) => {
      const pence = 30_000 + ((i * 7_919 + run * 104_729) % 40_000);
      const fetched = isoDateTimeOfEpochMs(base + Math.floor(i / 49) * 1_000);
      const key = [exec, c.origin, c.destination, c.departureDate, c.returnDate] as const;
      cell.run(...key, pence);
      outcome.run(...key, fetched, pence);
      price.run(exec, c.origin, c.destination, c.departureDate, c.returnDate, pence, pence, fetched);
    });
  })();
  return exec;
}

/** `n` verified cells of the latest run, each with its own itinerary (through the repositories' atomic unit). */
function verifiedCells(x: Harness, s: Seeder, name: string, cells: readonly CellKey[]): void {
  x.ports.repos.cells.seedVerification(
    s.id(name),
    cells.map((c) => ({ cell: c, reason: 'top_n' as const })),
    [...cells],
    ['fixture'],
  );
  cells.forEach((c, i) => {
    const hash = `h${i.toString(16).padStart(6, '0')}`;
    s.verified(name, c, [{ hash, pricePence: 25_000 + i, fetchedAt: at(-1) }]);
  });
}

/** The statements each read prepares: the date pairs, `/results` whole, one date pair, and the oldest run's. */
async function statementCounts(x: Harness, def: SearchDefinition, oldest: string | null) {
  const count = async (path: string) => {
    const spy = vi.spyOn(x.ports.db.raw, 'prepare');
    try {
      const res = await x.request(path);
      expect(res.status, path).toBe(200);
      await res.arrayBuffer();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  };
  const first = cellsOf(x, def)[0];
  if (first === undefined) throw new Error('no cells');
  const base = `/api/definitions/${def.id}`;
  const counts = {
    datePairs: await count(`${base}/date-pairs`),
    results: await count(`${base}/results`),
    datePair: await count(
      `${base}/results?departureDate=${first.departureDate}&returnDate=${first.returnDate}`,
    ),
    byRun: oldest === null ? null : await count(`${base}/results?executionId=${oldest}`),
  };
  // why: the counts are the brief's record (Task 19.2's report), printed once per world
  process.stderr.write(`statements ${JSON.stringify(counts)}\n`);
  return counts;
}

/** A small definition: LHR → JFK, `days` departures from a week out, 10–19 nights (`days` × 10 cells). */
const small = (days: number): DefinitionInput =>
  exampleDefinitionInput({
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: days },
    minNights: 10,
    maxNights: 19,
  });

async function smallWorld(o: { days?: number; runs?: number; verified?: number; children?: number }) {
  const x = await createHarness();
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(small(o.days ?? 50));
  const cells = cellsOf(x, def);
  const runs: string[] = [];
  for (let r = 0; r < (o.runs ?? 1); r++) runs.push(bulkRun(x, s, `E${r}`, def, cells, r));
  verifiedCells(x, s, `E${(o.runs ?? 1) - 1}`, cells.slice(0, o.verified ?? 0));
  for (let k = 0; k < (o.children ?? 0); k++) {
    const c = cells[k];
    if (c === undefined) break;
    s.execution(`K${k}`, { def, status: 'completed', startedAt: at(-1), finishedAt: at(-1), child: c });
    s.cells(`K${k}`, [c], { selected: [{ cell: c, reason: 'always_include' }] });
    s.verified(`K${k}`, c, [{ hash: `k${k}`, pricePence: 61_000, fetchedAt: at(-1) }]);
  }
  return { x, def, oldest: runs[0] ?? null };
}

describe('statements are constant on every axis that grows (spec §10 bounds)', () => {
  it('(a) 10 against 500 verified cells with distinct itineraries', async () => {
    const few = await smallWorld({ verified: 10 });
    const many = await smallWorld({ verified: 500 });
    expect(await statementCounts(many.x, many.def, many.oldest)).toEqual(
      await statementCounts(few.x, few.def, few.oldest),
    );
  });

  it('(b) 1 against 20 parent executions over the same cells, the oldest run read by ?executionId=', async () => {
    const one = await smallWorld({ runs: 1, verified: 5 });
    const twenty = await smallWorld({ runs: 20, verified: 5 });
    expect(await statementCounts(twenty.x, twenty.def, twenty.oldest)).toEqual(
      await statementCounts(one.x, one.def, one.oldest),
    );
  });

  it('(c) 0 against 20 completed children', async () => {
    const none = await smallWorld({ children: 0, verified: 5 });
    const twenty = await smallWorld({ children: 20, verified: 5 });
    expect(await statementCounts(twenty.x, twenty.def, twenty.oldest)).toEqual(
      await statementCounts(none.x, none.def, none.oldest),
    );
  });
});

describe('the 50,000-cell bound: time, size and the scope in the SQL (spec §9, §10)', () => {
  // why: 400 days × 31 nights × 4 airport pairs = 49,600 cells, the largest space of the worked example's four airport
  // pairs within 50,000 (five would need an airport outside the example); 20 parent runs deep, every cell priced.
  let big: { x: Harness; def: SearchDefinition; oldest: string };
  let wide: { x: Harness; def: SearchDefinition };
  let raised: { x: Harness; def: SearchDefinition };

  beforeAll(async () => {
    {
      const x = await createHarness({ persistent: true });
      const s = seeder(x.ports);
      const def = x.ports.repos.definitions.create(
        exampleDefinitionInput({
          origins: [LHR, LGW],
          destinations: [JFK, EWR],
          window: { kind: 'relative', startOffsetDays: 7, lengthDays: 400 },
          minNights: 10,
          maxNights: 40,
        }),
      );
      const cells = cellsOf(x, def);
      const runs: string[] = [];
      for (let r = 0; r < 20; r++) runs.push(bulkRun(x, s, `E${r}`, def, cells, r));
      // a few hundred verified observations, spread over the space
      verifiedCells(
        x,
        s,
        'E19',
        cells.filter((_, i) => i % 166 === 0),
      );
      big = { x, def, oldest: runs[0] ?? '' };
    }
    {
      const x = await createHarness({ persistent: true });
      const s = seeder(x.ports);
      const def = x.ports.repos.definitions.create(
        exampleDefinitionInput({
          window: { kind: 'relative', startOffsetDays: 7, lengthDays: 400 },
          minNights: 0,
          maxNights: 90,
        }),
      );
      bulkRun(x, s, 'E0', def, cellsOf(x, def), 0);
      wide = { x, def };
    }
    {
      const x = await createHarness({ persistent: true, env: { MAX_CELLS_PER_DEFINITION: '200000' } });
      const s = seeder(x.ports);
      const def = x.ports.repos.definitions.create(
        exampleDefinitionInput({
          origins: [LHR, LGW],
          destinations: [JFK, EWR],
          window: { kind: 'relative', startOffsetDays: 7, lengthDays: 400 },
          minNights: 10,
          maxNights: 71,
        }),
      );
      bulkRun(x, s, 'E0', def, cellsOf(x, def), 0);
      raised = { x, def };
    }
  }, 120_000);

  afterAll(async () => {
    for (const w of [big, wide, raised]) await w?.x.close();
  });

  /** One timed read: the uncompressed body and the gzip body, each measured. */
  async function measure(x: Harness, path: string) {
    const started = performance.now();
    const res = await x.request(path);
    const text = await res.text();
    const ms = performance.now() - started;
    expect(res.status, text.slice(0, 300)).toBe(200);
    const zipped = await x.request(path, { headers: { 'accept-encoding': 'gzip' } });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const gz = (await zipped.arrayBuffer()).byteLength;
    const sizes = { ms: Math.round(ms), bytes: Buffer.byteLength(text), gzip: gz };
    // why: the measured figures are the brief's record (Task 19.2's report), printed once per case
    process.stderr.write(`date-pairs bound ${path.split('?')[1] ?? ''}: ${JSON.stringify(sizes)}\n`);
    return { ...sizes, body: JSON.parse(text) };
  }

  it('49,600 cells, 20 runs deep: within 3 s, at most 4 MiB and 512 KiB gzip', {
    timeout: 60_000,
  }, async () => {
    const m = await measure(big.x, `/api/definitions/${big.def.id}/date-pairs`);
    expect(m.body.scope.cells).toBe(49_600);
    expect(m.ms).toBeLessThan(3_000 * timingFactor);
    expect(m.bytes).toBeLessThanOrEqual(4 * MiB);
    expect(m.gzip).toBeLessThanOrEqual(512 * KiB);
    expect(gzipSync(Buffer.from(JSON.stringify(m.body))).byteLength).toBeGreaterThan(0);
  });

  it('36,400 date pairs (400 × 91, one airport pair, every one with a figure) within the same bounds', {
    timeout: 60_000,
  }, async () => {
    const m = await measure(wide.x, `/api/definitions/${wide.def.id}/date-pairs`);
    expect([m.body.scope.cells, m.body.figures.pair.length]).toEqual([36_400, 36_400]);
    expect(m.ms).toBeLessThan(3_000 * timingFactor);
    expect(m.bytes).toBeLessThanOrEqual(4 * MiB);
    expect(m.gzip).toBeLessThanOrEqual(512 * KiB);
  });

  it("a 99,200-cell definition (the operator's raised setting) read with origins=LHR answers its 49,600 cells within the bounds", {
    timeout: 60_000,
  }, async () => {
    const unscoped = await raised.x.request(`/api/definitions/${raised.def.id}/date-pairs`);
    expect(unscoped.status).toBe(422);
    const m = await measure(raised.x, `/api/definitions/${raised.def.id}/date-pairs?origins=LHR`);
    expect([m.body.scope.cells, m.body.scope.origins]).toEqual([49_600, ['LHR']]);
    expect(m.ms).toBeLessThan(3_000 * timingFactor);
    expect(m.bytes).toBeLessThanOrEqual(4 * MiB);
    expect(m.gzip).toBeLessThanOrEqual(512 * KiB);
  });

  it('(d) 1,000 against 49,600 cells: the same statements for every read', { timeout: 60_000 }, async () => {
    const thousand = await smallWorld({ days: 100, verified: 5 });
    expect(await statementCounts(big.x, big.def, big.oldest)).toEqual(
      await statementCounts(thousand.x, thousand.def, thousand.oldest),
    );
    await thousand.x.close();
  });
});
