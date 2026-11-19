// Settings plan ruling 6 and controller ruling R3: once a saved setting waits for the app to restart in place
// (`engine.holdForReload()`), nothing new starts: a start, resume, single-cell verification or flight read asked after
// it is refused with the words, and a tick or the minute catch-up leaves its firing to the catch-up after the restart;
// the run in flight carries on to its end. The app's second observer (`EngineOptions.runWatch`) is told when each run
// and each on-demand flight read starts and settles, after its row is written. Event-driven: no timers are waited on.
import { asIsoDate, asIsoDateTime, type CellKey } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { createEngine } from '../src/engine.js';
import { createOrchestrator } from '../src/orchestrator.js';
import type { RunWatch } from '../src/registry.js';
import { catchUpAll } from '../src/scheduler/catchUp.js';
import { RELOAD_PENDING_TEXT } from '../src/text.js';
import { deferred, engineWith, rankedPairs, stubCamoufox } from './support/camoufox.js';
import { createHarness, JFK, LHR, refusedWith } from './support/harness.js';

const PAIR = { departureDate: asIsoDate('2026-11-02'), returnDate: asIsoDate('2026-11-12') };
const CELL: CellKey = { origin: LHR, destination: JFK, ...PAIR };

/**
 * A weekly search (Mondays 06:00 in London) whose firing of Monday 1 March 2027 was missed: at 05:30 on Sunday 7 March
 * the next firing is less than half the gap away, so a catch-up skips it (decision 79) rather than starting a run.
 */
function missedFiring() {
  const h = createHarness({ now: asIsoDateTime('2027-02-28T00:00:00.000Z') });
  const def = h.createDefinition({
    scheduleCron: '0 6 * * 1',
    window: { kind: 'relative', startOffsetDays: 7, lengthDays: 14 },
  });
  h.clock.set(asIsoDateTime('2027-03-07T05:30:00.000Z'));
  return { h, def };
}

/**
 * A RunWatch that records what it was told and what `read` said at that moment; `settled` resolves on the first end,
 * so a test waits on the event, never on a poll.
 */
function recordingWatch(read: () => string = () => '') {
  const events: string[] = [];
  const settled = deferred();
  const watch: RunWatch = {
    started: () => events.push('started'),
    ended: () => {
      events.push(`ended:${read()}`);
      settled.resolve();
    },
  };
  return { watch, events, settled: settled.promise };
}

describe('the engine held for a restart in place (settings plan ruling 6, controller ruling R3)', () => {
  it('refuses a start, a resume and a verification with the words, and the run in flight carries on', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    const other = h.createDefinition({ name: 'second' });
    const { watch, settled } = recordingWatch();
    const engine = h.track(createEngine(h.deps, { ...h.options, runWatch: watch }));
    const running = await engine.start(def.id, { trigger: 'manual' });
    if (!running.ok) throw new Error(running.message);
    engine.holdForReload();
    expect(refusedWith(await engine.start(other.id, { trigger: 'manual' }), 'reload-pending')).toBe(
      RELOAD_PENDING_TEXT,
    );
    expect(refusedWith(await engine.resume(running.executionId, { manual: true }), 'reload-pending')).toBe(
      RELOAD_PENDING_TEXT,
    );
    expect(refusedWith(await engine.verifyCell(def.id, CELL), 'reload-pending')).toBe(RELOAD_PENDING_TEXT);
    expect(RELOAD_PENDING_TEXT).toBe('Applying new settings: try again in a minute');
    // why: the hold refuses new work only; the run that was going ends as it would have
    await settled;
    expect(h.repos.executions.get(running.executionId)?.status).toBe('completed');
    expect(h.repos.executions.listForDefinition(other.id, { limit: 10, includeChildren: true })).toEqual([]);
  });

  it('a late tick and the minute catch-up while held write nothing, where unheld (or after the restart) they skip the missed firing', async () => {
    for (const hold of [false, true]) {
      const { h, def } = missedFiring();
      const engine = h.track(createEngine(h.deps, h.options));
      if (hold) engine.holdForReload();
      await engine.scheduler.tick(def.id);
      const rows = () => h.repos.executions.listForDefinition(def.id, { limit: 10, includeChildren: true });
      expect(rows().map((r) => r.status)).toEqual(hold ? [] : ['skipped_missed']);
      if (!hold) continue;
      // why: the restart's next pass builds a new engine, unheld; its catch-up takes the firing the held one left
      const next = h.track(createEngine(h.deps, h.options));
      await next.scheduler.tick(def.id);
      expect(rows().map((r) => r.status)).toEqual(['skipped_missed']);
    }
    for (const hold of [false, true]) {
      const { h, def } = missedFiring();
      const ctx = buildContext(h.deps, h.options);
      const orch = h.track(createOrchestrator(ctx));
      ctx.lifecycle.reloadPending = hold;
      await catchUpAll(ctx, orch);
      const rows = h.repos.executions.listForDefinition(def.id, { limit: 10, includeChildren: true });
      expect(rows.map((r) => r.status)).toEqual(hold ? [] : ['skipped_missed']);
    }
  });

  it('refuses a flight read with its own code before anything else is checked', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(5) });
    const engine = createEngine({ ...e.deps, providers: [cam] }, { rankedDatePairs: rankedPairs(5) });
    engine.holdForReload();
    expect(await engine.readFlightList(e.definition.id, PAIR)).toEqual({ ok: false, code: 'reload-pending' });
    expect(await engine.readFlightList('no-such-search', PAIR)).toEqual({
      ok: false,
      code: 'reload-pending',
    });
    await engine.shutdown();
  });
});

describe('the second observer of runs (EngineOptions.runWatch)', () => {
  it('is told when a run starts and, after its status is written, when it settles', async () => {
    const h = createHarness();
    const def = h.createDefinition();
    let id = '';
    const { watch, events, settled } = recordingWatch(() => h.repos.executions.get(id)?.status ?? 'none');
    const engine = h.track(createEngine(h.deps, { ...h.options, runWatch: watch }));
    const r = await engine.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    id = r.executionId;
    expect(events).toEqual(['started']);
    await settled;
    expect(events).toEqual(['started', 'ended:completed']);
  });

  it('is told when an on-demand flight read starts and settles, and the read is no longer in flight then', async () => {
    const cam = stubCamoufox({ cells: 15, flights: {} });
    const e = engineWith([cam], { rankedDatePairs: rankedPairs(5) });
    const ended = deferred();
    const told: string[] = [];
    const engine = createEngine(
      { ...e.deps, providers: [cam] },
      {
        rankedDatePairs: rankedPairs(5),
        runWatch: {
          started: () => told.push('started'),
          ended: () => {
            told.push(`ended:${engine.flightReadInFlight() === null ? 'idle' : 'reading'}`);
            ended.resolve();
          },
        },
      },
    );
    const r = await engine.readFlightList(e.definition.id, PAIR);
    if (!r.ok) throw new Error(`refused: ${r.code}`);
    expect(told).toEqual(['started']);
    await r.done;
    await ended.promise;
    expect(told).toEqual(['started', 'ended:idle']);
    await engine.shutdown();
  });
});
