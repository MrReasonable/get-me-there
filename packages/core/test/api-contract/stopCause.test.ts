import { describe, expect, expectTypeOf, it } from 'vitest';
import {
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
      { kind: 'fatal' },
      { kind: 'child-cap' },
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
    expect(stopCauseSchema.safeParse(sources({ searched: -1 })).success).toBe(false);
    expect(stopCauseSchema.safeParse(budget({ cap: -1 })).success).toBe(false);
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
