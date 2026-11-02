// Spec revision 55 §8.1 (Ian's ruling 1 of 2026-10-31): Search again on a stopped search starts fresh. A manual start
// with `replaceStopped` cancels a `paused_*` or `interrupted` latest parent (cause superseded 'search-again') and inserts
// the new run in one immediate transaction, the one a paused catch-up's replacement uses.
import { describe, expect, it, vi } from 'vitest';
import { createHarness, FIXTURE_RULES, type Harness, refusedWith, tileRule } from './support/harness.js';

const FIRST = '2026-11-02';

/** A manual run of a new search left in `status`: paused_error after an auth error, or interrupted by a SIGTERM. */
async function stopped(h: Harness, status: 'paused_error' | 'interrupted') {
  const def = h.createDefinition();
  if (status === 'paused_error') {
    await h.fixtureScenario([tileRule('LHR', FIRST, FIXTURE_RULES.auth, 1)]);
    const e = await h.runToCompletion(h.orch(), def.id);
    expect(e.status).toBe('paused_error');
    await h.fixtureScenario([]);
    return { def, old: e };
  }
  const first = h.orch();
  h.onTileCommit((n) => {
    if (n === 1) void first.shutdown();
  });
  const r = await first.start(def.id, { trigger: 'manual' });
  if (!r.ok) throw new Error(r.message);
  const e = await h.waitForSettled(r.executionId);
  h.clearHooks();
  expect(e.status).toBe('interrupted');
  return { def, old: e };
}

describe('replaceStopped (revision 55 §8.1, Ian ruling 1)', () => {
  it.each(['paused_error', 'interrupted'] as const)(
    'over a %s latest parent: cancels it with superseded search-again and starts the new run',
    async (status) => {
      const h = createHarness({ fixtureConcurrency: 1 });
      const { def, old } = await stopped(h, status);
      const r = await h.orch().start(def.id, { trigger: 'manual', replaceStopped: true });
      if (!r.ok) throw new Error(r.message);
      expect(h.repos.executions.get(old.id)).toMatchObject({
        status: 'cancelled',
        stopCause: { kind: 'superseded', by: 'search-again' },
        errorText: 'Replaced by a search you started.',
      });
      expect(h.repos.executions.get(r.executionId)?.status).toBe('running');
      expect((await h.waitForSettled(r.executionId)).status).toBe('completed');
    },
  );

  it('a failed insert rolls the cancel back: the stopped run stays as it was', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, old } = await stopped(h, 'paused_error');
    vi.spyOn(h.repos.executions, 'create').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(h.orch().start(def.id, { trigger: 'manual', replaceStopped: true })).rejects.toThrow(
      'disk full',
    );
    expect(h.repos.executions.get(old.id)).toMatchObject({
      status: 'paused_error',
      stopCause: old.stopCause,
    });
  });

  it('a running parent still refuses active with the flag; without it a stopped parent refuses active', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const { def, old } = await stopped(h, 'paused_error');
    refusedWith(await h.orch().start(def.id, { trigger: 'manual' }), 'active');
    expect(h.repos.executions.get(old.id)?.status).toBe('paused_error');
    const live = createHarness({ fixtureConcurrency: 1 });
    await live.fixtureScenario([{ match: { path: '/calendar' }, respond: FIXTURE_RULES.hold }]);
    const running = live.createDefinition();
    const o = live.orch();
    expect((await o.start(running.id, { trigger: 'manual' })).ok).toBe(true);
    refusedWith(await o.start(running.id, { trigger: 'manual', replaceStopped: true }), 'active');
  });
});
