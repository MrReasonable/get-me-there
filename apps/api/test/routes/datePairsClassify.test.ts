// Spec §6.6 (revision 50): one per-cell classification behind every coverage summary the api sends. Over seeded states
// where the definition and its latest run disagree, the date-pairs body parses, every date pair's six buckets sum to
// its airport pairs in scope, the summary is the columns' sum over `scope.cells`, `/results` scoped to a date pair
// reports that date pair's counts, and the coverage route's and `/results`' summaries equal the date-pairs summary.
import {
  apiContract,
  asIata,
  type CellKey,
  type DecodedDatePairs,
  type DefinitionInput,
  generateCells,
  type SearchDefinition,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { currentSpace } from '../../src/read/space.js';
import { expectContract } from '../helpers/contract.js';
import { datesOf, resultsOf } from '../helpers/dates.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, type Seeder, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const HOUR = 3_600_000;
/** A small relative space: 5 departure days from a week out, 10–11 nights, LHR → JFK. */
const SMALL: Partial<DefinitionInput> = {
  window: { kind: 'relative', startOffsetDays: 7, lengthDays: 5 },
  minNights: 10,
  maxNights: 11,
};

/** The cells of the definition's current space. */
const cellsOf = (x: Harness, def: SearchDefinition): CellKey[] =>
  generateCells(currentSpace(def, x.clock.todayLondon()));

/**
 * A parent run over `cells`: every third cell priced, the next empty, the next an error; the first two selected, one
 * itinerary-searched, the other left not_run; plus one completed on-demand child.
 */
function run(
  s: Seeder,
  def: SearchDefinition,
  cells: CellKey[],
  o: { status?: 'completed' | 'running'; discovery?: boolean } = {},
): void {
  const [c0, c1] = cells;
  if (c0 === undefined || c1 === undefined) throw new Error('too few cells');
  s.execution('E', { def, status: o.status ?? 'completed', startedAt: at(-3), finishedAt: at(-2) });
  s.cells('E', cells, {
    discovery: o.discovery === false ? [] : ['fixture'],
    selected: [c0, c1].map((c) => ({ cell: c, reason: 'top_n' as const })),
  });
  if (o.discovery !== false)
    cells.forEach((c, i) => {
      if (o.status === 'running' && i > cells.length / 2) return; // the rest not reached yet
      if (i % 3 === 0)
        s.tile('E', c, { status: 'priced', pricePence: 40_000 + i, fetchedAt: at(-2), tileIndex: i });
      else if (i % 3 === 1) s.tile('E', c, { status: 'empty', fetchedAt: at(-2), tileIndex: i });
      else s.tileError('E', [c], 'upstream', 'HTTP 503');
    });
  s.verified('E', c0, [{ hash: 'hE', pricePence: 60_000, fetchedAt: at(-2) }]);
  const child = cells[cells.length - 1];
  if (child === undefined) return;
  s.execution('K', { def, status: 'completed', startedAt: at(-1), finishedAt: at(-1), child });
  s.cells('K', [child], { selected: [{ cell: child, reason: 'always_include' }] });
  s.verified('K', child, [{ hash: 'hK', pricePence: 61_000, fetchedAt: at(-1) }]);
}

/** Every agreement revision 50 requires, for the definition as it now stands. */
async function holds(x: Harness, defId: string): Promise<DecodedDatePairs> {
  const d = await datesOf(x, defId); // parses datePairsResponseSchema, which refuses a short bucket sum
  const sum = (f: (p: DecodedDatePairs['pairs'][number]) => number) => d.pairs.reduce((n, p) => n + f(p), 0);
  for (const p of d.pairs) {
    const b = p.buckets;
    expect(b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run).toBe(d.scope.airportPairs);
  }
  expect(d.summary.total).toBe(d.scope.cells);
  expect(d.summary.buckets).toEqual({
    priced: sum((p) => p.buckets.priced),
    empty: sum((p) => p.buckets.empty),
    no_data: sum((p) => p.buckets.no_data),
    error: sum((p) => p.buckets.error),
    skipped: sum((p) => p.buckets.skipped),
    not_run: sum((p) => p.buckets.not_run),
    reused: sum((p) => p.buckets.reused),
  });
  expect([d.summary.selected, d.summary.itinerarySearched, d.summary.onDemand]).toEqual([
    sum((p) => p.selected),
    sum((p) => p.itinerarySearched),
    sum((p) => p.onDemand),
  ]);
  for (const p of d.pairs) {
    const r = await resultsOf(x, defId, `?departureDate=${p.departureDate}&returnDate=${p.returnDate}`);
    expect(r.coverage.buckets, `${p.departureDate} ${p.nights}`).toEqual(p.buckets);
    expect([r.coverage.selected, r.coverage.itinerarySearched, r.coverage.onDemand]).toEqual([
      p.selected,
      p.itinerarySearched,
      p.onDemand,
    ]);
  }
  const whole = await resultsOf(x, defId);
  expect(whole.coverage).toEqual(d.summary);
  if (d.executionId !== null) {
    const coverage = await expectContract(
      await x.request(`/api/definitions/${defId}/coverage`),
      'GET',
      '/api/definitions/:id/coverage',
      apiContract.coverageResponseSchema,
    );
    expect(coverage.summary).toEqual(d.summary);
    // why: ?executionId= describes the run shown alone, so its on-demand children are not counted
    const byRun = await resultsOf(x, defId, `?executionId=${d.executionId}`);
    expect(byRun.coverage).toEqual({ ...d.summary, onDemand: 0 });
  }
  return d;
}

async function harness() {
  const x = await createHarness();
  h = x;
  return { x, s: seeder(x.ports) };
}

describe('one per-cell classification behind every summary (spec §6.6, revision 50)', () => {
  it('(a) a relative window rolled forward one day: the new day is not searched, a departed day is in neither', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    const before = cellsOf(x, def);
    run(s, def, before);
    x.clock.advance(24 * HOUR);
    const d = await holds(x, def.id);
    const first = before[0]?.departureDate;
    expect(d.pairs.some((p) => p.departureDate === first)).toBe(false);
    const last = d.pairs[d.pairs.length - 1];
    expect(last?.buckets.not_run).toBe(1);
    expect(d.summary.buckets.not_run).toBeGreaterThanOrEqual(2);
  });

  it('(b) the nights range widened after the run: the new stays are not searched', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    run(s, def, cellsOf(x, def));
    x.ports.repos.definitions.update(def.id, { maxNights: 13 });
    const d = await holds(x, def.id);
    expect(d.pairs.filter((p) => p.nights > 11).every((p) => p.buckets.not_run === 1)).toBe(true);
  });

  it('(c) an airport added after the run, (d) one removed', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    run(s, def, cellsOf(x, def));
    x.ports.repos.definitions.update(def.id, { destinations: [asIata('JFK'), asIata('EWR')] });
    const added = await holds(x, def.id);
    expect(added.scope.airportPairs).toBe(2);
    expect(added.pairs.every((p) => p.buckets.not_run >= 1)).toBe(true);
    x.ports.repos.definitions.update(def.id, { destinations: [asIata('EWR')] });
    const removed = await holds(x, def.id);
    expect(removed.summary.buckets.not_run).toBe(removed.scope.cells);
  });

  it('(e) a discovery provider added, (f) removed', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    run(s, def, cellsOf(x, def));
    const before = await holds(x, def.id);
    x.ports.repos.definitions.update(def.id, {
      providers: { ...def.providers, discovery: ['fixture', 'travelpayouts'] },
    });
    expect((await holds(x, def.id)).summary).toEqual(before.summary);
    x.ports.repos.definitions.update(def.id, { providers: { ...def.providers, discovery: [] } });
    const gone = await holds(x, def.id);
    expect(gone.discoveryProviders).toEqual([]);
    expect(gone.summary).toEqual(before.summary);
  });

  it('(g) a parent run in progress', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    run(s, def, cellsOf(x, def), { status: 'running' });
    expect((await holds(x, def.id)).summary.buckets.not_run).toBeGreaterThan(0);
  });

  it('(h) a roll-up with verification outcomes only (a search with no discovery source) counts as not searched', async () => {
    const { x, s } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    run(s, def, cellsOf(x, def), { discovery: false });
    const d = await holds(x, def.id);
    expect(d.summary.buckets.not_run).toBe(d.scope.cells);
    expect(d.summary.itinerarySearched).toBe(1);
  });

  it('before any parent run every cell is not searched and executionId is null', async () => {
    const { x } = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(SMALL));
    const d = await holds(x, def.id);
    expect(d.executionId).toBeNull();
    expect(d.summary.buckets.not_run).toBe(d.scope.cells);
  });
});
