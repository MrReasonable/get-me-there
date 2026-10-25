import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANSWER_STATUS,
  BLOCKED_PAGES,
  blockedPageSchema,
  CAMOUFOX_CLOCK_SKEW_MS,
  CAMOUFOX_JS_VERSION,
  GOOGLE_CONTACTED_HEADER,
  pageRequestSchema,
  WORKER_KEY_HEADER,
  workerAnswerSchema,
  workerStatusSchema,
} from '../../src/camoufox/protocol.js';

const versions = {
  selectors: '2026-10-18-results',
  grammar: '2026-10-18-feasibility',
  camoufoxJs: '0.11.5',
  binary: '152.0.4-beta.28',
};
const AT = '2026-10-18T05:00:00.000Z';
const status = {
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions,
  flags: { RESULTS_VERIFIED: true, FORM_VERIFIED: false },
  accountCookie: { found: false, names: [], checkedAt: AT },
  socsCapturedAt: AT,
  socsStable: false,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
};
const request = {
  mode: 'list',
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-05',
  returnDate: '2026-11-15',
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};

beforeEach(() => {
  expect.hasAssertions();
});

describe('worker protocol (core/src/camoufox/protocol.ts; brief §5, §6)', () => {
  it('names the two headers', () => {
    expect([GOOGLE_CONTACTED_HEADER, WORKER_KEY_HEADER]).toEqual([
      'x-gmt-google-contacted',
      'x-gmt-worker-key',
    ]);
  });
  it('status requires flags and the accountCookie object', () => {
    expect(workerStatusSchema.parse(status)).toEqual(status);
    const { flags: _f, ...noFlags } = status;
    expect(workerStatusSchema.safeParse(noFlags).success).toBe(false);
    expect(workerStatusSchema.safeParse({ ...status, accountCookie: false }).success).toBe(false);
    expect(workerStatusSchema.safeParse({ ...status, extra: 1 }).success).toBe(false);
  });
  it.each([
    {
      kind: 'cells',
      fetchedAt: AT,
      currency: 'GBP',
      pointOfSale: 'GB',
      notes: [],
      versions,
      cell: {
        status: 'price',
        amountMinor: 45100,
        tabMinor: null,
        optionsUnparsed: 0,
        optionsOtherCell: 2,
        returnDateFrom: 'query-and-form',
      },
    },
    {
      kind: 'cells',
      fetchedAt: AT,
      currency: 'GBP',
      pointOfSale: 'unknown',
      notes: ['x'],
      versions,
      cell: { status: 'no-flights' },
    },
    { kind: 'blocked', page: 'captcha', cooldownUntil: AT },
    { kind: 'cooling-down', cause: 'signed-in', cooldownUntil: AT },
    { kind: 'spacing', retryAfterSeconds: 3 },
    { kind: 'mode-unavailable', mode: 'grid' },
    { kind: 'not-ready', elapsedMs: 90_000 },
    { kind: 'browser-error', stage: 'launch', detail: 'x' },
  ])('round-trips %j', (a) => {
    const parsed = workerAnswerSchema.parse(a);
    expect(parsed).toEqual(a);
    expect(ANSWER_STATUS[parsed.kind]).toBeGreaterThanOrEqual(200);
  });
  it('refuses an unknown kind and an extra field', () => {
    expect(workerAnswerSchema.safeParse({ kind: 'consent-rejected', fetchedAt: AT }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ kind: 'spacing', retryAfterSeconds: 3, extra: true }).success).toBe(
      false,
    );
  });
  it('a page request is one valid cell with airport names', () => {
    expect(pageRequestSchema.parse(request)).toEqual(request);
    expect(pageRequestSchema.safeParse({ ...request, returnDate: '2026-11-05' }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...request, returnDate: '2026-11-01' }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...request, destination: 'LHR' }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ ...request, origin: 'L1' }).success).toBe(false);
    const { airportNames: _a, ...noNames } = request;
    expect(pageRequestSchema.safeParse(noNames).success).toBe(false);
  });
  it('BlockedPage lists exactly the seven kinds', () => {
    expect(BLOCKED_PAGES).toEqual([
      'captcha',
      'unusual-traffic',
      'signed-in',
      'consent-unhandled',
      'sign-in',
      'off-allowlist',
      'unrecognised',
    ]);
    expect(blockedPageSchema.options).toHaveLength(7);
  });
  it('maps each kind to brief §6’s status', () => {
    expect(ANSWER_STATUS).toEqual({
      cells: 200,
      grid: 200,
      blocked: 423,
      'cooling-down': 423,
      spacing: 429,
      'mode-unavailable': 409,
      'not-ready': 504,
      'browser-error': 502,
      'monthly-cap': 429,
      'counts-unreadable': 503,
    });
  });

  // why: decision 82: the worker refuses a page past its own monthly page cap, naming the cap and when the window ends
  it('a monthly-cap answer carries the cap, the worker’s own count and the window end, nothing else', () => {
    const ok = { kind: 'monthly-cap', cap: 1500, used: 1500, windowEnd: '2027-04-01T00:00:00.000Z' };
    expect(workerAnswerSchema.parse(ok)).toEqual(ok);
    expect(workerAnswerSchema.safeParse({ ...ok, pages: 1500 }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ ...ok, cap: -1 }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ ...ok, used: -1 }).success).toBe(false);
    const { used: _, ...noUsed } = ok;
    expect(workerAnswerSchema.safeParse(noUsed).success).toBe(false);
  });

  // why: W3: a counts file the worker cannot read is its own answer, never a cap reached
  it('a counts-unreadable answer names missing or unreadable, nothing else', () => {
    for (const problem of ['missing', 'unreadable'])
      expect(workerAnswerSchema.parse({ kind: 'counts-unreadable', problem })).toEqual({
        kind: 'counts-unreadable',
        problem,
      });
    expect(workerAnswerSchema.safeParse({ kind: 'counts-unreadable', problem: 'gone' }).success).toBe(false);
    expect(
      workerAnswerSchema.safeParse({ kind: 'counts-unreadable', problem: 'missing', cap: 1 }).success,
    ).toBe(false);
  });

  // why: fix round 1 (prov I1): a page whose every option is for another cell was read; it is a cell issue, never a block
  it('a none-for-cell cell round-trips with its counts', () => {
    const a = {
      kind: 'cells',
      fetchedAt: AT,
      currency: 'GBP',
      pointOfSale: 'GB',
      notes: [],
      versions,
      cell: { status: 'none-for-cell', optionsOtherCell: 3, optionsUnparsed: 1 },
    };
    expect(workerAnswerSchema.parse(a)).toEqual(a);
    expect(
      workerAnswerSchema.safeParse({
        ...a,
        cell: { status: 'none-for-cell', optionsOtherCell: 0, optionsUnparsed: 0 },
      }).success,
    ).toBe(false);
  });
  // why: fix round 1 (prov M3, arch M12): the wire contract's edges
  it('refuses a zero price, a non-GBP answer and a malformed point of sale', () => {
    const cell = {
      status: 'price',
      amountMinor: 1,
      tabMinor: 1,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      returnDateFrom: 'query-and-form',
    };
    const a = { kind: 'cells', fetchedAt: AT, currency: 'GBP', pointOfSale: 'GB', notes: [], versions, cell };
    expect(workerAnswerSchema.safeParse(a).success).toBe(true);
    expect(workerAnswerSchema.safeParse({ ...a, cell: { ...cell, amountMinor: 0 } }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ ...a, cell: { ...cell, tabMinor: 0 } }).success).toBe(false);
    expect(workerAnswerSchema.safeParse({ ...a, currency: 'USD' }).success).toBe(false);
    for (const pos of ['gb', 'GBR', 'G', 'Unknown', ''])
      expect(workerAnswerSchema.safeParse({ ...a, pointOfSale: pos }).success, pos).toBe(false);
  });
  it('airport names: one to eight names of 1 to 120 characters each (the 4 KiB body bound)', () => {
    const names = (origin: string[]) => ({ ...request, airportNames: { ...request.airportNames, origin } });
    expect(pageRequestSchema.safeParse(names([])).success).toBe(false);
    expect(pageRequestSchema.safeParse(names(Array(8).fill('A'))).success).toBe(true);
    expect(pageRequestSchema.safeParse(names(Array(9).fill('A'))).success).toBe(false);
    expect(pageRequestSchema.safeParse(names(['A'.repeat(120)])).success).toBe(true);
    expect(pageRequestSchema.safeParse(names(['A'.repeat(121)])).success).toBe(false);
    expect(pageRequestSchema.safeParse(names([''])).success).toBe(false);
  });
  it('status: cooldownHours from 24, pageTimeoutSeconds 30 to 240', () => {
    expect(workerStatusSchema.safeParse({ ...status, cooldownHours: 24 }).success).toBe(true);
    expect(workerStatusSchema.safeParse({ ...status, cooldownHours: 23 }).success).toBe(false);
    expect(workerStatusSchema.safeParse({ ...status, pageTimeoutSeconds: 29 }).success).toBe(false);
    expect(workerStatusSchema.safeParse({ ...status, pageTimeoutSeconds: 241 }).success).toBe(false);
  });
  // why: fix round 1 (arch M11): the one copy of the camoufox-js pin, read by the worker and the smoke
  it('names the pinned camoufox-js version and the clock-skew allowance', () => {
    expect(CAMOUFOX_JS_VERSION).toBe('0.11.5');
    expect(CAMOUFOX_CLOCK_SKEW_MS).toBe(5000);
  });
});
