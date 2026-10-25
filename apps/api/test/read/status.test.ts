// The Status report's check builders (spec §10 `GET /status`, brief WP18 §6 and Task 18.2): table-driven, one case per
// row and state of the table, over injected facts. The worked example only.
import { apiContract, asIsoDateTime, findBannedWords, START_REFUSAL_REASONS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildChecks, buildStatus, STATUS_TEXT } from '../../src/read/status.js';
import type { ProviderFacts, StatusFacts, WorkerFacts } from '../../src/read/statusFacts.js';
import {
  ago,
  DAY,
  HOUR,
  healthyData,
  healthyFacts,
  healthyWorker,
  inFuture,
  NOW,
  observed,
  okWorkerStatus,
  searchApi,
  travelpayouts,
} from '../helpers/statusFacts.js';

const { barSummary } = apiContract;
type State = 'ok' | 'warn' | 'fail' | 'off';
interface Case {
  /** The table row. */
  row: string;
  state: State;
  /** The check's id. */
  id: string;
  facts: StatusFacts;
  has?: string[];
}
const withWorker = (w: WorkerFacts, over: Partial<StatusFacts> = {}) => healthyFacts({ worker: w, ...over });
const down = (refusal: WorkerFacts['refusal'] = { kind: 'none' }) =>
  healthyWorker({ read: { kind: 'unreachable' }, refusal });
const at = (ms: number) => ago(ms);

/** The rows and states of brief WP18 §6; the case count test compares CASES against it. */
const TABLE: Record<string, State[]> = {
  app: ['ok', 'warn', 'fail'],
  database: ['ok', 'warn', 'fail'],
  backups: ['ok', 'warn', 'fail', 'off'],
  schedule: ['ok', 'warn', 'fail', 'off'],
  data: ['ok', 'warn', 'off'],
  'price-sources': ['ok', 'warn'],
  provider: ['ok', 'warn', 'fail', 'off'],
  'provider-fixture': ['warn'],
  worker: ['ok', 'warn', 'fail', 'off'],
  consent: ['ok', 'warn', 'fail', 'off'],
  email: ['ok', 'fail', 'off'],
};

const CASES: Case[] = [
  {
    row: 'app',
    state: 'ok',
    id: 'app',
    facts: healthyFacts(),
    has: ['version abc1234', 'native mode', 'sign-in on'],
  },
  {
    row: 'app',
    state: 'warn',
    id: 'app',
    facts: healthyFacts({ app: { ...healthyFacts().app, loopback: false } }),
    has: ['plain HTTP beyond this machine needs TLS or Tailscale: docs/setup.md section 3'],
  },
  {
    row: 'app',
    state: 'fail',
    id: 'app',
    facts: healthyFacts({ app: { ...healthyFacts().app, authOn: false } }),
  },
  { row: 'database', state: 'ok', id: 'database', facts: healthyFacts(), has: ['5.0 MB'] },
  {
    row: 'database',
    state: 'warn',
    id: 'database',
    facts: healthyFacts({ database: { answers: true, sizeBytes: 1, pendingMigrations: 2 } }),
    has: ['2 migrations are pending'],
  },
  {
    row: 'database',
    state: 'fail',
    id: 'database',
    facts: healthyFacts({ database: { answers: false, sizeBytes: 0, pendingMigrations: 0 } }),
  },
  { row: 'backups', state: 'ok', id: 'backups', facts: healthyFacts() },
  {
    row: 'backups',
    state: 'ok',
    id: 'backups',
    facts: healthyFacts({ backupNewestAt: null, app: { ...healthyFacts().app, startedAt: at(HOUR) } }),
    has: ['first daily backup due 03:30; pnpm gmt backup takes one now'],
  },
  { row: 'backups', state: 'warn', id: 'backups', facts: healthyFacts({ backupNewestAt: at(40 * HOUR) }) },
  { row: 'backups', state: 'fail', id: 'backups', facts: healthyFacts({ backupNewestAt: null }) },
  {
    row: 'backups',
    state: 'off',
    id: 'backups',
    facts: healthyFacts({ mode: 'container', backupNewestAt: null }),
    has: ["not visible from the container: check your host's backup job (docs/setup.md section 6)"],
  },
  { row: 'schedule', state: 'ok', id: 'schedule', facts: healthyFacts(), has: ['1 job registered'] },
  {
    row: 'schedule',
    state: 'warn',
    id: 'schedule',
    facts: healthyFacts({
      schedule: {
        ...healthyFacts().schedule,
        clashes: [{ a: 'North', b: 'South', at: asIsoDateTime('2026-10-15T02:30:00.000Z') }],
      },
    }),
    has: ["North and South both fire at 03:30; stagger them so neither waits for the other's browser pages"],
  },
  {
    row: 'schedule',
    state: 'fail',
    id: 'schedule',
    facts: healthyFacts({ schedule: { ...healthyFacts().schedule, degraded: true } }),
  },
  {
    row: 'schedule',
    state: 'fail',
    id: 'schedule',
    facts: healthyFacts({ schedule: { ...healthyFacts().schedule, blockedSince: at(2 * DAY) } }),
    has: ['schedule blocked since 2026-10-12'],
  },
  {
    row: 'schedule',
    state: 'off',
    id: 'schedule',
    facts: healthyFacts({ schedule: { ...healthyFacts().schedule, scheduledDefinitions: 0, jobCount: 0 } }),
  },
  { row: 'data', state: 'ok', id: 'data-def-1', facts: healthyFacts() },
  {
    row: 'data',
    state: 'warn',
    id: 'data-def-1',
    facts: healthyFacts({
      data: [
        healthyData({
          coverage: {
            buckets: { priced: 588, empty: 0, no_data: 0, error: 100, skipped: 112, not_run: 200, reused: 0 },
            total: 1000,
          },
        }),
      ],
    }),
    has: ['not searched 200 of 1000 cells'],
  },
  { row: 'data', state: 'off', id: 'data', facts: healthyFacts({ data: [] }) },
  { row: 'price-sources', state: 'ok', id: 'price-sources', facts: healthyFacts() },
  {
    row: 'price-sources',
    state: 'warn',
    id: 'price-sources',
    facts: healthyFacts({ priceSources: { usable: [] } }),
    has: ['No price source is set up, so searches find nothing'],
  },
  { row: 'provider', state: 'ok', id: 'provider-travelpayouts', facts: healthyFacts() },
  {
    row: 'provider',
    state: 'warn',
    id: 'provider-travelpayouts',
    facts: healthyFacts({
      providers: [travelpayouts({ usage: { used: 40_000, cap: 50_000, window: 'month' } }), searchApi()],
    }),
    has: ['80% of its cap used', 'this month: 40000 of 50000 calls'],
  },
  {
    row: 'provider',
    state: 'fail',
    id: 'provider-travelpayouts',
    facts: healthyFacts({
      providers: [travelpayouts({ lastCall: { at: at(HOUR), result: 'auth' } }), searchApi()],
    }),
  },
  { row: 'provider', state: 'off', id: 'provider-searchapi', facts: healthyFacts() },
  {
    row: 'provider-fixture',
    state: 'warn',
    id: 'provider-fixture',
    facts: healthyFacts({ synthetic: true }),
    has: ['synthetic test data, not fares'],
  },
  { row: 'worker', state: 'ok', id: 'worker', facts: healthyFacts() },
  {
    row: 'worker',
    state: 'warn',
    id: 'worker',
    facts: withWorker(
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({ coolingDownUntil: inFuture(30 * HOUR), cooldownCause: 'captcha' }),
        },
      }),
    ),
    has: ['cooling down until'],
  },
  {
    row: 'worker',
    state: 'fail',
    id: 'worker',
    facts: withWorker(down()),
    has: ['not answering'],
  },
  {
    row: 'worker',
    state: 'off',
    id: 'worker',
    facts: withWorker(healthyWorker({ read: { kind: 'disabled' } })),
    has: ['browser provider not enabled'],
  },
  {
    row: 'consent',
    state: 'ok',
    id: 'consent',
    facts: healthyFacts(),
    has: ['consent rejected, expires', '(capture)'],
  },
  {
    row: 'consent',
    state: 'warn',
    id: 'consent',
    facts: withWorker(
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({
            consent: { kind: 'socs', expiresAt: inFuture(10 * DAY), boundedBy: 'cookie' },
          }),
        },
      }),
    ),
    has: ['(cookie)', 'under 30 days left'],
  },
  {
    row: 'consent',
    state: 'fail',
    id: 'consent',
    facts: withWorker(
      healthyWorker({
        read: {
          kind: 'ok',
          status: okWorkerStatus({ consent: { kind: 'voided', expiresAt: null, boundedBy: null } }),
        },
      }),
    ),
    has: ['consent screen now shown: capture again'],
  },
  {
    row: 'consent',
    state: 'off',
    id: 'consent',
    facts: withWorker(healthyWorker({ read: { kind: 'disabled' } })),
  },
  { row: 'email', state: 'ok', id: 'email', facts: healthyFacts() },
  {
    row: 'email',
    state: 'fail',
    id: 'email',
    facts: healthyFacts({ email: { configured: true, last: { at: at(HOUR), result: 'failed' } } }),
  },
  {
    row: 'email',
    state: 'off',
    id: 'email',
    facts: healthyFacts({ email: { configured: false, last: null } }),
  },
];

const checkOf = (f: StatusFacts, id: string) => {
  const c = buildChecks(f).find((x) => x.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
};

describe('the checks table (brief WP18 §6)', () => {
  it('has a case for every row and state of the table', () => {
    const covered = new Set(CASES.map((c) => `${c.row}:${c.state}`));
    const wanted = Object.entries(TABLE).flatMap(([row, states]) => states.map((s) => `${row}:${s}`));
    expect(wanted.filter((w) => !covered.has(w))).toEqual([]);
    expect(CASES.length).toBeGreaterThanOrEqual(wanted.length);
  });

  it.each(CASES.map((c, i) => [`${c.row} ${c.state} #${i}`, c] as const))('%s', (_n, c) => {
    const check = checkOf(c.facts, c.id);
    expect(check.state).toBe(c.state);
    for (const text of c.has ?? []) expect(`${check.summary} | ${check.note ?? ''}`).toContain(text);
    expect(apiContract.statusCheckSchema.safeParse(check).success).toBe(true);
    if (c.state === 'off') expect(check.offReason).not.toBeNull();
    // the card, the bar and the report agree: the bar counts exactly the fail and warn cards
    const all = buildChecks(c.facts);
    const bar = barSummary(all);
    const fails = all.filter((x) => x.state === 'fail').length;
    const warns = all.filter((x) => x.state === 'warn').length;
    expect(bar.kind).toBe(fails > 0 ? 'fail' : warns > 0 ? 'warn' : 'clean');
    // a card that is not ok shows its fix; an ok card needs none
    if (c.state === 'warn' || c.state === 'fail') {
      expect(check.fix, `${check.id} has no fix`).not.toBeNull();
    }
  });

  it('every id is unique and the report is sorted worst first', () => {
    const f = healthyFacts({ database: { answers: false, sizeBytes: 0, pendingMigrations: 0 } });
    const checks = buildChecks(f);
    expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
    expect(checks[0]?.id).toBe('database');
    expect(buildStatus(f)).toMatchObject({ mode: 'native', version: 'abc1234', generatedAt: NOW });
    expect(apiContract.statusResponseSchema.safeParse(buildStatus(f)).success).toBe(true);
  });
});

describe('agreement of the card and the bar', () => {
  it('a degraded app is a fail on schedule and the bar says so; a clean install leaves the bar clean', () => {
    const f = healthyFacts({ schedule: { ...healthyFacts().schedule, degraded: true } });
    expect(checkOf(f, 'schedule').state).toBe('fail');
    expect(barSummary(buildChecks(f)).text).toBe('Status: schedule failing');
    expect(barSummary(buildChecks(healthyFacts())).kind).toBe('clean');
  });
  it('a fresh install with its first backup present is ok with no due note; a recent catch-up is ok with a note and a clean bar', () => {
    const f = healthyFacts({
      backupNewestAt: at(HOUR),
      app: { ...healthyFacts().app, startedAt: at(HOUR) },
      schedule: {
        ...healthyFacts().schedule,
        catchUp: { scheduledFor: at(8 * HOUR), ranAt: at(2 * HOUR) },
      },
    });
    expect(checkOf(f, 'backups')).toMatchObject({ state: 'ok', note: null });
    const s = checkOf(f, 'schedule');
    expect(s.state).toBe('ok');
    expect(s.note).toMatch(/^caught up the run missed at 2026-10-14 \d\d:\d\d, ran 2026-10-14 \d\d:\d\d$/);
    expect(barSummary(buildChecks(f)).kind).toBe('clean');
  });
});

describe('boundaries', () => {
  it('backups: 36 h − 1 ms ok, 36 h warn, no backup at an app age of exactly 36 h fail', () => {
    const state = (f: Partial<StatusFacts>) => checkOf(healthyFacts(f), 'backups').state;
    expect(state({ backupNewestAt: at(36 * HOUR - 1) })).toBe('ok');
    expect(state({ backupNewestAt: at(36 * HOUR) })).toBe('warn');
    expect(state({ backupNewestAt: null, app: { ...healthyFacts().app, startedAt: at(36 * HOUR) } })).toBe(
      'fail',
    );
    expect(
      state({ backupNewestAt: null, app: { ...healthyFacts().app, startedAt: at(36 * HOUR - 1) } }),
    ).toBe('ok');
  });

  it('consent: 30 × 86,400,000 ms − 1 ms warn, exactly that ok, now fail; either side of the London clock changes', () => {
    const consentAt = (nowText: string, left: number) => {
      const now = asIsoDateTime(nowText);
      const iso = asIsoDateTime(new Date(Date.parse(now) + left).toISOString());
      const f = healthyFacts({
        now,
        worker: healthyWorker({
          read: {
            kind: 'ok',
            status: okWorkerStatus({
              consent: { kind: 'socs', expiresAt: iso, boundedBy: 'capture' },
            }),
          },
        }),
      });
      return checkOf(f, 'consent').state;
    };
    for (const now of [
      '2027-03-27T12:00:00.000Z',
      '2027-03-29T12:00:00.000Z',
      '2027-10-30T12:00:00.000Z',
      '2027-11-01T12:00:00.000Z',
    ]) {
      expect(consentAt(now, 30 * 86_400_000 - 1)).toBe('warn');
      expect(consentAt(now, 30 * 86_400_000)).toBe('ok');
      expect(consentAt(now, 0)).toBe('fail');
    }
  });
});

describe('the data check', () => {
  const dataOf = (d: Partial<ReturnType<typeof healthyData>>, f: Partial<StatusFacts> = {}) =>
    checkOf(healthyFacts({ data: [healthyData(d)], ...f }), 'data-def-1');

  it('words the six buckets as core does and the parts sum to the cells', () => {
    const c = dataOf({});
    expect(c.summary).toBe(
      'London to New York: last run 2026-10-14: priced 90, no fares 5, no cached data 3, error 0, skipped 0, not searched 2 of 100 cells; newest price 1h old, oldest 30h old',
    );
  });
  it('R + S + U of 412 in 1,000 cells warns; 200 in 1,000 does not', () => {
    const cov = (error: number, skipped: number, not_run: number) => ({
      buckets: {
        priced: 1000 - error - skipped - not_run,
        empty: 0,
        no_data: 0,
        error,
        skipped,
        not_run,
        reused: 0,
      },
      total: 1000,
    });
    expect(dataOf({ coverage: cov(100, 112, 200) }).state).toBe('warn');
    expect(dataOf({ coverage: cov(100, 50, 50) }).state).toBe('ok');
  });
  it('names both ends of the ages and warns on the oldest past its threshold', () => {
    const c = dataOf({ ages: { newest: observed(1), oldest: observed(6 * 24), stale: true } });
    expect(c.summary).toContain('newest price 1h old, oldest 6d old');
    expect(c.state).toBe('warn');
    expect(dataOf({ ages: { newest: observed(1), oldest: observed(6 * 24), stale: false } }).state).toBe(
      'ok',
    );
  });
  it('prints "age unknown" for an unknown bound and "no prices yet" without a priced observation', () => {
    const unknown = dataOf({
      ages: { newest: observed(1), oldest: { kind: 'unknown', fetchedHours: 5 }, stale: false },
    });
    expect(unknown.summary).toContain('oldest age unknown');
    const none = dataOf({ ages: null });
    expect(none.summary).toContain('no prices yet');
    expect(none.state).toBe('warn');
  });
  it('a skipped latest row is warn with its reason and date, never ok at 0 of 0', () => {
    for (const status of ['skipped_missed', 'skipped_budget', 'skipped_confirm', 'skipped_window'] as const) {
      const c = dataOf({
        latest: { status, at: at(DAY), isCatchUp: false, skipCode: null },
        coverage: null,
        ages: null,
      });
      expect(c.state).toBe('warn');
      expect(c.summary).toContain('last firing skipped (');
      expect(c.summary).toContain('on 2026-10-13');
      expect(c.summary).not.toContain('0 of 0');
    }
  });
  it('states a missed firing by its stored skip code, whatever the settings are now', () => {
    const c = dataOf({
      latest: { status: 'skipped_missed', at: at(DAY), isCatchUp: false, skipCode: 'half-cadence' },
      coverage: null,
      ages: null,
    });
    expect(c.summary).toContain('the next scheduled run was less than half the gap away');
  });
  it('an active run shows "running since" beside the previous finished counts', () => {
    const c = dataOf({ runningSince: at(HOUR) });
    expect(c.summary).toContain('running since 2026-10-14 09:00');
    expect(c.summary).toContain('priced 90');
    const first = dataOf({ latest: null, coverage: null, ages: null, runningSince: at(HOUR) });
    expect(first.state).toBe('ok');
    expect(first.summary).toContain('no finished run yet');
    expect(dataOf({ latest: null, coverage: null, ages: null }).state).toBe('warn');
  });
  it('counts a catch-up and window left cells under skipped, with their detail words, and the reused suffix', () => {
    const c = dataOf({
      latest: { status: 'completed', at: at(HOUR), isCatchUp: true, skipCode: null },
      coverage: {
        buckets: { priced: 40, empty: 0, no_data: 0, error: 0, skipped: 60, not_run: 0, reused: 55 },
        total: 100,
      },
      leftNotes: [
        { text: 'left for the next scheduled run: a catch-up loads no browser pages', cells: 60 },
        { text: "left for your next run of this search: outside this run's browser window", cells: 1 },
      ],
    });
    expect(c.summary).toContain('skipped 60');
    expect(c.summary).toContain('(55 reused from earlier runs)');
    expect(c.note).toContain('left for the next scheduled run: a catch-up loads no browser pages (60 cells)');
    expect(c.note).toContain('(1 cell)');
    expect(dataOf({}).summary).not.toContain('reused');
  });
  it('a browser-only definition after a catch-up, or a browser-only skipped_missed, warns with that fix', () => {
    const catchUp = dataOf({
      browserOnlyScheduled: true,
      latest: { status: 'completed', at: at(HOUR), isCatchUp: true, skipCode: null },
    });
    expect(catchUp.state).toBe('warn');
    expect(catchUp.fix?.text).toBe(STATUS_TEXT.browserOnlyFix);
    const skipped = dataOf({
      browserOnlyScheduled: true,
      latest: {
        status: 'skipped_missed',
        at: at(HOUR),
        isCatchUp: false,
        skipCode: 'browser-only-definition',
      },
      coverage: null,
      ages: null,
    });
    expect(skipped.state).toBe('warn');
    expect(skipped.fix?.text).toBe(STATUS_TEXT.browserOnlyFix);
    expect(skipped.summary).toContain(
      'only the browser provider could run it, and a catch-up loads no browser pages',
    );
    expect(dataOf({ browserOnlyScheduled: true }).state).toBe('ok');
  });
  it('an unscheduled definition shows age without a cadence rule, and a scheduled one behind its schedule warns', () => {
    expect(
      dataOf({
        behindSchedule: false,
        latest: { status: 'completed', at: at(40 * DAY), isCatchUp: false, skipCode: null },
      }).state,
    ).toBe('ok');
    expect(dataOf({ behindSchedule: true }).state).toBe('warn');
  });
  it('a cancelled or paused run says so', () => {
    expect(
      dataOf({ latest: { status: 'paused_budget', at: at(HOUR), isCatchUp: false, skipCode: null } }).summary,
    ).toContain('last run 2026-10-14 (paused at a budget cap)');
  });
  it('one check per definition and an off check with none', () => {
    const f = healthyFacts({
      data: [healthyData(), healthyData({ definitionId: 'def-2', name: 'Second' })],
    });
    expect(
      buildChecks(f)
        .filter((c) => c.area === 'data')
        .map((c) => c.id),
    ).toEqual(['data-def-1', 'data-def-2']);
  });
});

describe('price sources', () => {
  it('a fixture-only or awaiting-verification browser setup leaves usable empty and warns with the Travelpayouts fix', () => {
    const c = checkOf(healthyFacts({ priceSources: { usable: [] } }), 'price-sources');
    expect(c.fix).toEqual({
      text: 'Travelpayouts is the no-cost source: add its token',
      command: 'pnpm gmt setup --reconfigure travelpayouts',
    });
    expect(
      checkOf(healthyFacts({ priceSources: { usable: ['Travelpayouts', 'SearchApi'] } }), 'price-sources')
        .summary,
    ).toBe('price sources: Travelpayouts and SearchApi');
  });
});

describe('consent', () => {
  const consentWith = (
    consent: ReturnType<typeof okWorkerStatus>['consent'],
    over: Partial<ReturnType<typeof okWorkerStatus>> = {},
  ) =>
    checkOf(
      withWorker(healthyWorker({ read: { kind: 'ok', status: okWorkerStatus({ consent, ...over }) } })),
      'consent',
    );
  it('a not-shown record is never labelled a rejection', () => {
    const c = consentWith({ kind: 'not-shown', expiresAt: inFuture(100 * DAY), boundedBy: 'check' });
    expect(c.state).toBe('ok');
    expect(c.summary).toMatch(/^no consent screen in this region, recorded \d{4}-\d\d-\d\d$/);
    expect(c.summary).not.toContain('rejected');
  });
  it('a captured record names the cookie or the capture as its bound', () => {
    expect(
      consentWith({ kind: 'socs', expiresAt: inFuture(100 * DAY), boundedBy: 'cookie' }).summary,
    ).toMatch(/^consent rejected, expires \d{4}-\d\d-\d\d \(cookie\)$/);
    expect(
      consentWith({ kind: 'socs', expiresAt: inFuture(100 * DAY), boundedBy: 'capture' }).summary,
    ).toContain('(capture)');
  });
  it('an expired record fails with the capture fix', () => {
    const c = consentWith({ kind: 'socs', expiresAt: at(DAY), boundedBy: 'cookie' });
    expect(c.state).toBe('fail');
    expect(c.fix).toEqual({ text: 'capture consent again', command: 'pnpm gmt consent' });
  });
  it('a worker that reports no consent record falls back to the capture time plus 13 months, or fails when it has none', () => {
    const fallback = consentWith(null, { socsCapturedAt: ago(10 * DAY) });
    expect(fallback.state).toBe('ok');
    expect(fallback.summary).toContain('(capture)');
    expect(consentWith(null, { socsCapturedAt: ago(500 * DAY) }).state).toBe('fail');
    expect(consentWith(null, { socsCapturedAt: null })).toMatchObject({
      state: 'fail',
      summary: 'no consent record: capture one',
    });
  });
  it('a worker that is down with no refusal file cannot be checked (warn); a consent refusal fails; awaiting verification is off', () => {
    expect(checkOf(withWorker(down()), 'consent')).toMatchObject({ state: 'warn' });
    for (const reason of ['consent-missing', 'consent-expired', 'consent-voided'] as const) {
      const c = checkOf(withWorker(down({ kind: 'refusal', reason, at: at(HOUR) })), 'consent');
      expect(c.state).toBe('fail');
      expect(c.fix?.command).toBe('pnpm gmt consent');
    }
    for (const reason of ['flags-unset', 'build-mismatch'] as const) {
      expect(checkOf(withWorker(down({ kind: 'refusal', reason, at: at(HOUR) })), 'consent')).toMatchObject({
        state: 'off',
        offReason: 'awaiting-verification',
      });
    }
  });
});

describe('the worker check', () => {
  const noteOf = (f: StatusFacts) => checkOf(f, 'worker').note;
  it('states the browser window on every state of the card while the provider is enabled', () => {
    for (const [setting, words] of [
      ['scheduled', "browser pages: only inside a run's window"],
      ['any', 'browser pages: also when a run resumes'],
    ] as const) {
      const ok = withWorker(healthyWorker({ browserWindow: setting }));
      const warn = withWorker(
        healthyWorker({
          browserWindow: setting,
          read: {
            kind: 'ok',
            status: okWorkerStatus({ coolingDownUntil: inFuture(HOUR), cooldownCause: 'captcha' }),
          },
        }),
      );
      const fail = withWorker({ ...down(), browserWindow: setting });
      const off = withWorker(
        healthyWorker({
          browserWindow: setting,
          read: { kind: 'ok', status: okWorkerStatus({ formVerified: false }) },
        }),
      );
      for (const f of [ok, warn, fail, off]) expect(noteOf(f)).toContain(words);
    }
  });
  it('maps each refusal reason through the shared words: flags-unset and build-mismatch are off, never fail', () => {
    for (const reason of START_REFUSAL_REASONS) {
      const c = checkOf(withWorker(down({ kind: 'refusal', reason, at: at(HOUR) })), 'worker');
      if (reason === 'flags-unset' || reason === 'build-mismatch') {
        expect(c).toMatchObject({ state: 'off', offReason: 'awaiting-verification' });
      } else {
        expect(c.state).toBe('fail');
        expect(c.summary).toContain('refused, not retrying: ');
      }
    }
  });
  it('flags unset in the worker status is off (awaiting verification), not fail', () => {
    const c = checkOf(
      withWorker(healthyWorker({ read: { kind: 'ok', status: okWorkerStatus({ formVerified: false }) } })),
      'worker',
    );
    expect(c).toMatchObject({ state: 'off', offReason: 'awaiting-verification' });
  });
  it('differing shared settings fail naming the settings, no values', () => {
    const c = checkOf(
      withWorker(
        healthyWorker({
          read: { kind: 'ok', status: okWorkerStatus({ diffs: ['CAMOUFOX_MODE', 'POINT_OF_SALE'] }) },
        }),
      ),
      'worker',
    );
    expect(c.state).toBe('fail');
    expect(c.summary).toContain('CAMOUFOX_MODE, POINT_OF_SALE');
  });
  it('keys that differ fail; an unreadable answer warns; the container cannot reach it', () => {
    expect(checkOf(withWorker(healthyWorker({ read: { kind: 'keys-differ' } })), 'worker').summary).toContain(
      'keys differ',
    );
    expect(checkOf(withWorker(healthyWorker({ read: { kind: 'unreadable' } })), 'worker').state).toBe('warn');
    const c = checkOf(withWorker(down(), { mode: 'container' }), 'worker');
    expect(c).toMatchObject({ state: 'fail', summary: 'not reachable from the container' });
    expect(c.fix?.command).toBeNull();
  });
  it('two app instances and a near monthly cap warn; this month shows n of cap', () => {
    const two = checkOf(
      withWorker(healthyWorker({ read: { kind: 'ok', status: okWorkerStatus({ appInstances: 2 }) } })),
      'worker',
    );
    expect(two.state).toBe('warn');
    const near = checkOf(
      withWorker(
        healthyWorker({
          read: {
            kind: 'ok',
            status: okWorkerStatus({ monthly: { pages: 1200, scrolls: 0, readable: true } }),
          },
        }),
      ),
      'worker',
    );
    expect(near.state).toBe('warn');
    expect(checkOf(healthyFacts(), 'worker').summary).toContain(
      'this month: pages 10 of 1500, scrolls 20 of 6000',
    );
    const unreadable = checkOf(
      withWorker(
        healthyWorker({
          read: {
            kind: 'ok',
            status: okWorkerStatus({ monthly: { pages: 0, scrolls: 0, readable: false } }),
          },
        }),
      ),
      'worker',
    );
    expect(unreadable.state).toBe('warn');
  });
  it('a status without the optional fields builds from what is present', () => {
    const c = checkOf(
      withWorker(
        healthyWorker({
          read: {
            kind: 'ok',
            status: okWorkerStatus({ appInstances: null, monthly: null, consent: null }),
          },
        }),
      ),
      'worker',
    );
    expect(c).toMatchObject({ state: 'ok', summary: 'reachable' });
  });
  it('a refusal older than the newest consent record is shown superseded once the worker answers', () => {
    const c = checkOf(
      withWorker(
        healthyWorker({ refusal: { kind: 'refusal', reason: 'consent-expired', at: ago(40 * DAY) } }),
      ),
      'worker',
    );
    expect(c.state).toBe('ok');
    expect(c.note).toContain('superseded');
  });
  it('an unreadable refusal file is said, not shown', () => {
    const c = checkOf(withWorker(down({ kind: 'unreadable' })), 'worker');
    expect(c.summary).toBe('not answering, and its refusal file is unreadable');
  });
});

describe('providers', () => {
  const tpCheck = (p: Partial<ProviderFacts>) =>
    checkOf(healthyFacts({ providers: [travelpayouts(p), searchApi()] }), 'provider-travelpayouts');
  const saCheck = (p: Partial<ProviderFacts>) =>
    checkOf(
      healthyFacts({ providers: [travelpayouts(), searchApi({ configured: true, ...p })] }),
      'provider-searchapi',
    );
  it('an auth or quota failure of the newest call fails; a success after one is ok with its time', () => {
    expect(tpCheck({ lastCall: { at: ago(HOUR), result: 'auth' } }).state).toBe('fail');
    expect(tpCheck({ lastCall: { at: ago(HOUR), result: 'quota' } }).state).toBe('fail');
    const ok = tpCheck({ lastCall: { at: ago(HOUR), result: 'ok' } });
    expect(ok.state).toBe('ok');
    expect(ok.summary).toContain('last successful call 2026-10-14 09:00');
  });
  it('never called is "configured; not used yet"; another failure warns', () => {
    expect(tpCheck({ lastCall: null }).summary).toContain('configured; not used yet');
    expect(tpCheck({ lastCall: { at: ago(HOUR), result: 'other' } }).state).toBe('warn');
  });
  it('the trial warns at 10 credits left and words its lifetime usage as the Providers view does', () => {
    const usage = { used: 90, cap: 100, window: 'lifetime' as const };
    expect(saCheck({ usage, trialLeft: 10 }).state).toBe('warn');
    expect(saCheck({ usage, trialLeft: 10 }).summary).toContain('10 trial credits left');
    expect(saCheck({ usage: { used: 1, cap: 1, window: 'lifetime' }, trialLeft: 1 }).summary).toContain(
      '1 trial credit left',
    );
    const ok = saCheck({ usage: { used: 7, cap: 24, window: 'lifetime' }, trialLeft: 11 });
    expect(ok.state).toBe('ok');
    expect(ok.summary).toContain("7 of 24 calls over the plan's lifetime");
  });
  it('an unconfigured provider is off and names its setup command', () => {
    const off = checkOf(healthyFacts(), 'provider-searchapi');
    expect(off).toMatchObject({ state: 'off', offReason: 'not-set-up' });
    expect(off.fix?.command).toBe('pnpm gmt setup --reconfigure searchapi');
  });
  it('a usage without a cap says so and does not warn', () => {
    const c = tpCheck({ usage: { used: 5, cap: null, window: 'month' } });
    expect(c.state).toBe('ok');
    expect(c.summary).toContain('this month: 5 calls, no cap');
  });
});

describe('email', () => {
  it('words the last test send by class only', () => {
    expect(checkOf(healthyFacts(), 'email').summary).toBe('configured; no test send since the app started');
    expect(
      checkOf(healthyFacts({ email: { configured: true, last: { at: ago(HOUR), result: 'sent' } } }), 'email')
        .summary,
    ).toContain('the last test send was sent at');
    expect(
      checkOf(
        healthyFacts({ email: { configured: true, last: { at: ago(HOUR), result: 'refused' } } }),
        'email',
      ),
    ).toMatchObject({ state: 'ok' });
    expect(checkOf(healthyFacts({ email: { configured: false, last: null } }), 'email').fix?.command).toBe(
      'pnpm gmt setup --reconfigure email',
    );
  });
});

describe('container and dev mode', () => {
  it('no check carries a command; the fix text names the docs section', () => {
    for (const mode of ['container', 'dev'] as const) {
      const f = healthyFacts({
        mode,
        database: { answers: false, sizeBytes: 0, pendingMigrations: 0 },
        worker: down(),
        email: { configured: false, last: null },
        priceSources: { usable: [] },
      });
      const checks = buildChecks(f);
      expect(checks.every((c) => c.fix === null || c.fix.command === null)).toBe(true);
      const db = checks.find((c) => c.id === 'database');
      expect(db?.fix?.text).toContain('docs/setup.md section 11');
    }
  });
  it('native mode carries commands', () => {
    const f = healthyFacts({ database: { answers: false, sizeBytes: 0, pendingMigrations: 0 } });
    expect(checkOf(f, 'database').fix?.command).toBe('pnpm gmt restart');
  });
});

describe('words', () => {
  it('no summary, note or fix text uses a banned word, "fresh", "complete" or "all"', () => {
    const variants: StatusFacts[] = [
      ...CASES.map((c) => c.facts),
      healthyFacts({ mode: 'container' }),
      healthyFacts({ synthetic: true, data: [healthyData({ ages: null })] }),
    ];
    const forbidden = /\b(fresh|complete|all)\b/i;
    for (const f of variants)
      for (const c of buildChecks(f)) {
        const text = [c.summary, c.note ?? '', c.fix?.text ?? ''].join(' | ');
        expect(findBannedWords(text), text).toEqual([]);
        expect(text, text).not.toMatch(forbidden);
        expect(text, text).not.toMatch(/\bprices up to\b/);
      }
  });
});
