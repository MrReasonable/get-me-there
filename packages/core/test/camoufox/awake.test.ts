import { beforeEach, describe, expect, it } from 'vitest';
import {
  AWAKE_ENDPOINT_PATH,
  AWAKE_LEASE_SECONDS,
  AWAKE_MAX_SECONDS,
  AWAKE_MECHANISMS,
  AWAKE_RENEW_SECONDS,
  awakeAnswerSchema,
  awakeRequestSchema,
  workerStatusSchema,
} from '../../src/camoufox/protocol.js';

const AT = '2026-10-18T05:00:00.000Z';
const status = {
  ok: true,
  coolingDownUntil: null,
  cooldownCause: null,
  signedInRefusal: false,
  lastPageAt: null,
  busySince: null,
  versions: { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' },
  flags: {},
  accountCookie: { found: false, names: [], checkedAt: AT },
  socsCapturedAt: AT,
  socsStable: false,
  cooldownHours: 48,
  pageTimeoutSeconds: 90,
};

beforeEach(() => {
  expect.hasAssertions();
});

describe('the keep-awake lease contract (spec §2 "The keep-awake lease")', () => {
  it('names the route, the bounds, the lease and its renewal', () => {
    expect(AWAKE_ENDPOINT_PATH).toBe('/v1/awake');
    expect(AWAKE_MAX_SECONDS).toBe(600);
    expect(AWAKE_LEASE_SECONDS).toBe(300);
    expect(AWAKE_RENEW_SECONDS).toBe(60);
    expect(AWAKE_MECHANISMS).toEqual(['caffeinate', 'systemd-inhibit', 'none']);
  });
  it('the lease outlasts several missed renewals and stays inside the bound', () => {
    expect(AWAKE_LEASE_SECONDS).toBeGreaterThanOrEqual(4 * AWAKE_RENEW_SECONDS);
    expect(AWAKE_LEASE_SECONDS).toBeLessThanOrEqual(AWAKE_MAX_SECONDS);
  });
  it('a request is whole seconds from 0 (release) to the bound, nothing else', () => {
    expect(awakeRequestSchema.safeParse({ seconds: 0 }).success).toBe(true);
    expect(awakeRequestSchema.safeParse({ seconds: 600 }).success).toBe(true);
    expect(awakeRequestSchema.safeParse({ seconds: 601 }).success).toBe(false);
    expect(awakeRequestSchema.safeParse({ seconds: -1 }).success).toBe(false);
    expect(awakeRequestSchema.safeParse({ seconds: 1.5 }).success).toBe(false);
    expect(awakeRequestSchema.safeParse({ seconds: '300' }).success).toBe(false);
    expect(awakeRequestSchema.safeParse({}).success).toBe(false);
    expect(awakeRequestSchema.safeParse({ seconds: 300, extra: 1 }).success).toBe(false);
  });
  it('an answer states whether a hold is held, until when, and by what; held and until go together', () => {
    expect(awakeAnswerSchema.safeParse({ held: true, until: AT, mechanism: 'caffeinate' }).success).toBe(
      true,
    );
    expect(awakeAnswerSchema.safeParse({ held: false, until: null, mechanism: 'none' }).success).toBe(true);
    expect(awakeAnswerSchema.safeParse({ held: true, until: null, mechanism: 'caffeinate' }).success).toBe(
      false,
    );
    expect(awakeAnswerSchema.safeParse({ held: false, until: AT, mechanism: 'caffeinate' }).success).toBe(
      false,
    );
    expect(awakeAnswerSchema.safeParse({ held: false, until: null, mechanism: 'other' }).success).toBe(false);
    expect(
      awakeAnswerSchema.safeParse({ held: false, until: null, mechanism: 'none', extra: 1 }).success,
    ).toBe(false);
  });
  it('the status may report the hold, in the answer’s shape', () => {
    expect(workerStatusSchema.safeParse(status).success).toBe(true);
    const held = { held: true, until: AT, mechanism: 'systemd-inhibit' };
    expect(workerStatusSchema.safeParse({ ...status, awake: held }).success).toBe(true);
    expect(workerStatusSchema.safeParse({ ...status, awake: { ...held, until: null } }).success).toBe(false);
  });
});
