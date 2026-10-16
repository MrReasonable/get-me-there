import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createHarness, FIXTURE_RULES, JFK, LGW, LHR, tileRule } from './support/harness.js';

describe('Review Focus 5: SQLite busy or full during a tile write', () => {
  it('→ paused_error with the SQLite message, URL-free, in error_text; the sibling in flight → not_run; operator notified; no crash loop', async () => {
    const h = createHarness({ fixtureConcurrency: 2 });
    await h.fixtureScenario([tileRule('LHR', '2026-11-09', FIXTURE_RULES.hold, 1)]);
    h.beforeTileWrite((attempt) => {
      if (attempt === 1)
        throw new Database.SqliteError(
          'database or disk is full (see https://user:pw@sqlite.example/full?db=/data/x.db)',
          'SQLITE_FULL',
        );
    });
    const orch = h.orch();
    const r = await orch.start(h.createDefinition({ origins: [LHR, LGW], destinations: [JFK] }).id, {
      trigger: 'manual',
    });
    if (!r.ok) throw new Error(r.message);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('paused_error');
    expect(e.resumeAfter).toBeNull();
    expect(e.errorText).toBe('database or disk is full (see https://sqlite.example/full)');
    const all = h.outcomes(e.id);
    expect(all).toHaveLength(56);
    // why: this pins the engine's handling (classify fatal, pause, abort the held sibling, URL-free error_text); the error
    // is thrown before writeTile runs, so nothing was written by construction; rollback inside the transaction is WP3's
    // own test (test-strategy-reviewer-031)
    expect(all.every((o) => o.status === 'not_run')).toBe(true);
    expect(h.logs.some((l) => l.msg === 'unexpected failure; pausing')).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['paused_error']);
    expect(h.notifications[0]?.body).toContain('database or disk is full');
    expect(h.notifications[0]?.body).not.toContain('pw@');
    expect(e.autoResumeCount).toBe(0); // a graceful pause, not a crash: boot will not count it as a restart
  });
});
