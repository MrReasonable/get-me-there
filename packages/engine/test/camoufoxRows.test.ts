import { asIsoDateTime } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  authError,
  blockedError,
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
      /bot check \(CAPTCHA\); cooling down until/,
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
    e.ctx.repos.notifications.record('provider_disabled', null, e.definition.id, 'failed');
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
  it('the snapshot page cap stops camoufox at 2 pages though config says 100, and travelpayouts continues', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 }), stubTravelpayouts({ cells: 6 })], {
      camoufoxConfigCap: 100,
      snapshotCap: 2,
    });
    const ex = await e.runToEnd();
    expect(e.ledgerRows('camoufox').filter((r) => r.pageClass === 'page')).toHaveLength(2);
    expect(
      outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'skipped' && o.reason === 'budget'),
    ).toHaveLength(4);
    expect(outcomes(e, ex.id, 'travelpayouts').filter((o) => o.status === 'priced')).toHaveLength(6);
  });
  it('the page cap is frozen into the snapshot from config at start', async () => {
    const e = engineWith([stubCamoufox({ cells: 1 })], { camoufoxConfigCap: 7 });
    const ex = await e.runToEnd();
    expect(ex.snapshot.budget.providerMaxCalls).toEqual({ camoufox: 7 });
  });
  it('alone, the page cap pauses paused_budget and the tick does not resume it', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 })], {
      camoufoxConfigCap: 100,
      snapshotCap: 2,
      scheduleCron: '0 5 * * 1',
    });
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_budget');
    expect(ex.resumeAfter).toBeNull();
    expect(await e.tick()).toEqual({ resumed: false });
  });
  it('the engine fills airportNames from the airports repository', async () => {
    const s = stubCamoufox({ cells: 1 });
    await engineWith([s]).runToEnd();
    expect(s.queries[0]?.airportNames).toEqual({
      origin: ['London Heathrow Airport'],
      destination: ['John F Kennedy International Airport'],
    });
  });
});
