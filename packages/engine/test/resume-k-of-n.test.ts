import { cellKeyString } from '@gmt/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createHarness,
  discoveryOf,
  expectedTiles,
  JFK,
  LGW,
  LHR,
  noVerification,
} from './support/harness.js';

describe('resume after k of n tiles issues n−k (spec §9 item 4; WP7 first failing test)', () => {
  it('re-plans over the resumable cells only and the ledger shows exactly n first-attempt tile requests across both passes', async () => {
    // why: one tile in flight at a time (EngineOptions.providerConcurrency), so the interrupt lands exactly between tile k and k+1
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: noVerification() });
    const n = expectedTiles(h, def);
    expect(n).toBe(4);
    const k = 2;

    const first = h.orch();
    h.onTileCommit((count) => {
      if (count === k) void first.shutdown(); // SIGTERM semantics: abort, cells in flight → not_run, status interrupted
    });
    const started = await first.start(def.id, { trigger: 'manual' });
    if (!started.ok) throw new Error(started.message);
    const id = started.executionId;
    expect((await h.waitForSettled(id)).status).toBe('interrupted');
    expect(h.tileRequests(id)).toBe(k);
    const resumable = h.outcomes(id, { stage: 'discovery', status: 'not_run' }).map(cellKeyString).sort();
    expect(resumable.length).toBeGreaterThan(0);

    h.clearHooks();
    const plan = vi.spyOn(discoveryOf(h.fixture), 'plan');
    const second = h.orch(); // a fresh process: no in-memory state survives
    expect(await second.resume(id, { manual: false })).toEqual({ ok: true, executionId: id });
    expect((await h.waitForSettled(id)).status).toBe('completed');

    // why: tile indexes number the tiles of one pass (spec §8.1 parity is per uninterrupted pass), so across two passes
    // the oracle is the first-attempt upstream rows: k in pass one + (n − k) in pass two
    const firstAttempts = h
      .ledgerRows(id)
      .filter((r) => r.tileIndex !== null && r.httpAttempt === 1 && r.outcome !== 'cache_hit');
    expect(firstAttempts).toHaveLength(n);
    // why: the resume's cap check plans the same cells once more (estimateRemaining), so compare distinct cells
    const planned = [...new Set(plan.mock.calls.flatMap(([q]) => (q.cells ?? []).map(cellKeyString)))].sort();
    expect(planned).toEqual(resumable); // plan() saw exactly the resumable cells, nothing already committed
    expect(h.outcomes(id, { stage: 'discovery', status: 'not_run' })).toHaveLength(0);
  });
});
