// Spec revision 55 §8.1 "Stop causes": `stopCauseOf` maps every stop reason to the cause the row stores, and every
// cause it builds is one `stopCauseSchema` accepts (no free text, no vendor sentence).
import {
  apiContract,
  asIsoDate,
  asIsoDateTime,
  BudgetExceeded,
  type BudgetScopeKind,
  type ProviderId,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildContext } from '../src/context.js';
import type { StopReason } from '../src/run.js';
import { buildSnapshot } from '../src/snapshot.js';
import {
  disabledDetailBefore,
  isBrowserPageLimit,
  searchedDatePairsOf,
  stopCauseOf,
  toStopDetail,
} from '../src/stopCause.js';
import { causeRun } from './support/causeRun.js';
import { createHarness, EWR, JFK, LGW, LHR } from './support/harness.js';

const RESUME = asIsoDateTime('2026-11-01T00:00:00.000Z');
const budget = (
  scope: BudgetScopeKind,
  providerId: ProviderId | undefined,
  over: { unit?: 'scrolls'; cap?: number } = {},
): StopReason => ({
  kind: 'budget',
  error: new BudgetExceeded({
    scope,
    cap: over.cap ?? 40,
    current: 40,
    requested: 1,
    ...(providerId === undefined ? {} : { providerId }),
    ...(over.unit === undefined ? {} : { unit: over.unit }),
  }),
  resumeAfter: RESUME,
  resetsAt: RESUME,
});

describe('stopCauseOf (revision 55 §8.1)', () => {
  it('sigterm, cancel, fatal and child-cap', () => {
    expect(stopCauseOf({ kind: 'sigterm' }, causeRun(), true)).toEqual({ kind: 'interrupted' });
    for (const cause of [
      { kind: 'cancelled' },
      { kind: 'superseded', by: 'remove' },
      { kind: 'superseded', by: 'stale' },
    ] as const)
      expect(stopCauseOf({ kind: 'cancel', cause }, causeRun(), true)).toEqual(cause);
    expect(stopCauseOf({ kind: 'fatal', message: 'SQLITE_FULL at /data/x.db' }, causeRun(), true)).toEqual({
      kind: 'fatal',
    });
    const err = new BudgetExceeded({ scope: 'execution-calls', cap: 6, current: 6, requested: 1 });
    expect(stopCauseOf({ kind: 'child-cap', error: err }, causeRun(), true)).toEqual({ kind: 'child-cap' });
  });

  it('a SIGTERM after a browser lane left its window marks the interrupted cause (final review ruling); a catch-up lane does not', () => {
    const left = (windowOut: 'outside-browser-window' | 'catch-up-no-browser' | null) =>
      causeRun({ lanes: new Map([['discovery|camoufox', { windowOut }]]) });
    expect(stopCauseOf({ kind: 'sigterm' }, left('outside-browser-window'), true)).toEqual({
      kind: 'interrupted',
      browserWindowLeft: true,
    });
    expect(stopCauseOf({ kind: 'sigterm' }, left('outside-browser-window'), false)).toEqual({
      kind: 'interrupted',
      browserWindowLeft: true,
    });
    // why: a catch-up leaves its browser cells by design (decision 79), not because a window closed
    expect(stopCauseOf({ kind: 'sigterm' }, left('catch-up-no-browser'), true)).toEqual({
      kind: 'interrupted',
    });
    expect(stopCauseOf({ kind: 'sigterm' }, left(null), true)).toEqual({ kind: 'interrupted' });
  });

  it('a limiter timeout carries its provider, and its resume only on a scheduled search (Ian ruling 2)', () => {
    const stop: StopReason = { kind: 'limiter-timeout', providerId: 'travelpayouts', resumeAfter: RESUME };
    expect(stopCauseOf(stop, causeRun(), true)).toEqual({
      kind: 'limiter-timeout',
      providerId: 'travelpayouts',
      resumeAfter: RESUME,
    });
    expect(stopCauseOf(stop, causeRun(), false)).toMatchObject({ resumeAfter: null });
  });

  it.each<[string, StopReason, string, number, boolean]>([
    ['camoufox per-run pages', budget('provider-execution', 'camoufox'), 'pages', 40, false],
    [
      'camoufox per-run scrolls',
      budget('provider-execution', 'camoufox', { unit: 'scrolls' }),
      'scrolls',
      40,
      false,
    ],
    ['camoufox monthly pages', budget('provider-month', 'camoufox'), 'pages', 40, false],
    ['a monthly call cap', budget('provider-month', 'searchapi'), 'calls', 40, true],
    ['a lifetime call cap', budget('provider-lifetime', 'searchapi'), 'calls', 40, true],
    ['the run calls', budget('execution-calls', 'searchapi'), 'calls', 40, true],
    [
      'the run spend, in pence',
      budget('execution-cost', 'searchapi', { cap: 5_000_000 }),
      'pence',
      500,
      true,
    ],
    [
      'the month spend, in pence',
      budget('global-month', undefined, { cap: 350_000_000 }),
      'pence',
      35_000,
      true,
    ],
  ])('a budget stop at %s: scope, provider, unit, cap and resetsAt', (_n, stop, unit, cap, resumes) => {
    if (stop.kind !== 'budget') throw new Error('not a budget stop');
    const c = stopCauseOf(stop, causeRun(), true);
    expect(c).toEqual({
      kind: 'budget',
      scope: stop.error.scope,
      providerId: stop.error.providerId ?? null,
      unit,
      cap,
      resumeAfter: resumes ? RESUME : null,
      resetsAt: RESUME,
      flights: null,
    });
    expect(apiContract.stopCauseSchema.parse(c)).toEqual(c);
    // why: Ian's ruling 2 — an unscheduled search's pause never stores a resume, whatever the scope
    expect(stopCauseOf(stop, causeRun(), false)).toMatchObject({ resumeAfter: null, resetsAt: RESUME });
  });

  it('flights: the step counts on the browser per-run page cap only, null when the step did not run', () => {
    const run = causeRun({ flightLists: { read: 8, planned: 10 } });
    expect(stopCauseOf(budget('provider-execution', 'camoufox'), run, true)).toMatchObject({
      flights: { read: 8, planned: 10 },
    });
    expect(stopCauseOf(budget('provider-month', 'camoufox'), run, true)).toMatchObject({ flights: null });
    expect(stopCauseOf(budget('provider-execution', 'camoufox'), causeRun(), true)).toMatchObject({
      flights: null,
    });
    expect(isBrowserPageLimit({ scope: 'provider-month', providerId: 'searchapi' })).toBe(false);
  });

  it('all-disabled: every disabled source with its class word, the date pairs searched and the stage', () => {
    const run = causeRun({
      disabledDetail: new Map([
        ['camoufox', { skip: 'provider_disabled', detail: 'captcha', until: RESUME }],
        ['travelpayouts', { skip: 'provider_disabled', detail: 'auth', until: null }],
      ]),
      disabled: new Set<ProviderId>(['camoufox', 'travelpayouts', 'searchapi']),
      disabledReason: new Map([['searchapi', 'provider_unavailable']]),
      searchedDatePairs: () => 120,
      snapshot: {
        providers: {
          discovery: ['camoufox', 'travelpayouts', 'searchapi'],
          verification: [],
          discoveryRefreshHours: {},
        },
      },
    });
    const c = stopCauseOf({ kind: 'all-disabled', stage: 'discovery' }, run, true);
    expect(c).toEqual({
      kind: 'sources-unavailable',
      stage: 'discovery',
      searched: 120,
      sources: [
        { providerId: 'camoufox', skip: 'provider_disabled', detail: 'captcha', until: RESUME },
        { providerId: 'travelpayouts', skip: 'provider_disabled', detail: 'auth', until: null },
        {
          providerId: 'searchapi',
          skip: 'provider_unavailable',
          detail: 'provider-unavailable',
          until: null,
        },
      ],
    });
    expect(apiContract.stopCauseSchema.parse(c)).toEqual(c);
    // a stop with no disabled source at all is an internal fault, never an empty source list
    expect(stopCauseOf({ kind: 'all-disabled', stage: 'verification' }, causeRun(), true)).toEqual({
      kind: 'fatal',
    });
  });

  it('a stored word outside STOP_DETAILS is never stored: its fallback is', () => {
    expect(toStopDetail('auth', 'blocked')).toBe('auth');
    expect(toStopDetail('the key was refused by https://vendor.example', 'blocked')).toBe('blocked');
    expect(toStopDetail(null, 'parse')).toBe('parse');
  });
});

describe('the readers a pass seeds itself with (revision 55 §8.1, §6.6)', () => {
  /** An execution of a 4-airport-pair, one-date-pair search, seeded for `discovery`. */
  function seeded(discovery: ProviderId[] = ['fixture']) {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LHR, LGW],
      destinations: [JFK, EWR],
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-02') },
      minNights: 7,
      maxNights: 7,
    });
    const ctx = buildContext(h.deps, h.options);
    const b = buildSnapshot(ctx, def, 'manual');
    const e = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: b.snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    h.repos.cells.seed(e.id, b.cells, discovery);
    return { h, ctx, e, cells: b.cells };
  }

  it('searchedDatePairsOf counts with datePairSearched: one empty and three not run is not searched; one priced is', () => {
    const { h, ctx, e, cells } = seeded();
    const [a] = cells;
    if (a === undefined) throw new Error('no cells');
    expect(cells).toHaveLength(4);
    // why: the roll-up is what the reader reads; the tile writes that set it are the cells repository's own tests
    const rollUp = (status: string) =>
      h.db.raw
        .prepare(
          'UPDATE search_cells SET discovery_status = ? WHERE execution_id = ? AND origin = ? AND destination = ?',
        )
        .run(status, e.id, a.origin, a.destination);
    rollUp('empty');
    expect(searchedDatePairsOf(ctx, e)).toBe(0);
    rollUp('priced');
    expect(searchedDatePairsOf(ctx, e)).toBe(1);
  });

  it('disabledDetailBefore: a resumed pass keeps naming the source an earlier pass disabled, by its class word', () => {
    const { h, ctx, e, cells } = seeded();
    const [a, b, c] = cells;
    if (a === undefined || b === undefined || c === undefined) throw new Error('no cells');
    expect(disabledDetailBefore(ctx, e.id)).toEqual(new Map());
    h.repos.cells.setOutcome(e.id, a, 'discovery', 'fixture', {
      status: 'error',
      reason: 'auth',
      lastError: 'vendor said the key test-worker-key-0123456789abcdef0123456789abcdef is wrong',
    });
    h.repos.cells.setOutcome(e.id, b, 'discovery', 'fixture', {
      status: 'skipped',
      reason: 'provider_disabled',
    });
    expect(disabledDetailBefore(ctx, e.id)).toEqual(
      new Map([['fixture', { skip: 'provider_disabled', detail: 'auth', until: null }]]),
    );
    const other = seeded();
    const [x] = other.cells;
    if (x === undefined) throw new Error('no cells');
    other.h.repos.cells.setOutcome(other.e.id, x, 'discovery', 'fixture', {
      status: 'skipped',
      reason: 'provider_unavailable',
      lastError: 'browser worker not reachable',
    });
    expect(disabledDetailBefore(other.ctx, other.e.id).get('fixture')).toEqual({
      skip: 'provider_unavailable',
      detail: 'provider-unavailable',
      until: null,
    });
  });

  it.each<[string, string[], string]>([
    ['a disabling class word among other errors', ['upstream', 'auth'], 'auth'],
    ['quota', ['quota'], 'quota'],
    ['a parse streak', ['parse', 'parse'], 'parse'],
    ['a block', ['blocked'], 'blocked'],
    ['only errors that disable nothing', ['upstream', 'network'], 'blocked'],
  ])('disabledDetailBefore: %s names its word', (_n, errors, detail) => {
    const { h, ctx, e, cells } = seeded(['fixture', 'travelpayouts']);
    errors.forEach((reason, i) => {
      const c = cells[i];
      if (c === undefined) throw new Error('no cell');
      h.repos.cells.setOutcome(e.id, c, 'discovery', 'fixture', { status: 'error', reason, lastError: 'x' });
    });
    const last = cells[3];
    if (last === undefined) throw new Error('no cell');
    if (detail !== 'blocked' || errors[0] !== 'blocked')
      h.repos.cells.setOutcome(e.id, last, 'discovery', 'fixture', {
        status: 'skipped',
        reason: 'provider_disabled',
      });
    // why: the other provider's rows never decide this one's word
    h.repos.cells.setOutcome(e.id, last, 'discovery', 'travelpayouts', {
      status: 'error',
      reason: 'quota',
      lastError: 'x',
    });
    expect(disabledDetailBefore(ctx, e.id).get('fixture')).toEqual({
      skip: 'provider_disabled',
      detail,
      until: null,
    });
    expect(disabledDetailBefore(ctx, e.id).has('travelpayouts')).toBe(false);
  });

  it('disabledDetailBefore: the first row that names a provider decides it; a skip for another reason names none', () => {
    const { h, ctx, e, cells } = seeded(['fixture']);
    const [a, b] = cells;
    if (a === undefined || b === undefined) throw new Error('no cells');
    h.repos.cells.setOutcome(e.id, a, 'discovery', 'fixture', { status: 'skipped', reason: 'budget' });
    expect(disabledDetailBefore(ctx, e.id)).toEqual(new Map());
    h.repos.cells.setOutcome(e.id, b, 'discovery', 'fixture', {
      status: 'error',
      reason: 'blocked',
      lastError: 'x',
    });
    expect(disabledDetailBefore(ctx, e.id).get('fixture')).toEqual({
      skip: 'provider_disabled',
      detail: 'blocked',
      until: null,
    });
  });

  it('searchedDatePairsOf reads a cell the run never seeded as not run', () => {
    const h = createHarness();
    const def = h.createDefinition({
      origins: [LHR],
      destinations: [JFK],
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-02') },
      minNights: 7,
      maxNights: 7,
    });
    const ctx = buildContext(h.deps, h.options);
    const b = buildSnapshot(ctx, def, 'manual');
    const e = h.repos.executions.create({
      definitionId: def.id,
      isChild: false,
      cell: null,
      snapshot: b.snapshot,
      estimate: null,
      trigger: 'manual',
      status: 'running',
    });
    expect(searchedDatePairsOf(ctx, e)).toBe(0);
  });
});

describe('stopCauseOf edges (mutation pins)', () => {
  it("isBrowserPageLimit: the browser worker's run and month caps only", () => {
    expect(isBrowserPageLimit({ scope: 'provider-execution', providerId: 'camoufox' })).toBe(true);
    expect(isBrowserPageLimit({ scope: 'provider-month', providerId: 'camoufox' })).toBe(true);
    expect(isBrowserPageLimit({ scope: 'execution-calls', providerId: 'camoufox' })).toBe(false);
    expect(isBrowserPageLimit({ scope: 'provider-execution', providerId: 'searchapi' })).toBe(false);
  });

  it("flights never ride on another provider's per-run cap", () => {
    const run = causeRun({ flightLists: { read: 1, planned: 2 } });
    expect(stopCauseOf(budget('provider-execution', 'searchapi'), run, true)).toMatchObject({
      flights: null,
    });
  });

  it('all-disabled names only the disabled sources of its own stage (R4), and words a disabled source with no detail', () => {
    const run = causeRun({
      // why: camoufox is discovery-only here, so a verification stop must never name it
      disabledDetail: new Map([
        ['camoufox', { skip: 'provider_disabled', detail: 'captcha', until: null }],
        ['fixture', { skip: 'provider_disabled', detail: 'auth', until: null }],
      ]),
      // why: searchapi verifies too but is not disabled, so it is never named
      disabled: new Set<ProviderId>(['travelpayouts', 'camoufox']),
      disabledReason: new Map(),
      snapshot: {
        providers: {
          discovery: ['camoufox', 'searchapi'],
          verification: ['travelpayouts', 'searchapi', 'fixture'],
          discoveryRefreshHours: {},
        },
      },
    });
    const c = stopCauseOf({ kind: 'all-disabled', stage: 'verification' }, run, true);
    expect(c).toEqual({
      kind: 'sources-unavailable',
      stage: 'verification',
      searched: 0,
      sources: [
        { providerId: 'travelpayouts', skip: 'provider_disabled', detail: 'blocked', until: null },
        { providerId: 'fixture', skip: 'provider_disabled', detail: 'auth', until: null },
      ],
    });
  });
});
