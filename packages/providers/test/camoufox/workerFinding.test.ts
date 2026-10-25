// workerFinding (WP18 V5): the one judgement of a worker that answered, shared by the preflight and the Status report.
import {
  GRID_STEP_DAYS,
  SHARED_WORKER_DEFAULTS,
  type SharedSettings,
  type WorkerStatus,
  workerStatusSchema,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { workerFinding } from '../../src/camoufox/preflight.js';

const status = (over: Record<string, unknown> = {}): WorkerStatus =>
  workerStatusSchema.parse({
    ok: true,
    coolingDownUntil: null,
    cooldownCause: null,
    signedInRefusal: false,
    lastPageAt: null,
    busySince: null,
    versions: { selectors: 'a', grammar: 'b', camoufoxJs: 'c', binary: 'd' },
    flags: { FORM_VERIFIED: true },
    accountCookie: { found: false, names: [], checkedAt: '2026-10-14T08:59:00.000Z' },
    socsCapturedAt: null,
    socsStable: true,
    cooldownHours: 48,
    pageTimeoutSeconds: 90,
    ...over,
  });
const GRID = { scrollCap: 30, spacingSeconds: 5, pageTimeoutSeconds: 90 };
const gridStatus = (over: Record<string, unknown> = {}) =>
  status({ gridStepDays: GRID_STEP_DAYS, gridScrollCap: 30, gridScrollSpacingSeconds: 5, ...over });

describe('workerFinding', () => {
  it('is null for a worker that will take pages', () => {
    expect(workerFinding(status(), {})).toBeNull();
    expect(workerFinding(gridStatus(), { grid: GRID })).toBeNull();
  });
  it('a cool-down keeps its end and cause', () => {
    expect(
      workerFinding(status({ coolingDownUntil: '2026-10-20T05:00:00.000Z', cooldownCause: 'captcha' }), {}),
    ).toEqual({ kind: 'cooling', until: '2026-10-20T05:00:00.000Z', cause: 'captcha' });
  });
  it('a signed-in refusal and a signed-in cookie are both signed-in', () => {
    expect(workerFinding(status({ signedInRefusal: true }), {})).toEqual({ kind: 'signed-in' });
    expect(
      workerFinding(
        status({ accountCookie: { found: true, names: ['SID'], checkedAt: '2026-10-14T08:59:00.000Z' } }),
        {},
      ),
    ).toEqual({ kind: 'signed-in' });
  });
  it('shared settings that differ are named', () => {
    const app: SharedSettings = SHARED_WORKER_DEFAULTS;
    const worker: SharedSettings = { ...SHARED_WORKER_DEFAULTS, CAMOUFOX_COOLDOWN_HOURS: '72' };
    expect(workerFinding(status({ sharedSettings: worker }), { sharedSettings: app })).toEqual({
      kind: 'settings',
      names: ['CAMOUFOX_COOLDOWN_HOURS'],
    });
  });
  it('in grid mode an unverified step, then each differing grid setting, is found in order', () => {
    expect(workerFinding(status(), { grid: GRID })).toEqual({ kind: 'grid-unverified' });
    expect(workerFinding(gridStatus({ gridScrollCap: 10 }), { grid: GRID })).toEqual({
      kind: 'grid-setting',
      name: 'CAMOUFOX_GRID_SCROLL_CAP',
      worker: 10,
      app: 30,
    });
    expect(workerFinding(gridStatus({ pageTimeoutSeconds: 120 }), { grid: GRID })).toMatchObject({
      name: 'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
    });
    expect(workerFinding(gridStatus({ gridScrollSpacingSeconds: 9 }), { grid: GRID })).toMatchObject({
      name: 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
    });
  });
});
