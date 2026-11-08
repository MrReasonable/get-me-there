// Spec revision 55 §10 `GET /definitions/cards`: the first screen's cards, their order, the latest run's counts by core's
// one "searched" predicate, the cheapest through the board's ranking, the stop's words from the stored cause (Review
// Focus 4: a row stopped before migration 0011 reads NO_STOP_CAUSE_TEXT, never its error_text).
import {
  apiContract,
  asIsoDate,
  NO_STOP_CAUSE_TEXT,
  type SearchCard,
  type SearchDefinition,
  type StopCause,
  stopText,
} from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder, snapshotOf } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  vi.restoreAllMocks();
});

/** One departure day and one stay: the space has exactly one date pair, (2 Nov, 12 Nov), over its airport pairs. */
const ONE_PAIR = {
  window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-02') },
  minNights: 10,
  maxNights: 10,
} as const;
const FOUR = { origins: [LHR, LGW], destinations: [JFK, EWR], ...ONE_PAIR };
const cellsOf = (def: SearchDefinition) =>
  def.origins.flatMap((o) => def.destinations.map((d) => cell(o, d, '2026-11-02', '2026-11-12')));

async function cards(x: Harness): Promise<SearchCard[]> {
  const res = await x.request('/api/definitions/cards');
  expect(res.status).toBe(200);
  return apiContract.searchCardsResponseSchema.parse(await res.json()).cards;
}
const cardOf = (all: SearchCard[], id: string): SearchCard => {
  const c = all.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no card for ${id}`);
  return c;
};

describe('GET /definitions/cards (revision 55 §10)', () => {
  it('orders running or pending first (oldest start first), then by the latest start newest first, then never-run in creation order; deleted searches are absent', async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const make = (name: string) =>
      x.ports.repos.definitions.create(exampleDefinitionInput({ name, ...ONE_PAIR }));
    const never1 = make('never 1');
    const old = make('older run');
    const recent = make('recent run');
    const runA = make('running since -5');
    const runB = make('running since -1');
    const gone = make('removed');
    const never2 = make('never 2');
    s.execution('old', { def: old, status: 'completed', startedAt: at(-10), finishedAt: at(-9) });
    s.execution('recent', { def: recent, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.execution('runA', { def: runA, status: 'running', startedAt: at(-5) });
    s.execution('runB', { def: runB, status: 'running', startedAt: at(-1) });
    x.ports.repos.definitions.softDelete(gone.id);
    // why: each running search's own remaining seconds (two concurrent runs, two estimates)
    const estimate = x.engine.estimate(runA, x.clock.todayLondon());
    for (const n of ['runA', 'runB']) x.ports.repos.executions.patch(s.id(n), { estimate });
    vi.spyOn(x.engine, 'estimateRemaining').mockImplementation((id) => ({
      ...estimate,
      seconds: id === s.id('runA') ? 600 : 60,
    }));
    const all = await cards(x);
    expect(all.map((c) => c.name)).toEqual([
      'running since -5',
      'running since -1',
      'recent run',
      'older run',
      'never 1',
      'never 2',
    ]);
    expect(cardOf(all, runA.id).latestRun?.estimatedFinishAt).toBe('2026-10-14T09:10:00.000Z');
    expect(cardOf(all, runB.id).latestRun?.estimatedFinishAt).toBe('2026-10-14T09:01:00.000Z');
    expect(cardOf(all, recent.id).latestRun?.estimatedFinishAt).toBeNull();
    expect(cardOf(all, never1.id).latestRun).toBeNull();
    expect(all.some((c) => c.id === gone.id)).toBe(false);
    expect(cardOf(all, never2.id).latestRun).toBeNull();
  });

  it('counts a date pair searched with datePairSearched over its airport pairs: one priced and three not run counts, one empty and three not run does not', async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const priced = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'priced', ...FOUR }));
    const empty = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'empty', ...FOUR }));
    for (const [name, def, status] of [
      ['P', priced, 'priced'],
      ['E', empty, 'empty'],
    ] as const) {
      s.execution(name, { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
      const [first] = cellsOf(def);
      if (first === undefined) throw new Error('no cells');
      s.cells(name, cellsOf(def));
      s.tile(name, first, { status, fetchedAt: at(-2) });
    }
    const all = await cards(x);
    expect(cardOf(all, priced.id).latestRun).toMatchObject({
      datePairs: 1,
      datePairsSearched: 1,
      datePairsNeverSearched: 0,
    });
    expect(cardOf(all, empty.id).latestRun).toMatchObject({
      datePairs: 1,
      datePairsSearched: 0,
      datePairsNeverSearched: 1,
    });
  });

  // Design 2026-11-08 §7, §5.5: the card's flights carry the stored confirm summary unchanged, null for an older plan
  it("a card's latest run carries the stored confirm summary on flights, and null for a plan stored before it", async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const now = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'now', ...FOUR }));
    const old = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'old', ...FOUR }));
    const summary = { mode: 'confirm', confirmed: 3, unread: 1, uncheckedCheaper: 120, stop: null } as const;
    for (const [name, def, confirm] of [
      ['N', now, summary],
      ['O', old, null],
    ] as const) {
      s.execution(name, { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
      x.ports.repos.executions.patch(s.id(name), {
        flightLists: {
          planned: 4,
          cells: [],
          reused: 4,
          ended: null,
          returns: true,
          booking: true,
          returnsStopped: null,
          bookingStopped: null,
          confirm,
          endedReason: null,
        },
      });
    }
    const all = await cards(x);
    expect(cardOf(all, now.id).latestRun?.flights?.confirm).toEqual(summary);
    expect(cardOf(all, old.id).latestRun?.flights?.confirm).toBeNull();
  });

  // why: decision 36 — the board's figure from a truncated tile is a partial minimum; the card says so as the board does
  it("a cheapest read from a truncated tile carries the board figure's truncated mark", async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ ...FOUR }));
    const [a] = cellsOf(def);
    if (a === undefined) throw new Error('no cells');
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', cellsOf(def));
    s.tile('E1', a, {
      status: 'priced',
      pricePence: 40_000,
      fetchedAt: at(-1),
      lastError: 'cheapest of the rows read',
    });
    expect(cardOf(await cards(x), def.id).cheapest).toMatchObject({
      pricePence: 40_000,
      basis: 'calendar',
      truncated: true,
    });
  });

  it("cheapest is the board's first-ranked figure with its provenance and per-price staleness; fromLatestRun is false when an earlier run fetched it", async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ ...FOUR }));
    const [a, b] = cellsOf(def);
    if (a === undefined || b === undefined) throw new Error('no cells');
    s.execution('E1', { def, status: 'completed', startedAt: at(-6), finishedAt: at(-5) });
    s.cells('E1', cellsOf(def));
    s.tile('E1', a, { status: 'priced', pricePence: 40_000, fetchedAt: at(-5) });
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [b]);
    s.tile('E2', b, { status: 'priced', pricePence: 48_000, fetchedAt: at(-1) });
    const c = cardOf(await cards(x), def.id);
    expect(c.cheapest).toMatchObject({
      pricePence: 40_000,
      basis: 'calendar',
      departureDate: '2026-11-02',
      returnDate: '2026-11-12',
      origin: a.origin,
      destination: a.destination,
      stale: false,
      truncated: false,
      fromLatestRun: false,
      provenance: { providerId: 'fixture', fetchedAt: at(-5) },
    });
    expect(c.cheapest?.ageHours).toBeGreaterThan(5);
    // spaceChangedSince: a PUT that widens the stay after the latest run started
    expect(c.spaceChangedSince).toBe(false);
    const put = await x.request(`/api/definitions/${def.id}`, { method: 'PUT', json: { maxNights: 11 } });
    expect(put.status).toBe(200);
    expect(cardOf(await cards(x), def.id).spaceChangedSince).toBe(true);
  });

  it("a stopped run's stop is its stored cause's words; a row stopped before 0011 reads NO_STOP_CAUSE_TEXT and never its error_text; a completed row has none (Review Focus 4)", async () => {
    h = await createHarness();
    const x = h;
    const s = seeder(x.ports);
    const make = (name: string) =>
      x.ports.repos.definitions.create(exampleDefinitionInput({ name, ...ONE_PAIR }));
    const paused = make('paused');
    const legacy = make('legacy');
    const blank = make('blank');
    const done = make('done');
    const skipped = make('skipped');
    const cause: StopCause = {
      kind: 'budget',
      scope: 'execution-cost',
      providerId: null,
      unit: 'pence',
      cap: 500,
      resumeAfter: null,
      resetsAt: null,
      flights: null,
    };
    s.execution('P', { def: paused, status: 'running', startedAt: at(-2) });
    x.ports.repos.executions.setStatus(s.id('P'), 'paused_budget', { stopCause: cause, errorText: 'x' });
    s.execution('L', { def: legacy, status: 'paused_error', startedAt: at(-2) });
    // why: a row written before migration 0011: no cause, the old free text in error_text
    x.ports.repos.executions.patch(s.id('L'), { errorText: 'paused: error' });
    // why: and one with neither a cause nor any stored text
    s.execution('B', { def: blank, status: 'interrupted', startedAt: at(-2) });
    s.execution('D', { def: done, status: 'running', startedAt: at(-3) });
    x.ports.repos.executions.setStatus(s.id('D'), 'paused_error', {
      stopCause: { kind: 'fatal' },
      errorText: 'y',
    });
    x.ports.repos.executions.setStatus(s.id('D'), 'completed', { finishedAt: at(-1) });
    const skippedCause: StopCause = { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: 100 };
    x.ports.repos.executions.create({
      definitionId: skipped.id,
      isChild: false,
      cell: null,
      snapshot: snapshotOf(skipped, at(-1)),
      estimate: null,
      trigger: 'schedule',
      status: 'skipped_confirm',
      stopCause: skippedCause,
      errorText: 'z',
    });
    const res = await x.request('/api/definitions/cards');
    const text = await res.clone().text();
    expect(text).not.toContain('paused: error');
    const all = apiContract.searchCardsResponseSchema.parse(await res.json()).cards;
    const facts = { tz: 'Europe/London', mode: 'native' as const, scheduled: false };
    expect(cardOf(all, paused.id).latestRun?.stop).toEqual(stopText(cause, facts));
    expect(cardOf(all, legacy.id).latestRun?.stop).toEqual(NO_STOP_CAUSE_TEXT);
    expect(cardOf(all, blank.id).latestRun?.stop).toEqual(NO_STOP_CAUSE_TEXT);
    expect(cardOf(all, done.id).latestRun?.stop).toBeNull();
    expect(cardOf(all, skipped.id).latestRun?.stop?.sentence).toBe(
      stopText(skippedCause, { ...facts, scheduled: false }).sentence,
    );
  });
});

describe('the cards are read through grouped statements (revision 55 §10, R2)', () => {
  /** `defs` searches with `runs` finished parent runs each, then the statements one GET prepares, by their SQL. */
  async function statements(defs: number, runs: number): Promise<string[]> {
    const x = await createHarness();
    const s = seeder(x.ports);
    for (let d = 0; d < defs; d++) {
      const def = x.ports.repos.definitions.create(exampleDefinitionInput({ name: `s${d}`, ...FOUR }));
      for (let r = 0; r < runs; r++) {
        const name = `d${d}r${r}`;
        s.execution(name, { def, status: 'completed', startedAt: at(-10 + r), finishedAt: at(-9 + r) });
        s.cells(name, cellsOf(def));
      }
    }
    const seen: string[] = [];
    const prepare = x.ports.db.raw.prepare.bind(x.ports.db.raw);
    vi.spyOn(x.ports.db.raw, 'prepare').mockImplementation((sql: string) => {
      seen.push(sql);
      return prepare(sql);
    });
    expect((await x.request('/api/definitions/cards')).status).toBe(200);
    vi.restoreAllMocks();
    await x.close();
    return seen;
  }
  const rollUpReads = (sql: string[]) => sql.filter((q) => /FROM search_cells/.test(q));

  it('as runs grow, the statement count stays the same; the roll-ups and the latest parents are one statement each', async () => {
    const one = await statements(2, 1);
    const four = await statements(2, 4);
    expect(four.length).toBe(one.length);
    expect(rollUpReads(four)).toHaveLength(1);
    expect(four.filter((q) => q.includes('ROW_NUMBER() OVER (PARTITION BY definition_id'))).toHaveLength(1);
  });

  it('as searches grow, the roll-up and latest-parent reads stay one statement each, and nothing is read per run', async () => {
    const [a, b, c] = [await statements(1, 3), await statements(2, 3), await statements(3, 3)];
    for (const sql of [a, b, c]) expect(rollUpReads(sql)).toHaveLength(1);
    // why: what remains per search is the board's own fixed read of its cheapest (rankedFigures), never one per run
    expect(c.length - b.length).toBe(b.length - a.length);
  });
});
