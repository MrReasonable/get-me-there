// WP14 fix round 1: the camoufox engine paths the branch reviews found untested (arch I1, I2, M3, M4; prov I3).
import { asIsoDateTime, cooldownNoticeKey, ProviderError } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { engineWith, outcomes, realCamoufox, stubCamoufox, stubTravelpayouts } from './support/camoufox.js';
import { T0 } from './support/harness.js';

const A = asIsoDateTime('2026-10-20T05:00:00.000Z');
const B = asIsoDateTime('2026-10-23T05:00:00.000Z');
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
const cells = (cell: unknown, pointOfSale = 'GB') => ({
  status: 200,
  body: { kind: 'cells', fetchedAt: T0, currency: 'GBP', pointOfSale, notes: [], versions, cell },
});
const priced = (o: Record<string, number | null> = {}) =>
  cells({
    status: 'price',
    amountMinor: 45_100,
    tabMinor: 45_100,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    returnDateFrom: 'query-and-form',
    ...o,
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe('the cool-down notice key (arch I1, M3, M4)', () => {
  it('is read from the error’s cooldownUntil, whatever the message says', async () => {
    const error = new ProviderError({
      kind: 'blocked',
      retryable: false,
      providerId: 'camoufox',
      httpStatus: 423,
      message: 'camoufox /v1/page: paused for a while [blocked:captcha]',
      cooldownUntil: A,
    });
    const e = engineWith([stubCamoufox({ cells: 2, failTile: 0, error })]);
    await e.runToEnd();
    expect(e.ctx.repos.notifications.noticeKeyClaimed(cooldownNoticeKey('camoufox', A))).toBe(true);
    expect(e.notifications.filter((n) => n.kind === 'provider_disabled')).toHaveLength(1);
  });
  it('the preflight keys each cool-down by its own end: two ends, two notices', async () => {
    const pf = (until: typeof A) => ({
      ok: false as const,
      skip: 'provider_disabled' as const,
      detail: `cooling down until ${until} (captcha)`,
      until,
    });
    const e = engineWith([
      stubCamoufox({ cells: 2, preflights: [pf(A), pf(A), pf(B)] }),
      stubTravelpayouts({ cells: 2 }),
    ]);
    // why: decision 56 sends a kind at most once a London day; clear that record so each run stands for a later day
    const nextDay = () => e.ctx.db.raw.prepare('DELETE FROM operator_notifications').run();
    await e.runToEnd();
    nextDay();
    await e.runToEnd();
    nextDay();
    await e.runToEnd();
    expect(e.ctx.repos.notifications.noticeKeyClaimed(`camoufox-cooldown:${A}`)).toBe(true);
    expect(e.ctx.repos.notifications.noticeKeyClaimed(`camoufox-cooldown:${B}`)).toBe(true);
    expect(e.notifications.filter((n) => n.kind === 'provider_disabled')).toHaveLength(2);
  });
  it('a notice that fails to send leaves its key unclaimed, so a later run tries again', async () => {
    const e = engineWith(
      [
        stubCamoufox({
          cells: 2,
          preflight: { ok: false, skip: 'provider_disabled', detail: 'x', until: A },
        }),
      ],
      { notifierFails: true },
    );
    await e.runToEnd();
    expect(e.ctx.repos.notifications.noticeKeyClaimed(cooldownNoticeKey('camoufox', A))).toBe(false);
  });
});

describe('a manual resume of paused_budget keeps the camoufox page cap (arch I2)', () => {
  // why: fix round 2 (re-review N3): the resume must run, so the snapshot it persists is the refreshed one. The run
  // pauses at the page cap with cells left; two of its page rows are then removed, so the cap has two pages left; the
  // definition's cost cap is lowered (no confirmation needed), which the refreshed snapshot must show
  it('the refreshed snapshot still carries providerMaxCalls, and no page past the cap is loaded', async () => {
    const e = engineWith([stubCamoufox({ cells: 8 })], { camoufoxConfigCap: 4 });
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_budget');
    e.ctx.db.raw
      .prepare(
        "DELETE FROM provider_requests WHERE id IN (SELECT id FROM provider_requests WHERE execution_id = ? AND provider_id = 'camoufox' ORDER BY id LIMIT 2)",
      )
      .run(ex.id);
    // why: fix round 2 (CodeRabbit major): the retry factor never asks more pages than the cap has left
    const { estimateRemainingFor } = await import('../src/estimate.js');
    const paused = e.ctx.repos.executions.get(ex.id);
    if (paused === null) throw new Error('gone');
    expect(
      estimateRemainingFor(e.ctx, paused, true).perProvider.find((p) => p.providerId === 'camoufox')?.calls,
    ).toBe(2);
    e.ctx.repos.definitions.update(e.definition.id, {
      budget: { ...e.definition.budget, maxCostMicroGbp: 999 },
    });
    const r = await e.resumeResult(ex.id, { manual: true });
    expect(r.ok ? 'ok' : `${r.code}: ${r.message}`).toBe('ok');
    for (
      let i = 0;
      i < 500 && ['pending', 'running'].includes(e.ctx.repos.executions.get(ex.id)?.status ?? '');
      i++
    )
      await new Promise((res) => setTimeout(res, 2));
    const stored = e.ctx.repos.executions.get(ex.id);
    expect(stored?.snapshot.budget.maxCostMicroGbp).toBe(999);
    expect(stored?.snapshot.budget.providerMaxCalls).toEqual({ camoufox: 4 });
    // two pages left: the resumed pass loads two of the four remaining cells and stops at the cap
    expect(e.ledgerRows('camoufox').filter((row) => row.pageClass === 'page')).toHaveLength(4);
    expect(
      outcomes(e, ex.id, 'camoufox').filter((o) => o.status === 'skipped' && o.reason === 'budget'),
    ).toHaveLength(2);
    expect(stored?.status).toBe('paused_budget');
  });
});

describe('the real adapter through the engine: what is stored for each answer (prov I3)', () => {
  it('a price: priced, no reason, last_error the return-date label; calendar_prices scraped-self with the page’s point of sale', async () => {
    const e = engineWith([realCamoufox([priced()], 1)]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason, o.lastError])).toEqual([
      ['priced', null, 'return date: the date asked for'],
    ]);
    const rows = e.ctx.db.raw
      .prepare<[string], { sourceKind: string; pointOfSale: string; amountMinor: number }>(
        'SELECT source_kind AS sourceKind, point_of_sale AS pointOfSale, price_pence AS amountMinor FROM calendar_prices WHERE execution_id = ?',
      )
      .all(ex.id);
    expect(rows).toEqual([{ sourceKind: 'scraped-self', pointOfSale: 'GB', amountMinor: 45_100 }]);
  });
  it('the point of sale stored is the page’s own (unknown), never POINT_OF_SALE', async () => {
    const e = engineWith([realCamoufox([cells(priced().body.cell, 'unknown')], 1)]);
    const ex = await e.runToEnd();
    const pos = e.ctx.db.raw
      .prepare<[string], { pointOfSale: string }>(
        'SELECT point_of_sale AS pointOfSale FROM calendar_prices WHERE execution_id = ?',
      )
      .all(ex.id);
    expect(pos).toEqual([{ pointOfSale: 'unknown' }]);
  });
  it('a partial price: priced with offers-dropped and the detail in last_error', async () => {
    const e = engineWith([realCamoufox([priced({ optionsUnparsed: 2 })], 1)]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason, o.lastError])).toEqual([
      ['priced', 'offers-dropped:2', 'return date: the date asked for; options unread: 2'],
    ]);
  });
  it('no flights: no_data, never empty, no price row', async () => {
    const e = engineWith([realCamoufox([cells({ status: 'no-flights' })], 1)]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => o.status)).toEqual(['no_data']);
  });
  it('none for this cell: error, reason parse, the counts in last_error; no cool-down and the next cell still runs', async () => {
    const e = engineWith([
      realCamoufox(
        [cells({ status: 'none-for-cell', optionsOtherCell: 3, optionsUnparsed: 0 }), priced()],
        2,
      ),
    ]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason, o.lastError])).toEqual([
      ['error', 'parse', 'no option for this cell; options for another cell: 3'],
      ['priced', null, 'return date: the date asked for'],
    ]);
  });
  it('a block through the real classifier: error/blocked, the rest skipped, keyed by the worker’s end', async () => {
    const e = engineWith([
      realCamoufox([{ status: 423, body: { kind: 'blocked', page: 'captcha', cooldownUntil: B } }], 3),
    ]);
    const ex = await e.runToEnd();
    expect(outcomes(e, ex.id, 'camoufox').map((o) => [o.status, o.reason])).toEqual([
      ['error', 'blocked'],
      ['skipped', 'provider_disabled'],
      ['skipped', 'provider_disabled'],
    ]);
    expect(e.ctx.repos.notifications.noticeKeyClaimed(cooldownNoticeKey('camoufox', B))).toBe(true);
  });
});

// why: fix round 1 (CodeRabbit major): a resume counts the pages the execution already loaded
describe('a resume reads the page cap the execution has left', () => {
  it('with the cap spent, a manual resume is refused naming the provider-execution cap, and nothing is reserved', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 })], { camoufoxConfigCap: 2 });
    const ex = await e.runToEnd();
    expect(ex.status).toBe('paused_budget');
    const r = await e.resumeResult(ex.id, { manual: true });
    expect(r).toMatchObject({ ok: false, code: 'cap' });
    expect(r.ok ? '' : r.message).toMatch(/camoufox/);
    expect(e.ledgerRows('camoufox')).toHaveLength(2);
  });
  it('with no page left the remaining line asks one page (which the cap refuses), never the whole cap', async () => {
    const e = engineWith([stubCamoufox({ cells: 6 })], { camoufoxConfigCap: 4 });
    const ex = await e.runToEnd();
    const { estimateRemainingFor } = await import('../src/estimate.js');
    const exec = e.ctx.repos.executions.get(ex.id);
    if (exec === null) throw new Error('gone');
    const line = estimateRemainingFor(e.ctx, exec, true).perProvider.find((p) => p.providerId === 'camoufox');
    expect(line?.planCalls).toBe(1);
  });
});
