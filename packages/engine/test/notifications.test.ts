import { type AlertDigest, asIsoDate, findBannedWords, type OperatorMessage } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { containsSynthetic, LogNotifier } from '../src/notifiers/log.js';
import { OPERATOR_KINDS, renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { notifyOperator } from '../src/notify.js';
import {
  capturingLogger,
  createHarness,
  type Harness,
  HOUR,
  JFK,
  LHR,
  type LogLine,
  T0,
} from './support/harness.js';

async function anExecution(h: Harness): Promise<{ id: string; definitionId: string }> {
  const def = h.createDefinition();
  const e = await h.runToCompletion(h.orch(), def.id);
  return { id: e.id, definitionId: def.id };
}

/** A complete digest (plan "Notifier port") whose one item carries a synthetic price. */
function syntheticDigest(): AlertDigest {
  const rule = {
    id: 'r1',
    definitionId: 'd1',
    type: 'absolute',
    thresholdPence: 50_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  } as const;
  return {
    ruleId: 'r1',
    definitionId: 'd1',
    executionId: 'e1',
    basis: 'calendar',
    items: [
      {
        pricePence: 41_200,
        provenance: {
          providerId: 'fixture',
          sourceKind: 'synthetic',
          fetchedAt: T0,
          maxAgeHours: 0,
          fx: { converted: false },
          pointOfSale: 'unknown',
          cabin: 'economy',
        },
        cell: {
          origin: LHR,
          destination: JFK,
          departureDate: asIsoDate('2026-11-02'),
          returnDate: asIsoDate('2026-11-09'),
          nights: 7,
        },
        verdictClass: 'unchecked',
        itineraryHash: null,
        seller: null,
        unverified: [],
        previousPricePence: null,
        fetchGapHours: null,
        isNew: true,
        firingReason: 'below £500',
        booking: { kind: 'none' },
        bookingExpiresAt: null,
        outbound: null,
        inbound: null,
        searchLink: null,
        rowKey: 'calendar:1',
      },
    ],
    restCount: 0,
    newItems: [],
    newRestCount: 0,
    coverageCaveat: null,
    rule,
  };
}

describe('operator notifications (spec §8.1 "deduplicated per execution and kind")', () => {
  it('sends one message per (kind, execution) however often it is asked', async () => {
    const h = createHarness();
    const { id, definitionId } = await anExecution(h);
    const ctx = buildContext(h.deps, h.options);
    const p = { executionId: id, definitionId, definitionName: 'x', detail: 'cap reached' };
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p)).toBe(false);
    expect(await notifyOperator(ctx, 'provider_disabled', p)).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['paused_budget', 'provider_disabled']);
    expect(h.repos.notifications.wasSent('paused_budget', id, definitionId)).toBe(true);
  });

  it('a second execution of the same definition is told on a later London day, not the same day (decision 56; test-strategy-reviewer-025)', async () => {
    const h = createHarness();
    const first = await anExecution(h);
    const def = h.repos.definitions.get(first.definitionId);
    if (def === null) throw new Error('no definition');
    const second = await h.runToCompletion(h.orch(), def.id);
    const ctx = buildContext(h.deps, h.options);
    const p = (executionId: string) => ({
      executionId,
      definitionId: def.id,
      definitionName: 'x',
      detail: 'cap',
    });
    expect(await notifyOperator(ctx, 'paused_budget', p(first.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(false);
    expect(await notifyOperator(ctx, 'paused_error', p(second.id))).toBe(true); // another kind is told
    h.clock.advance(24 * HOUR);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(true);
    expect(await notifyOperator(ctx, 'paused_budget', p(second.id))).toBe(false);
    expect(h.notifications.map((m) => [m.kind, m.body.split('\n').at(-1)])).toEqual([
      ['paused_budget', `Execution: ${first.id}`],
      ['paused_error', `Execution: ${second.id}`],
      ['paused_budget', `Execution: ${second.id}`],
    ]);
  });

  it('with no execution the key is (kind, definition): once per definition, again for another definition', async () => {
    const h = createHarness();
    const ctx = buildContext(h.deps, h.options);
    const a = h.createDefinition();
    const b = h.createDefinition({ name: 'second' });
    const p = (definitionId: string) => ({
      executionId: null,
      definitionId,
      definitionName: 'x',
      detail: 'no configured provider can run it',
      variant: 'no-runnable-provider' as const,
    });
    expect(await notifyOperator(ctx, 'skipped_budget', p(a.id))).toBe(true);
    expect(await notifyOperator(ctx, 'skipped_budget', p(a.id))).toBe(false);
    expect(await notifyOperator(ctx, 'skipped_budget', p(b.id))).toBe(true);
    expect(h.notifications.map((m) => m.kind)).toEqual(['skipped_budget', 'skipped_budget']);
  });

  it('records a refused or throwing notifier as failed and logs a warning, without throwing', async () => {
    const h = createHarness();
    const { id, definitionId } = await anExecution(h);
    const boom = {
      id: 'boom',
      send: async (): Promise<{ ok: boolean }> => {
        throw new Error('smtp down at https://user:pw@mail.example/x?k=1');
      },
    };
    const ctx = { ...buildContext(h.deps, h.options), notifiers: [boom] };
    expect(
      await notifyOperator(ctx, 'paused_error', {
        executionId: id,
        definitionId,
        definitionName: 'x',
        detail: 'd',
      }),
      // why: fix round 1 (arch M4): false when a notifier failed, so a keyed notice is not claimed by a failed send
    ).toBe(false);
    const warn = h.logs.find((l) => l.msg === 'operator notification failed');
    expect(warn?.fields.err).toBe('smtp down at https://mail.example/x');
    // why: a failed send is recorded as failed, so the next occurrence tries again (wasSent counts only sent rows)
    expect(h.repos.notifications.wasSent('paused_error', id, definitionId)).toBe(false);
  });

  it('a SIGTERM pass emits exactly one `interrupted` notification', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const def = h.createDefinition();
    const orch = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void orch.shutdown();
    });
    const r = await orch.start(def.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    const msgs = h.notifications.filter((m) => m.kind === 'interrupted');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.executionId).toBe(r.executionId);
    expect(msgs[0]?.subject).toBe('[get-me-there] London to New York (layer A): run interrupted');
  });
});

describe('renderOperatorMessage', () => {
  it('every kind has a prefixed subject, a body, no banned word and no URL query (spec §11, §5.3)', () => {
    for (const kind of OPERATOR_KINDS) {
      const m = renderOperatorMessage(kind, {
        definitionName: 'London to New York',
        executionId: 'e1',
        detail: 'see https://x.example/p?token=abc',
      });
      expect(m.subject.startsWith('[get-me-there] London to New York: ')).toBe(true);
      expect(m.body.length).toBeGreaterThan(0);
      expect(findBannedWords(`${m.subject}\n${m.body}`)).toEqual([]);
      expect(`${m.subject}${m.body}`).not.toMatch(/\?token=/);
    }
  });
  it('strips C0 and C1 control characters from provider-supplied text (spec §8.3, decision 21)', () => {
    const m = renderOperatorMessage('provider_disabled', {
      definitionName: 'a\u0007b',
      executionId: null,
      detail: 'x\u001b[31my\u009bz',
    });
    expect(m.subject).toBe('[get-me-there] a b: a provider was disabled for this run');
    expect(m.body.startsWith('x [31my z')).toBe(true);
  });
  it('a scheduled run no provider can run has its own subject and guidance (po-003)', () => {
    const m = renderOperatorMessage('skipped_budget', {
      definitionName: 'd',
      executionId: null,
      detail: 'searchapi is excluded from scheduled runs on its plan',
      variant: 'no-runnable-provider',
    });
    expect(m.subject).toBe('[get-me-there] d: scheduled run skipped: no configured provider can run it');
    expect(m.body).not.toContain('raise the cap');
  });
});

describe('LogNotifier (spec §8.3)', () => {
  it('logs subject and body as plain text and reports ok', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const msg: OperatorMessage = {
      kind: 'parity_break',
      executionId: 'e1',
      definitionId: 'd1',
      subject: 's\u0000',
      body: 'b1\nb2',
    };
    expect(await n.send({ kind: 'operator', message: msg })).toEqual({ ok: true });
    expect(lines[0]).toMatchObject({
      level: 'info',
      bindings: { notifier: 'log' },
      fields: { kind: 'parity_break', executionId: 'e1', definitionId: 'd1', subject: 's' },
      msg: 'b1\nb2',
    });
  });
  it('refuses anything carrying a synthetic price (spec §5.5 "Alerts and notifiers refuse synthetic rows")', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const r = await n.send({ kind: 'digest', digest: syntheticDigest(), subject: 's', body: 'b' });
    expect(r.ok).toBe(false);
    expect(lines).toHaveLength(0);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'authorised-cached' } }] })).toBe(false);
    expect(containsSynthetic({ a: [{ b: { sourceKind: 'synthetic' } }] })).toBe(true);
  });
  it('logs a digest without synthetic rows', async () => {
    const lines: LogLine[] = [];
    const n = new LogNotifier(capturingLogger(lines));
    const d = syntheticDigest();
    const real = { ...d, items: [] };
    expect(await n.send({ kind: 'digest', digest: real, subject: 'digest\u0007', body: 'one\ntwo' })).toEqual(
      { ok: true },
    );
    expect(lines[0]).toMatchObject({
      fields: { kind: 'alert_digest', ruleId: 'r1', subject: 'digest' },
      msg: 'one\ntwo',
    });
  });
});
