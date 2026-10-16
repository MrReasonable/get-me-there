import { asIsoDate, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import { coverageCheckWith } from '../src/coverageCheck.js';
import { estimateStart } from '../src/estimate.js';
import { OPERATOR_KINDS, renderOperatorMessage } from '../src/notifiers/operatorTemplates.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  createHarness,
  discoveryOf,
  FIXTURE_COST_MICRO_GBP,
  FIXTURE_RULES,
  type Harness,
  itineraryRule,
  JFK,
  LGW,
  LHR,
  tileRule,
  withVerification,
} from './support/harness.js';
import { extraTile } from './support/wrappers.js';

const clean = (label: string, text: string) =>
  expect(findBannedWords(text, BANNED_WORD_ALLOWLIST), `${label}: "${text}"`).toEqual([]);

/** Every string the engine emitted in a harness: notification subjects and bodies, log messages and string fields, cell reasons and last errors. */
function emitted(h: Harness, executionIds: string[]): string[] {
  const out: string[] = [];
  for (const n of h.notifications) out.push(n.subject, n.body);
  for (const l of h.logs) {
    if (l.msg !== undefined) out.push(l.msg);
    for (const v of Object.values(l.fields)) if (typeof v === 'string') out.push(v);
  }
  for (const id of executionIds)
    for (const o of h.outcomes(id))
      out.push(...[o.reason, o.lastError].filter((x): x is string => x !== null));
  return out;
}

describe('spec §14: executionId, definitionId and providerId on engine lines; no full URLs', () => {
  it('holds over a run with errors in both stages', async () => {
    const h = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await h.fixtureScenario([
      tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3),
      itineraryRule(FIXTURE_RULES.badRequest, 1),
    ]);
    const def = h.createDefinition({
      origins: [LHR, LGW],
      destinations: [JFK],
      providers: withVerification(),
    });
    await h.runToCompletion(h.orch(), def.id);
    const engineLines = h.logs.filter((l) => l.bindings.executionId !== undefined);
    expect(engineLines.length).toBeGreaterThan(5);
    for (const l of engineLines) expect(l.bindings.definitionId).toBe(def.id);
    const providerMsgs = ['discovery: planned tiles', 'cells marked error', 'verification: searching cells'];
    for (const msg of providerMsgs) {
      const lines = engineLines.filter((x) => x.msg === msg);
      expect(lines.length, msg).toBeGreaterThan(0);
      for (const l of lines) expect(l.bindings.providerId).toBe('fixture');
    }
    const all = JSON.stringify(h.logs);
    expect(all).not.toMatch(/https?:\/\/[^\s"]*\?/); // no query strings
    expect(all).not.toMatch(/https?:\/\/[^\s"/]*@/); // no userinfo
  });
});

describe('spec §11: no banned word in any string the engine emits, swept at runtime (test-strategy-017)', () => {
  it('every template, for every kind', () => {
    for (const kind of OPERATOR_KINDS) {
      for (const variant of [undefined, 'no-runnable-provider'] as const) {
        const m = renderOperatorMessage(kind, {
          definitionName: 'London to New York',
          executionId: 'e1',
          detail: 'detail',
          ...(variant === undefined ? {} : { variant }),
        });
        clean(`${kind} subject`, m.subject);
        clean(`${kind} body`, m.body);
      }
    }
  });

  it('notifications, logs, cell reasons and refusal messages from runs that pause, disable, cap, break parity and refuse', async () => {
    const strings: string[] = [];
    const messages: string[] = [];
    // errors in both stages, a disabled provider, paused_error
    const a = createHarness({ fixtureConcurrency: 1, fakeTimers: true });
    await a.fixtureScenario([
      tileRule('LHR', '2026-11-02', FIXTURE_RULES.upstream, 3),
      itineraryRule(FIXTURE_RULES.auth, 1),
    ]);
    const ea = await a.runToCompletion(
      a.orch(),
      a.createDefinition({ origins: [LHR, LGW], destinations: [JFK], providers: withVerification() }).id,
    );
    strings.push(...emitted(a, [ea.id]));
    // a budget pause with the calendar-only notice
    const b = createHarness({ fixtureConcurrency: 1, fixtureMonthlyCallCap: 200, fakeTimers: true });
    b.onStageStart('verification', () =>
      b.spendLedger({
        providerId: 'fixture',
        rows: 200 - b.deps.budget.usage({ kind: 'provider-month', providerId: 'fixture' }).calls,
        costMicroGbpEach: FIXTURE_COST_MICRO_GBP,
      }),
    );
    const bdef = b.createDefinition({ providers: withVerification() });
    b.repos.alerts.create({
      definitionId: bdef.id,
      type: 'absolute',
      thresholdPence: 100_000,
      pct: null,
      basis: 'calendar',
      requireAllVerified: null,
      cooldownHours: 336,
      enabled: true,
    });
    const eb = await b.runToCompletion(b.orch(), bdef.id);
    strings.push(...emitted(b, [eb.id]));
    // a parity break
    const d = createHarness({ transformFixture: extraTile, fakeTimers: true });
    const ed = await d.runToCompletion(d.orch(), d.createDefinition().id);
    strings.push(...emitted(d, [ed.id]));
    // refusals: confirm, window, cap, outside the space, missing execution
    const c = createHarness({ env: { SOFT_CONFIRM_PENCE: '0' }, fakeTimers: true });
    const o = c.orch();
    const def = c.createDefinition({ providers: withVerification() });
    for (const r of [
      await o.start(def.id, { trigger: 'manual' }),
      await o.start(
        c.createDefinition({
          window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-09-02') },
        }).id,
        { trigger: 'schedule' },
      ),
      await o.start(c.createDefinition({ budget: { maxCalls: 0, maxFreeCalls: 0, maxCostMicroGbp: 0 } }).id, {
        trigger: 'manual',
      }),
      await o.verifyCell(def.id, {
        origin: LHR,
        destination: JFK,
        departureDate: asIsoDate('2027-01-01'),
        returnDate: asIsoDate('2027-01-08'),
      }),
      await o.resume('no-such-execution', { manual: true }),
    ])
      if (!r.ok) messages.push(r.message);
    expect(messages).toHaveLength(5);
    strings.push(...messages, ...emitted(c, []));
    const ctx = buildContext(c.deps, c.options);
    strings.push(
      ...(
        await c.drive(
          coverageCheckWith(ctx, 'fixture', discoveryOf(c.fixture), {
            origins: [LHR],
            destinations: [JFK],
            window: def.window,
            minNights: 7,
            maxNights: 8,
          }),
        )
      ).notes,
    );
    const snap = buildSnapshot(ctx, def);
    strings.push(...estimateStart(ctx, snap.snapshot, snap.cells, null).assumptions);
    // why: the sweep is only as good as what it saw; each of these must have been emitted
    const kinds = [...a.notifications, ...b.notifications, ...c.notifications, ...d.notifications].map(
      (n) => n.kind,
    );
    for (const k of [
      'provider_disabled',
      'paused_error',
      'paused_budget',
      'alerts_calendar_only',
      'parity_break',
      'skipped_window',
    ] as const)
      expect(kinds, k).toContain(k);
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) clean('engine string', s);
  });
});
