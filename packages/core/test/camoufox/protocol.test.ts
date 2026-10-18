import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANSWER_STATUS,
  BLOCKED_PAGES,
  blockedPageSchema,
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
      blocked: 423,
      'cooling-down': 423,
      spacing: 429,
      'mode-unavailable': 409,
      'not-ready': 504,
      'browser-error': 502,
    });
  });
});
