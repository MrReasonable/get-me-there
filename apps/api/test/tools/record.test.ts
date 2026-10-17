import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbortedError, asIsoDate, asIsoDateTime, BudgetExceeded, fixedClock, ProviderError } from '@gmt/core';
import type { RecordedFixture } from '@gmt/providers';
import { loadParamsAllowlist } from '@gmt/providers';
import { loadRecorded, verifyRecordedTree } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { failureOf, recordFixtures } from '../../src/tools/record.js';
import { assessRun } from '../../src/tools/recordReport.js';
import { cheapestCalendarCell, cheapestOption } from '../../src/tools/recordRequests.js';
import { priorToolCredits } from '../../src/tools/toolExecution.js';
import { RecordingFailedError } from '../../src/tools/types.js';
import { SENTINEL_SA, SENTINEL_TP } from '../helpers/env.js';
import {
  AT,
  recordingSetup,
  runRecording,
  runRecordingInFakeTime,
  seededPorts,
  TEST_RECORDED_BY,
  WORKED_EXAMPLE,
} from '../helpers/recording.js';
import { filesUnder, tempDir } from '../helpers/tmp.js';
import { BT, DT, STANDIN_MARKER, stubVendors } from '../helpers/vendors.js';

function recordings(root: string): RecordedFixture[] {
  return [
    ...loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'),
    ...loadRecorded(root, 'searchapi', '/api/v1/search'),
  ];
}
const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);
const statuses = (calls: ReadonlyArray<{ id: string; status: unknown }>): string[] =>
  calls.map((c) => `${c.id}:${String(c.status)}`);
const RECT = {
  outFrom: asIsoDate('2027-03-01'),
  outTo: asIsoDate('2027-03-09'),
  retFrom: asIsoDate('2027-03-11'),
  retTo: asIsoDate('2027-03-30'),
  combinations: 180,
};
const BAND = { minNights: 10, maxNights: 21 };

describe('response readers (ts-005, pie-006, prov-wp04b-r2-002)', () => {
  it('cheapestOption takes the cheapest priced option across best_flights and other_flights, skipping unpriced ones', () => {
    const body = {
      best_flights: [{ departure_token: 'unpriced' }, { price: 655, departure_token: 'dearer' }],
      other_flights: [{ price: 603, departure_token: 'cheapest' }],
    };
    expect(cheapestOption(body, 'departure_token')).toEqual({ token: 'cheapest', price: 603 });
    expect(cheapestOption({ best_flights: [{ departure_token: 'x' }] }, 'departure_token')).toBeNull();
  });
  it('cheapestCalendarCell skips has_no_flights cells that carry a price, out-of-band cells and cells outside the rectangle', () => {
    const body = {
      calendar: [
        { departure: '2027-03-01', return: '2027-03-29', price: 380 },
        { departure: '2027-03-04', return: '2027-03-16', has_no_flights: true, price: 390 },
        { departure: '2027-03-10', return: '2027-03-31', price: 400 },
        { departure: '2027-03-02', return: '2027-03-16', price: 603 },
        { departure: 'not-a-date', return: '2027-03-16', price: 1 },
      ],
    };
    expect(cheapestCalendarCell(body, BAND, RECT)).toEqual({
      departure: '2027-03-02',
      return: '2027-03-16',
      price: 603,
    });
    expect(cheapestCalendarCell({ calendar: [] }, BAND, RECT)).toBeNull();
  });
});

describe('failureOf: how a failed request is reported (cost-wp4b-r2-003, cost M-2)', () => {
  const pe = (kind: ProviderError['kind'], code: string, httpStatus?: number): ProviderError =>
    new ProviderError({
      kind,
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi /api/v1/search: detail [${code}]`,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  it.each([
    [pe('rate-limit', 'http-429', 429), { status: 429, detail: 'rate-limit' }],
    [pe('limiter-timeout', 'retry-after-exceeds-max-wait', 429), { status: 429, detail: 'limiter-timeout' }],
    [
      pe('limiter-timeout', 'queue-wait-exceeded'),
      { status: 'skipped', detail: 'rate-limit slot not granted within MAX_WAIT_SECONDS; nothing sent' },
    ],
    [pe('network', 'timeout'), { status: 'no-response', detail: 'timeout (ledgered unknown, counted)' }],
    [
      pe('network', 'socket'),
      {
        status: 'no-response',
        detail:
          'network (ledgered error, NOT counted: if the dashboard drop exceeds the ledger, this call is why)',
      },
    ],
    [
      pe('upstream', 'redirect-refused'),
      {
        status: 'no-response',
        detail: 'upstream without an HTTP status (redirect-refused); see its ledger row',
      },
    ],
    [
      new BudgetExceeded({ scope: 'execution-calls', cap: 5, current: 5, requested: 1 }),
      { status: 'skipped', detail: 'refused by the guard: execution-calls' },
    ],
    [
      new AbortedError(),
      { status: 'aborted', detail: 'aborted (an attempt already sent is ledgered unknown, counted)' },
    ],
  ] as const)('%s', (e, want) => {
    expect(failureOf(e)).toEqual(want);
  });
  it('anything else is not a request result (it propagates)', () => {
    expect(failureOf(new Error('recorder refused'))).toBeNull();
  });
});

describe('recordFixtures against the vendor stand-ins (spec §9 item 7, §5.3 Recorder)', () => {
  it('issues the planned calls, follows the token chain and records every response', async () => {
    const run = await runRecording();
    const { summary, seen, plan, root } = run;
    expect(assessRun(plan, summary)).toEqual({
      requiredOk: true,
      notAsExpected: [],
      chainComplete: true,
      emptyEnvelope: 'yes',
      overLimit: 'http-400',
    });
    expect(statuses(summary.calls)).toEqual([
      ...Array.from({ length: 19 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}:200`),
      'TP-20:401',
      'TP-21:200',
      'SA-01:401',
      'SA-02:200',
      'SA-03:400',
      'SA-04:200',
      'SA-05:200',
      'SA-06:200',
    ]);
    for (const c of summary.calls) expect(c.files, c.id).toHaveLength(1);
    expect(summary.creditsUsed).toBe(4); // SA-02, 04, 05, 06: 200s count, 401 and 400 do not (spec §2 fact 4)
    expect(summary.freeCalls).toBe(21);
    expect(summary.chain).toEqual({
      currency: 'GBP',
      step1PricePence: 60300,
      step2PricePence: 60300,
      step3Options: [
        { bookWith: 'OTA', pricePence: 57300 },
        { bookWith: 'Airline', pricePence: 60300 },
      ],
    });

    // step 1 used the cheapest priced in-band cell; steps 2 and 3 carried the cheapest priced tokens
    const flights = seen.sa.filter(
      (p) => p.get('engine') === 'google_flights' && p.get('outbound_date') === '2027-03-02',
    );
    expect(
      flights.map((p) => [p.get('return_date'), p.get('departure_token'), p.get('booking_token')]),
    ).toEqual([
      ['2027-03-16', null, null],
      ['2027-03-16', DT.cheapest, null],
      ['2027-03-16', null, BT.cheapest],
    ]);
    for (const p of seen.sa)
      expect([p.get('api_key'), p.get('travel_class'), p.get('gl')]).toEqual([null, 'economy', 'gb']);
    for (const p of seen.tp) expect(p.get('token')).toBeNull();

    // the recorded tree: WP4's verifier finds nothing, one session, the test signature, no credential anywhere
    expect(verifyRecordedTree(root, run.ports.secrets)).toEqual([]);
    const files = recordings(root);
    expect(files).toHaveLength(27);
    expect(new Set(files.map((f) => f.session)).size).toBe(1);
    expect(summary.session).toBe(files[0]?.session);
    for (const f of files) {
      expect(f.recordedBy).toBe(TEST_RECORDED_BY);
      for (const p of Object.keys(f.placeholders))
        expect(p).toMatch(new RegExp(`^<[a-z_]+:\\d+@${f.session}>$`));
    }
    for (const path of filesUnder(root)) {
      const text = readFileSync(path, 'utf8');
      expect(text).not.toContain(SENTINEL_SA);
      expect(text).not.toContain(SENTINEL_TP);
      expect(text).not.toMatch(/X-Access-Token|api_key=|Bearer /i);
    }
    // search_metadata keeps its URL keys with query and userinfo stripped (WP4 stripMetadataUrls)
    const calendar = files.find((f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200);
    expect(JSON.stringify(calendar?.body)).toContain(
      '"request_url":"https://www.searchapi.io/api/v1/search"',
    );
    expect(JSON.stringify(calendar?.body)).toContain(
      `"json_endpoint":"https://www.searchapi.io/api/v1/searches/${STANDIN_MARKER}-cal-1.json"`,
    );
  });

  it('the execution is hidden and carries the approved plan: soft-deleted definition, trigger tool, completed, caps and estimate', async () => {
    const run = await runRecording();
    const rows = run.ports.db.raw
      .prepare(
        `SELECT e.status, e.trigger, e.error_text AS errorText,
                json_extract(e.definition_snapshot_json, '$.budget') AS budget, json_extract(e.definition_snapshot_json, '$.deletedAt') AS snapDeleted,
                json_extract(e.estimate_json, '$.totalPlanCalls') AS planCalls,
                json_extract(e.estimate_json, '$.perProvider[1].planCalls') AS saPlanCalls,
                json_extract(e.estimate_json, '$.perProvider[1].calls') AS saCalls,
                d.deleted_at AS deletedAt, d.enabled,
                (SELECT COUNT(*) FROM search_cells c WHERE c.execution_id = e.id) AS cells
         FROM search_executions e JOIN search_definitions d ON d.id = e.definition_id`,
      )
      .all();
    expect(rows).toEqual([
      {
        status: 'completed',
        trigger: 'tool',
        errorText: null,
        budget: JSON.stringify({ maxCalls: 5, maxFreeCalls: 2000, maxCostMicroGbp: 0 }),
        snapDeleted: expect.any(String),
        // why: plan-call figures count every planned first attempt, so parity with the ledger holds (cost M-1): 21 + 6
        planCalls: 27,
        saPlanCalls: 6,
        saCalls: 5,
        deletedAt: expect.any(String),
        enabled: 0,
        cells: 0,
      },
    ]);
  });

  it('the real SqliteBudgetGuard stops the run at the budget before the vendor is hit; the allowlist names only parameters sent (ts-004, prov-wp04b-r2-003)', async () => {
    const run = await runRecording({ args: { ...WORKED_EXAMPLE, budget: 2 } });
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(statuses(sa)).toEqual([
      'SA-01:401',
      'SA-02:200',
      'SA-03:400',
      'SA-04:200',
      'SA-05:skipped',
      'SA-06:skipped',
    ]);
    expect(sa.find((c) => c.id === 'SA-05')?.detail).toBe('refused by the guard: execution-calls');
    expect(sa.find((c) => c.id === 'SA-06')?.detail).toContain('chain prerequisite missing');
    expect(run.seen.sa).toHaveLength(4);
    expect(run.seen.sa.some((p) => p.get('departure_token') !== null)).toBe(false);
    expect(
      run.ports.db.raw
        .prepare(`SELECT COUNT(*) AS n FROM provider_requests WHERE provider_id = 'searchapi'`)
        .get(),
    ).toEqual({ n: 4 });
    expect(run.summary.creditsUsed).toBe(2);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: ['SA-05', 'SA-06'],
    });
    expect(run.ports.db.raw.prepare('SELECT error_text AS e FROM search_executions').get()).toEqual({
      e: 'required calls not as expected: SA-05, SA-06; chain incomplete; 1 call(s) refused by the guard',
    });
    const allow = loadParamsAllowlist(join(run.root, 'searchapi', 'params-2026-10-20.json'), run.root);
    expect(allow.endpoints['/api/v1/search?engine=google_flights']?.names).not.toContain('departure_token');
  });

  it('pages a Travelpayouts tile while a page holds 1000 rows, and stops at the page cap (ts-006, cost-wp4b-r2-002)', async () => {
    const lonJfk = (p: URLSearchParams): boolean =>
      p.get('origin') === 'LON' && p.get('destination') === 'JFK';
    const run = await runRecording({
      vendors: {
        tpRows: (p) =>
          lonJfk(p) && p.get('departure_at') === '2027-03'
            ? p.get('page') === '1'
              ? 1000
              : 3
            : lonJfk(p) && p.get('departure_at') === '2027-04'
              ? 1000
              : 1,
      },
    });
    expect(statuses(run.summary.calls.slice(0, 7))).toEqual([
      'TP-01:200',
      'TP-01p2:200',
      'TP-02:200',
      'TP-03:200',
      'TP-03p2:200',
      'TP-03p3:200',
      'TP-04:200',
    ]);
    expect(run.summary.calls[5]?.detail).toBe('page cap reached (3 pages of 1000 rows)');
    expect(run.summary.freeCalls).toBe(24);
  });

  it('the Travelpayouts month cap stops a run mid-way with the guard, before the vendor (r2-ts-004)', async () => {
    const run = await runRecording({ env: { TRAVELPAYOUTS_MONTHLY_CALL_CAP: '18' } });
    expect(statuses(run.summary.calls.slice(17, 20))).toEqual([
      'TP-18:200',
      'TP-19:skipped',
      'TP-20:skipped',
    ]);
    expect(run.summary.calls[18]?.detail).toBe('refused by the guard: provider-month');
    expect(run.seen.tp).toHaveLength(18);
    // why: TP-19 never reached the vendor, so nothing is said about its envelope (prov-wp04b-r3-002)
    expect(assessRun(run.plan, run.summary).emptyEnvelope).toBe('no-answer');
  });

  it('a calendar with no priced in-band cell skips SA-03 and the chain: nothing more is spent (ts-006, cost-wp4b-r2-004)', async () => {
    const run = await runRecording({ vendors: { calendar: 'no-priced-cell' } });
    const byId = new Map(run.summary.calls.map((c) => [c.id, c]));
    expect(byId.get('SA-03')?.detail).toBe(
      'skipped: calendar SA-02 gave no usable cell; the run must be repeated',
    );
    for (const id of ['SA-03', 'SA-04', 'SA-05', 'SA-06']) expect(byId.get(id)?.status).toBe('skipped');
    expect(run.seen.sa.map((p) => p.get('engine'))).toEqual(['google_flights', 'google_flights_calendar']); // the 401 probe, then SA-02
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      chainComplete: false,
      overLimit: 'no-answer',
      notAsExpected: ['SA-03', 'SA-04', 'SA-05', 'SA-06'],
    });
  });

  it('a required call not as planned before the first billed SearchApi call skips SA-02…SA-06: nothing is spent on a run that must be repeated (cost I-1, plan decision 30)', async () => {
    // why: a stale Travelpayouts token makes every tile answer 401; the run is doomed before any credit is at stake
    const run = await runRecording({
      env: { TRAVELPAYOUTS_TOKEN: 'test-stale-travelpayouts-token-0123456789' },
    });
    const tiles = [...Array.from({ length: 18 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}`), 'TP-21'];
    const detail = `skipped: required call(s) ${tiles.join(', ')} not as planned; the run must be repeated`;
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(sa.map((c) => [c.id, c.status, c.detail])).toEqual([
      ['SA-01', 401, 'auth'],
      ...['SA-02', 'SA-03', 'SA-04', 'SA-05', 'SA-06'].map((id) => [id, 'skipped', detail]),
    ]);
    expect(run.seen.sa).toHaveLength(1);
    expect(run.summary.creditsUsed).toBe(0);
  });

  it('a required SearchApi probe not as planned (SA-01 timing out) also stops the run before SA-02 (cost I-1)', async () => {
    const run = await runRecordingInFakeTime({
      env: { REQUEST_TIMEOUT_SECONDS: '1' },
      vendors: {
        failOn: (u) =>
          u.searchParams.get('engine') === 'google_flights' &&
          u.searchParams.get('outbound_date') === '2027-03-10'
            ? 'hang'
            : undefined,
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-02')).toMatchObject({
      status: 'skipped',
      detail: 'skipped: required call(s) SA-01 not as planned; the run must be repeated',
    });
    expect(run.seen.sa).toHaveLength(1);
  });

  it('a step 3 answering 200 with no booking option ends completed with "chain incomplete" (prov-wp04b-r2-004)', async () => {
    const run = await runRecording({ vendors: { step3Empty: true } });
    expect(run.summary.calls.find((c) => c.id === 'SA-06')?.status).toBe(200);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: [],
      chainComplete: false,
    });
    expect(run.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get()).toEqual({
      status: 'completed',
      e: 'chain incomplete',
    });
  });

  it('a recorded root that does not exist is refused before the hidden execution opens (prov-wp04b-r3-003)', async () => {
    const ports = seededPorts();
    stubVendors();
    await expect(
      recordFixtures(ports, WORKED_EXAMPLE, {
        signal: new AbortController().signal,
        recordedRoot: join(tempDir(), 'fixtures', 'recorded'),
        recordedBy: TEST_RECORDED_BY,
      }),
    ).rejects.toThrow(/recorder root/);
    expect(ports.db.raw.prepare('SELECT COUNT(*) AS n FROM search_executions').get()).toEqual({ n: 0 });
  });

  it('a step 1 without any departure_token breaks the chain after one paid call (r2-ts-004)', async () => {
    const run = await runRecording({ vendors: { step1WithoutToken: true } });
    expect(statuses(run.summary.calls.slice(-3))).toEqual(['SA-04:200', 'SA-05:skipped', 'SA-06:skipped']);
    expect(run.summary.creditsUsed).toBe(2);
    expect(assessRun(run.plan, run.summary)).toMatchObject({
      requiredOk: false,
      notAsExpected: ['SA-05', 'SA-06'],
    });
  });

  it('an empty 200 for the over-limit calendar is accepted, named and billed (pie-005, cost-wp4b-004)', async () => {
    const run = await runRecording({ vendors: { overLimit: 'empty-200' } });
    expect(assessRun(run.plan, run.summary)).toMatchObject({ requiredOk: true, overLimit: 'empty-200' });
    expect(run.summary.creditsUsed).toBe(5);
  });

  it('a 5xx retried into a 200 keeps both attempt files on the call, the failed one first (prov-wp04b-r2-005)', async () => {
    let failed = false;
    const run = await runRecordingInFakeTime({
      vendors: {
        failOn: (u) => {
          if (failed || u.searchParams.get('engine') !== 'google_flights_calendar') return undefined;
          failed = true;
          return 'http-500';
        },
      },
    });
    const sa02 = run.summary.calls.find((c) => c.id === 'SA-02');
    expect(sa02?.status).toBe(200);
    expect(sa02?.files).toHaveLength(2);
    const [first, last] = (sa02?.files ?? []).map((p) => JSON.parse(readFileSync(p, 'utf8')).status);
    expect([first, last]).toEqual([500, 200]);
    expect(run.summary.creditsUsed).toBe(4); // the 500 is not billed
  });

  it('a 429 on a required call leaves it not as planned (r2-ts-004)', async () => {
    const run = await runRecordingInFakeTime({
      vendors: {
        failOn: (u) => (u.searchParams.get('return_date_end') === '2027-04-03' ? 'http-429' : undefined),
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-03')).toMatchObject({
      status: 429,
      detail: 'rate-limit',
    });
    expect(assessRun(run.plan, run.summary)).toMatchObject({ requiredOk: false, notAsExpected: ['SA-03'] });
  });

  it('a socket failure is no-response, NOT counted; a timeout is no-response, ledgered unknown and counted (cost-wp4b-r2-003)', async () => {
    const run = await runRecordingInFakeTime({
      env: { REQUEST_TIMEOUT_SECONDS: '1' },
      vendors: {
        failOn: (u) =>
          // why: the best-effort TP-19, so a required call stays as planned and SA-04 is still sent (cost I-1)
          u.searchParams.get('departure_at') === '2028-02'
            ? 'network'
            : u.searchParams.get('engine') === 'google_flights' &&
                u.searchParams.get('outbound_date') === '2027-03-02' &&
                u.searchParams.get('departure_token') === null
              ? 'hang'
              : undefined,
      },
    });
    expect(run.summary.calls.find((c) => c.id === 'TP-19')).toMatchObject({
      status: 'no-response',
      detail: expect.stringContaining('NOT counted'),
    });
    expect(run.summary.calls.find((c) => c.id === 'SA-04')).toMatchObject({
      status: 'no-response',
      detail: 'timeout (ledgered unknown, counted)',
    });
    expect(
      run.ports.db.raw
        .prepare(
          `SELECT outcome FROM provider_requests WHERE provider_id = 'searchapi' AND outcome = 'unknown'`,
        )
        .all(),
    ).toEqual([{ outcome: 'unknown' }]);
    expect(run.summary.creditsUsed).toBe(2); // SA-02 and the timed-out SA-04 (counted); SA-05/06 skipped
  });

  it('an abort during the calendar stops the run: later calls never reach the vendor and the execution is cancelled (ts-006, cost-wp4b-006)', async () => {
    const ac = new AbortController();
    const run = await runRecording({
      signal: ac.signal,
      vendors: {
        onRequest: (u) => {
          if (u.searchParams.get('engine') === 'google_flights_calendar') ac.abort();
        },
      },
    });
    const sa = run.summary.calls.filter((c) => c.providerId === 'searchapi');
    expect(sa.slice(0, 2).map((c) => c.status)).toEqual([401, 'aborted']);
    for (const c of sa.slice(2)) expect([c.status, c.detail]).toEqual(['skipped', 'aborted before send']);
    expect(run.seen.sa).toHaveLength(2);
    expect(run.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get()).toEqual({
      status: 'cancelled',
      e: 'aborted',
    }); // why: an abort with the real kit leaves no open reservation; the aborted SA-02 is ledgered unknown and counted, so the
    // ledger line shows it (cost M-3)
    expect(
      run.ports.db.raw.prepare("SELECT COUNT(*) AS n FROM provider_requests WHERE outcome = 'pending'").get(),
    ).toEqual({ n: 0 });
    expect(
      run.ports.db.raw
        .prepare("SELECT outcome FROM provider_requests WHERE provider_id = 'searchapi' ORDER BY rowid")
        .all(),
    ).toEqual([{ outcome: 'error' }, { outcome: 'unknown' }]);
    expect(run.summary.creditsUsed).toBe(1);
  });

  it.each([
    ['calendar-parameters', 22],
    ['calendar-base64', 22],
    ['sa-401-bearer', 22],
    ['tp-body', 0],
    ['tp-bearer', 0],
  ] as const)(
    'a vendor echoing a real credential (%s) fails closed: the earlier %i recordings exist, the refused call has none, no file holds the key (ts-008, r3-ts-005)',
    async (echo, earlier) => {
      const setup = recordingSetup({ vendors: { echo } });
      const err = await setup.run().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RecordingFailedError);
      if (!(err instanceof RecordingFailedError)) return;
      expect(err.message).not.toContain(SENTINEL_SA);
      expect(err.message).not.toContain(SENTINEL_TP);
      const files = recordings(setup.root);
      expect(files).toHaveLength(earlier);
      // the refused call (the SA-02 calendar, or TP-01) left no recording
      expect(files.some((f) => q(f, 'engine') === 'google_flights_calendar')).toBe(false);
      for (const path of filesUnder(setup.root)) {
        const text = readFileSync(path, 'utf8');
        expect(text, path).not.toContain(SENTINEL_SA);
        expect(text, path).not.toContain(SENTINEL_TP);
        expect(text, path).not.toContain(Buffer.from(SENTINEL_SA, 'utf8').toString('base64'));
      }
      const row = setup.ports.db.raw.prepare('SELECT status, error_text AS e FROM search_executions').get();
      expect(row).toMatchObject({
        status: 'cancelled',
        e: expect.stringContaining('record:fixtures failed'),
      });
      expect(JSON.stringify(row)).not.toContain(SENTINEL_SA);
      expect(JSON.stringify(row)).not.toContain(SENTINEL_TP);
    },
  );

  it('refuses a plan whose worst-case free calls exceed EXECUTION_MAX_FREE_CALLS before any request (ruling 13)', async () => {
    const ports = seededPorts({ EXECUTION_MAX_FREE_CALLS: '57' });
    await expect(runRecording({ ports })).rejects.toThrow(
      'the plan needs up to 61 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 57',
    );
    expect(ports.db.raw.prepare('SELECT COUNT(*) AS n FROM search_executions').get()).toEqual({ n: 0 });
  });

  // why: it builds two real SQLite-backed ports and runs the recording tool twice against a real ledger; under full-suite
  // load it once took 5,014 ms, past vitest's 5 s default, so it gets an explicit 15 s budget (coordinator ruling).
  it('priorToolCredits counts tool runs inside the SearchApi window only: lifetime on the trial, the billing month on 40usd (r2-ts-004)', {
    timeout: 15_000,
  }, async () => {
    const clock = fixedClock(AT);
    const ports = seededPorts({ SEARCHAPI_PLAN: '40usd' }, clock);
    await runRecording({ ports });
    expect(priorToolCredits(ports)).toBe(4);
    clock.set(asIsoDateTime('2026-11-02T09:00:00.000Z'));
    expect(priorToolCredits(ports)).toBe(0);
    const trialClock = fixedClock(AT);
    const trial = seededPorts({}, trialClock);
    await runRecording({ ports: trial });
    trialClock.set(asIsoDateTime('2027-11-02T09:00:00.000Z'));
    expect(priorToolCredits(trial)).toBe(4);
  });
});
