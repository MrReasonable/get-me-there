import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  budgetUnitsFor,
  STOP_DETAILS,
  type StopCause,
  stopCauseSchema,
  stopTextSchema,
} from '../../src/api-contract/stopCause.js';
import { BLOCKED_PAGES } from '../../src/camoufox/protocol.js';
import { BUDGET_SCOPE_KINDS, type BudgetScopeKind, PROVIDER_ERROR_KINDS } from '../../src/errors.js';

const UNTIL = '2027-03-14T15:00:00.000Z';
const source = {
  providerId: 'camoufox',
  skip: 'provider_unavailable',
  detail: 'provider-unavailable',
  until: null,
};
const sources = (over: Record<string, unknown> = {}) => ({
  kind: 'sources-unavailable',
  stage: 'discovery',
  searched: 0,
  sources: [source],
  ...over,
});
const budget = (over: Record<string, unknown> = {}) => ({
  kind: 'budget',
  scope: 'provider-execution',
  providerId: 'camoufox',
  unit: 'pages',
  cap: 100,
  resumeAfter: null,
  resetsAt: null,
  flights: { read: 8, planned: 10 },
  ...over,
});

describe('STOP_DETAILS (spec rev 55 §8.1 "Stop causes")', () => {
  it("starts with the nine ProviderError kinds and the blocked page kinds, then the app's own words", () => {
    expect(STOP_DETAILS.slice(0, 9)).toEqual([...PROVIDER_ERROR_KINDS]);
    expect(STOP_DETAILS.slice(9, 9 + BLOCKED_PAGES.length)).toEqual([...BLOCKED_PAGES]);
    expect(STOP_DETAILS.slice(9 + BLOCKED_PAGES.length)).toEqual([
      'settings-differ',
      'grid-unverified',
      'counts-unreadable',
      'no-airport-names',
      'none-for-cell',
      'unparsed',
      'monthly-cap',
      'execution-cap',
      'free-call-cap',
      'outside-browser-window',
      'fatal',
      'aborted',
    ]);
    expect(new Set(STOP_DETAILS).size).toBe(STOP_DETAILS.length);
  });
});

describe('stopCauseSchema', () => {
  it('parses every kind in its stored shape', () => {
    const all: unknown[] = [
      sources(),
      sources({
        stage: 'verification',
        searched: 120,
        sources: [
          { providerId: 'camoufox', skip: 'provider_disabled', detail: 'blocked', until: UNTIL },
          { providerId: 'travelpayouts', skip: 'provider_disabled', detail: 'auth', until: null },
        ],
      }),
      budget(),
      budget({
        scope: 'global-month',
        providerId: null,
        unit: 'pence',
        cap: 3500,
        resetsAt: UNTIL,
        flights: null,
      }),
      { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: UNTIL },
      { kind: 'cancelled' },
      { kind: 'superseded', by: 'schedule' },
      { kind: 'superseded', by: 'search-again' },
      { kind: 'superseded', by: 'stale' },
      { kind: 'superseded', by: 'remove' },
      { kind: 'never-started' },
      { kind: 'interrupted' },
      { kind: 'interrupted', browserWindowLeft: true },
      { kind: 'fatal' },
      { kind: 'child-cap' },
      { kind: 'tool', ended: 'failed' },
      { kind: 'tool', ended: 'aborted' },
      { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: 100 },
      { kind: 'skipped-confirm', estimatePence: 120, confirmedPence: null },
      { kind: 'skipped-budget', scope: 'global-month', providerId: null },
      { kind: 'skipped-window' },
      { kind: 'skipped-missed', code: 'half-cadence' },
    ];
    for (const c of all) expect(stopCauseSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
  });

  it('refuses a sources-unavailable cause naming no source', () => {
    expect(stopCauseSchema.safeParse(sources({ sources: [] })).success).toBe(false);
  });

  it('refuses a detail outside STOP_DETAILS, so no free text is ever stored', () => {
    const c = sources({ sources: [{ ...source, detail: 'the worker said no' }] });
    expect(stopCauseSchema.safeParse(c).success).toBe(false);
  });

  it('refuses an until that is not an instant', () => {
    const c = sources({ sources: [{ ...source, until: '14 Mar 15:00' }] });
    expect(stopCauseSchema.safeParse(c).success).toBe(false);
  });

  it('refuses an unknown kind, an unknown key and a negative count', () => {
    expect(stopCauseSchema.safeParse({ kind: 'paused' }).success).toBe(false);
    expect(stopCauseSchema.safeParse({ kind: 'cancelled', message: 'error' }).success).toBe(false);
    // why: the interrupted cause's one flag is only ever true (absent otherwise), so a stored false is refused
    expect(stopCauseSchema.safeParse({ kind: 'interrupted', browserWindowLeft: false }).success).toBe(false);
    expect(stopCauseSchema.safeParse(sources({ searched: -1 })).success).toBe(false);
    expect(stopCauseSchema.safeParse(budget({ cap: -1 })).success).toBe(false);
  });

  it('refuses a unit its scope does not count (budgetUnitsFor)', () => {
    const ok = (o: Record<string, unknown>) =>
      stopCauseSchema.safeParse(budget({ flights: null, ...o })).success;
    expect(ok({ scope: 'execution-cost', providerId: null, unit: 'calls' })).toBe(false);
    expect(ok({ scope: 'global-month', providerId: null, unit: 'calls' })).toBe(false);
    expect(ok({ scope: 'execution-calls', providerId: null, unit: 'pence' })).toBe(false);
    expect(ok({ scope: 'provider-lifetime', providerId: 'searchapi', unit: 'pages' })).toBe(false);
    // why: pages and scrolls are the browser worker's; another provider's month and run caps count calls
    expect(ok({ scope: 'provider-month', providerId: 'searchapi', unit: 'pages' })).toBe(false);
    expect(ok({ scope: 'provider-execution', unit: 'calls' })).toBe(false);
    expect(ok({ scope: 'provider-month', unit: 'scrolls' })).toBe(true);
    expect(ok({ scope: 'provider-month', providerId: 'travelpayouts', unit: 'calls' })).toBe(true);
    expect(ok({ scope: 'execution-cost', providerId: null, unit: 'pence' })).toBe(true);
  });

  it("keeps the guard's provider on every scope, skipped or stopped (BudgetExceeded names it on each)", () => {
    const ok = (o: Record<string, unknown>) =>
      stopCauseSchema.safeParse(budget({ flights: null, ...o })).success;
    expect(ok({ scope: 'global-month', providerId: 'camoufox', unit: 'pence' })).toBe(true);
    expect(ok({ scope: 'execution-calls', providerId: 'searchapi', unit: 'calls' })).toBe(true);
    expect(ok({ scope: 'execution-cost', providerId: 'searchapi', unit: 'pence' })).toBe(true);
    expect(ok({ scope: 'provider-lifetime', providerId: null, unit: 'calls' })).toBe(true);
    const skipped = (scope: string, providerId: string | null) =>
      stopCauseSchema.safeParse({ kind: 'skipped-budget', scope, providerId }).success;
    expect(skipped('execution-cost', 'searchapi')).toBe(true);
    expect(skipped('global-month', 'camoufox')).toBe(true);
    expect(skipped('provider-month', null)).toBe(true);
  });

  it("refuses flights on any cause but the browser worker's per-run page cap", () => {
    const flights = { read: 2, planned: 10 };
    const ok = (o: Record<string, unknown>) => stopCauseSchema.safeParse(budget({ flights, ...o })).success;
    expect(ok({})).toBe(true);
    expect(ok({ scope: 'provider-month' })).toBe(false);
    expect(ok({ scope: 'provider-execution', providerId: 'searchapi', unit: 'calls' })).toBe(false);
    expect(ok({ scope: 'execution-cost', providerId: null, unit: 'pence' })).toBe(false);
  });

  it('names the field and the rule in each refusal it makes', () => {
    const issues = (c: unknown) =>
      stopCauseSchema.safeParse(c).error?.issues.map(({ code, path, message }) => ({ code, path, message }));
    expect(
      issues(budget({ scope: 'execution-cost', providerId: null, unit: 'calls', flights: null })),
    ).toEqual([{ code: 'custom', path: ['unit'], message: 'execution-cost does not count calls' }]);
    expect(issues(budget({ scope: 'provider-month' }))).toEqual([
      {
        code: 'custom',
        path: ['flights'],
        message: "flights only follow the browser worker's per-run page cap",
      },
    ]);
    expect(issues(budget({ flights: { read: 11, planned: 10 } }))).toEqual([
      { code: 'custom', path: ['flights', 'read'], message: 'flights read must not exceed flights planned' },
    ]);
  });

  it('budgetUnitsFor names the units of every scope', () => {
    expect(budgetUnitsFor('execution-cost', null)).toEqual(['pence']);
    expect(budgetUnitsFor('global-month', null)).toEqual(['pence']);
    expect(budgetUnitsFor('execution-calls', null)).toEqual(['calls']);
    expect(budgetUnitsFor('execution-free-calls', null)).toEqual(['calls']);
    expect(budgetUnitsFor('provider-lifetime', 'searchapi')).toEqual(['calls']);
    expect(budgetUnitsFor('provider-lifetime', 'camoufox')).toEqual(['calls']);
    expect(budgetUnitsFor('provider-execution', 'camoufox')).toEqual(['pages', 'scrolls']);
    expect(budgetUnitsFor('provider-month', 'camoufox')).toEqual(['pages', 'scrolls']);
    expect(budgetUnitsFor('provider-month', 'travelpayouts')).toEqual(['calls']);
    expect(budgetUnitsFor('provider-execution', null)).toEqual(['calls']);
  });

  it('refuses flights read above the flights planned', () => {
    expect(stopCauseSchema.safeParse(budget({ flights: { read: 10, planned: 10 } })).success).toBe(true);
    expect(stopCauseSchema.safeParse(budget({ flights: { read: 11, planned: 10 } })).success).toBe(false);
  });

  it('infers the StopCause type', () => {
    expectTypeOf<Extract<StopCause, { kind: 'budget' }>['scope']>().toEqualTypeOf<BudgetScopeKind>();
  });
});

describe('stopTextSchema', () => {
  const text = { sentence: 'Stopped by you.', fix: { text: 'Search again', command: null } };
  it('parses a sentence with a fix, and one without', () => {
    expect(stopTextSchema.parse(text)).toEqual(text);
    expect(stopTextSchema.safeParse({ sentence: 'Replaced by a scheduled run.', fix: null }).success).toBe(
      true,
    );
    const cmd = { text: 'Start it with pnpm gmt start, then Search again', command: 'pnpm gmt start' };
    expect(stopTextSchema.safeParse({ ...text, fix: cmd }).success).toBe(true);
  });
  it('refuses a command that is not a pnpm gmt line, and a sentence over 400 characters', () => {
    expect(stopTextSchema.safeParse({ ...text, fix: { text: 'x', command: 'rm -rf /' } }).success).toBe(
      false,
    );
    expect(stopTextSchema.safeParse({ ...text, fix: { text: 'x', command: 'pnpm gmtstart' } }).success).toBe(
      false,
    );
    expect(stopTextSchema.safeParse({ ...text, sentence: 'a'.repeat(400) }).success).toBe(true);
    expect(stopTextSchema.safeParse({ ...text, sentence: 'a'.repeat(401) }).success).toBe(false);
  });
  it('refuses an unknown key', () => {
    expect(stopTextSchema.safeParse({ ...text, errorText: 'paused: error' }).success).toBe(false);
  });
});

describe('BUDGET_SCOPE_KINDS (spec §5.1)', () => {
  it('has the seven scopes, and BudgetScopeKind derives from it', () => {
    expect(BUDGET_SCOPE_KINDS).toEqual([
      'execution-calls',
      'execution-free-calls',
      'execution-cost',
      'provider-execution',
      'provider-month',
      'provider-lifetime',
      'global-month',
    ]);
    expectTypeOf<BudgetScopeKind>().toEqualTypeOf<(typeof BUDGET_SCOPE_KINDS)[number]>();
  });
});
