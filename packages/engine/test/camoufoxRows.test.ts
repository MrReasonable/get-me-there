import { asIata, asIsoDate, asIsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authError,
  blockedError,
  deferred,
  engineWith,
  outcomes,
  stubCamoufox,
  stubTravelpayouts,
  unavailableError,
} from './support/camoufox.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('spec §8.1 rev 32: camoufox rows', () => {
  it('blocked on the first tile: exactly one error/blocked cell, every other camoufox cell skipped:provider_disabled, travelpayouts untouched', async () => {
    const e = engineWith([
      stubCamoufox({ cells: 12, failTile: 0, error: blockedError('captcha') }),
      stubTravelpayouts({ cells: 12 }),
    ]);
    const ex = await e.runToEnd();
    const cf = outcomes(e, ex.id, 'camoufox');
    expect(cf.filter((o) => o.status === 'error' && o.reason === 'blocked')).toHaveLength(1);
    expect(cf.filter((o) => o.status === 'skipped' && o.reason === 'provider_disabled')).toHaveLength(11);
    expect(cf.find((o) => o.status === 'error')?.lastError).toMatch(
      /challenge page \(CAPTCHA\); cooling down until/,
    );
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(12);
    expect(ex.status).toBe('completed');
  });
  it('a block notifies once per cool-down, keyed by its end, never once per run', async () => {
    const e = engineWith([
      stubCamoufox({ cells: 3, failTile: 0, error: blockedError('captcha') }),
      stubTravelpayouts({ cells: 3 }),
    ]);
    await e.runToEnd();
    // why: fix round 1 (CodeRabbit): decision 56's once-a-day rule would hide the repeat on its own; clearing its record
    // makes the second run stand for a later day, so only the cool-down key can suppress the notice
    e.ctx.db.raw.prepare('DELETE FROM operator_notifications').run();
    await e.runToEnd();
    expect(
      e.notifications.filter((n) => n.kind === 'provider_disabled' && n.body.includes('cooling down until')),
    ).toHaveLength(1);
    expect(e.ctx.repos.notifications.noticeKeyClaimed('camoufox-cooldown:2026-10-16T09:00:00.000Z')).toBe(
      true,
    );
  });
  it('preflight cooling down: every camoufox cell skipped with the end in last_error, no ledger row, one notice across two runs', async () => {
    const e = engineWith([
      stubCamoufox({
        cells: 5,
        preflight: {
          ok: false,
          skip: 'provider_disabled',
          detail: 'cooling down until 2026-10-20T05:00:00.000Z (captcha)',
          until: asIsoDateTime('2026-10-20T05:00:00.000Z'),
        },
      }),
      stubTravelpayouts({ cells: 5 }),
    ]);
    const a = await e.runToEnd();
    e.ctx.db.raw.prepare('DELETE FROM operator_notifications').run();
    const b = await e.runToEnd();
    expect(outcomes(e, a.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual(
      Array(5).fill(['skipped', 'provider_disabled']),
    );
    expect(
      outcomes(e, a.id, 'camoufox').every(
        (o) => o.lastError === 'cooling down until 2026-10-20T05:00:00.000Z (captcha)',
      ),
    ).toBe(true);
    expect(outcomes(e, b.id, 'camoufox').map((o) => o.status)).toEqual(Array(5).fill('skipped'));
    expect(e.ledgerRows('camoufox')).toHaveLength(0);
    expect(
      e.notifications.filter(
        (n) => n.kind === 'provider_disabled' && n.body.includes('cooling down until 2026-10-20'),
      ),
    ).toHaveLength(1);
  });
  it('worker unreachable at preflight: skipped:provider_unavailable, no row, other providers run', async () => {
    const e = engineWith([
      stubCamoufox({
        cells: 5,
        preflight: { ok: false, skip: 'provider_unavailable', detail: 'browser worker not reachable' },
      }),
      stubTravelpayouts({ cells: 5 }),
    ]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual(
      Array(5).fill(['skipped', 'provider_unavailable']),
    );
    expect(e.ledgerRows('camoufox')).toHaveLength(0);
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(5);
  });
  it('a healthy preflight lets the pages run', async () => {
    const e = engineWith([stubCamoufox({ cells: 2, preflight: { ok: true } })]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => o.status)).toEqual(['priced', 'priced']);
  });
  it('a refused connection mid-run: one error cell, the rest skipped:provider_unavailable, one ledger row', async () => {
    const e = engineWith([stubCamoufox({ cells: 6, failTile: 0, error: unavailableError() })]);
    const ex = await e.runToEnd();
    const cf = outcomes(e, ex.id, 'camoufox');
    expect(cf.filter((o) => o.status === 'error')).toHaveLength(1);
    expect(cf.filter((o) => o.status === 'skipped' && o.reason === 'provider_unavailable')).toHaveLength(5);
    expect(e.ledgerRows('camoufox')).toEqual([{ pageClass: 'no-page', outcome: 'error' }]);
    expect(ex.status).toBe('paused_error');
  });
  it('a manual resume keeps camoufox disabled after a block and calls it no more', async () => {
    const s = stubCamoufox({ cells: 4, failTile: 0, error: blockedError('captcha') });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const calls = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBe(calls);
  });
  it('a manual resume still re-admits a provider disabled for auth', async () => {
    const s = stubCamoufox({ cells: 4, failTile: 0, error: authError() });
    const e = engineWith([s]);
    const ex = await e.runToEnd();
    const calls = s.calls.length;
    await e.resume(ex.id, { manual: true });
    expect(s.calls.length).toBeGreaterThan(calls);
  });
  // why: CAMOUFOX_PAGES_AT_ONCE: the engine runs that many camoufox tiles at once, each cell read once
  it('two pages at once: a second tile starts while the first is in flight, and each cell is read exactly once', async () => {
    const second = deferred();
    let inFlight = 0;
    let most = 0;
    const s = stubCamoufox({
      cells: 6,
      holdCall: { call: 1, until: second.promise },
      onTile: (n) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        if (n === 2) second.resolve();
      },
    });
    const fetch = s.discovery?.fetchTile;
    if (fetch === undefined || s.discovery === undefined) throw new Error('discovery');
    s.discovery.fetchTile = async (plan, q, pctx) => {
      try {
        return await fetch(plan, q, pctx);
      } finally {
        inFlight -= 1;
      }
    };
    const e = engineWith([s], { env: { CAMOUFOX_PAGES_AT_ONCE: '2' } });
    expect(e.ctx.limitsOf('camoufox').concurrency).toBe(2);
    const ex = await e.runToEnd();
    expect(most).toBe(2);
    expect(ex.status).toBe('completed');
    expect(e.ledgerRows('camoufox').filter((r) => r.pageClass === 'page')).toHaveLength(6);
    expect(new Set(s.calls.map((t) => t.coveredCells.map((c) => c.departureDate).join())).size).toBe(6);
    expect(outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'priced')).toHaveLength(6);
  });
  // why: spec rev 65: the browser's pages count against no per-run call cap: the operator's search (maxFreeCalls 150)
  // must start its 156 grid pages (two airport pairs, 182 days of 10–21 nights) and read every one
  it('a grid plan of 156 pages starts under a search whose maxFreeCalls is 150, and every page loads', async () => {
    const cam = stubCamoufox({ cells: 1, grid: {} });
    const e = engineWith([cam], { maxFreeCalls: 150 });
    e.ctx.repos.definitions.update(e.definition.id, {
      window: { kind: 'absolute', from: asIsoDate('2026-11-09'), to: asIsoDate('2027-05-09') },
      minNights: 10,
      maxNights: 21,
      origins: [asIata('LHR'), asIata('LGW')],
      destinations: [asIata('JFK')],
    });
    const ex = await e.runToEnd();
    expect(ex.snapshot.budget.maxFreeCalls).toBe(150);
    expect(e.ledgerRows('camoufox').filter((r) => r.pageClass === 'page')).toHaveLength(156);
    expect(ex.status).toBe('completed');
    expect(outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'priced')).toHaveLength(156);
    // why: 156 pages through the whole engine took just over the default 5 s on the Windows runner twice (PRs 51, 54)
  }, 15_000);
  it('the engine fills airportNames from the airports repository', async () => {
    const s = stubCamoufox({ cells: 1 });
    await engineWith([s]).runToEnd();
    expect(s.queries[0]?.airportNames).toEqual({
      origin: ['London Heathrow Airport'],
      destination: ['John F Kennedy International Airport'],
      otherOrigins: [],
      otherDestinations: [],
    });
  });
});
