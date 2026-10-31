// Task 20.4 fix round 1: the worked example's full run (8,736 stub tiles, about 15 s) read back through a real engine.
// Kept apart from askedPairs.engine.test.ts so the mutation run's command leaves out the one slow test.
import { asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine.js';
import { engineWith, stubTravelpayouts } from './support/camoufox.js';
import { EWR, JFK, LGW, LHR } from './support/harness.js';

beforeEach(() => {
  expect.hasAssertions();
});

const TODAY = asIsoDate('2026-10-14');
const DAY_MS = 24 * 3_600_000;

describe('estimateAsk after a full run of the worked example', () => {
  it('a saved search after a full run, a day later: 0 covered, 2,184 reused; the unsaved body asks in full', async () => {
    // why: the run's free-call cap (default 1,000) is lifted so the 8,736 tiles all run
    const e = engineWith([stubTravelpayouts({ cells: 1 })], { maxFreeCalls: 20_000 });
    const def = e.ctx.repos.definitions.update(e.definition.id, {
      origins: [LHR, LGW],
      destinations: [JFK, EWR],
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
      minNights: 10,
      maxNights: 21,
    });
    await e.runToEnd();
    e.clock.advance(DAY_MS);
    const engine = createEngine(e.deps);
    const est = engine.estimate(def, TODAY);
    expect(engine.estimateAsk(def, TODAY, est)).toMatchObject({
      datePairs: 2184,
      datePairsCovered: 0,
      datePairsPartly: 0,
      datePairsReused: 2184,
    });
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      deletedAt: _d,
      confirmedCostPence: _p,
      confirmedCalls: _k,
      ...input
    } = def;
    const unsaved = engine.estimateAsk(input, TODAY, engine.estimate(input, TODAY));
    expect(unsaved).toMatchObject({ datePairsCovered: 2184, datePairsReused: 0 });
  }, 120_000);
});
