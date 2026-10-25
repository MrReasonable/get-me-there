import { effectiveSharedSettings } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig, WorkerConfigError } from '../src/config.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
const ENV = { CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op', PATH: '/usr/bin', TMPDIR: '/tmp' };
function fields(env: Record<string, string>): string[] {
  try {
    loadWorkerConfig(env);
  } catch (e) {
    if (e instanceof WorkerConfigError) return e.fields;
    throw e;
  }
  return [];
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('worker config (brief Task 14.5; spec §12 worker side)', () => {
  it('defaults', () => {
    const c = loadWorkerConfig(ENV);
    expect(c).toMatchObject({
      port: 8090,
      minSpacingSeconds: 30,
      cooldownHours: 48,
      pageTimeoutSeconds: 90,
      home: '/Users/op',
      path: '/usr/bin',
      tmp: '/tmp',
      pointOfSale: 'GB',
    });
    expect(c.key.reveal()).toBe(KEY);
    expect(JSON.stringify(c)).not.toContain(KEY);
  });
  it('reads every override, and falls back for an unset PATH and TMPDIR', () => {
    expect(
      loadWorkerConfig({
        CAMOUFOX_WORKER_KEY: KEY,
        HOME: '/h',
        CAMOUFOX_WORKER_PORT: '9000',
        CAMOUFOX_MIN_SPACING_SECONDS: '45',
        CAMOUFOX_COOLDOWN_HOURS: '72',
        CAMOUFOX_PAGE_TIMEOUT_SECONDS: '120',
        POINT_OF_SALE: 'US',
      }),
    ).toMatchObject({
      port: 9000,
      minSpacingSeconds: 45,
      cooldownHours: 72,
      pageTimeoutSeconds: 120,
      pointOfSale: 'US',
      path: '/usr/bin:/bin',
      tmp: '/tmp',
    });
  });
  it.each([
    ['CAMOUFOX_WORKER_KEY', 'short'],
    ['CAMOUFOX_WORKER_PORT', '80'],
    ['CAMOUFOX_WORKER_PORT', '70000'],
    ['CAMOUFOX_WORKER_PORT', '8o90'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '-1'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '601'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '  '],
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '29'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '241'],
    ['POINT_OF_SALE', 'gb'],
    ['HOME', ''],
  ])('%s=%s refuses, naming the variable and never the value', (name, value) => {
    expect(fields({ ...ENV, [name]: value })).toEqual([name]);
    try {
      loadWorkerConfig({ ...ENV, [name]: value });
    } catch (e) {
      expect(String(e)).not.toContain(value === '' ? '\u0000' : `=${value}`);
      expect(String(e)).not.toContain(KEY);
    }
  });
  // why: decision 73: the pin is CAMOUFOX_BUILDS[osArch].build; the old setting is refused by name, whatever its value
  it('a worker.env still naming CAMOUFOX_BINARY_BUILD is refused with the words that say why', () => {
    for (const value of ['152.0.4-beta.28', '', 'latest'])
      expect(() => loadWorkerConfig({ ...ENV, CAMOUFOX_BINARY_BUILD: value })).toThrow(
        new WorkerConfigError(
          [],
          'remove CAMOUFOX_BINARY_BUILD from worker.env (pnpm gmt browser install removes it): the build now comes from CAMOUFOX_BUILDS',
        ),
      );
    // why: run.ts carries its own CAMOUFOX_INSTALL_DIR into the entry's environment; the settings read nothing from it
    expect(loadWorkerConfig({ ...ENV, CAMOUFOX_INSTALL_DIR: '/x' }).port).toBe(8090);
  });
  // why: spec §2 rev 34: grid pages only with CAMOUFOX_MODE=grid; the scroll spacing at least 5 s, the cap at most 60
  it('grid settings: list by default, grid when asked, spacing 0–30 and a cap of 0–60', () => {
    expect(loadWorkerConfig(ENV)).toMatchObject({
      mode: 'list',
      gridScrollSpacingSeconds: 5,
      gridScrollCap: 30,
    });
    expect(
      loadWorkerConfig({
        ...ENV,
        CAMOUFOX_MODE: 'grid',
        CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '30',
        CAMOUFOX_GRID_SCROLL_CAP: '0',
      }),
    ).toMatchObject({ mode: 'grid', gridScrollSpacingSeconds: 30, gridScrollCap: 0 });
    expect(fields({ ...ENV, CAMOUFOX_MODE: 'calendar' })).toEqual(['CAMOUFOX_MODE']);
    expect(loadWorkerConfig({ ...ENV, CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '0' })).toMatchObject({
      gridScrollSpacingSeconds: 0,
    });
    expect(loadWorkerConfig({ ...ENV, CAMOUFOX_MIN_SPACING_SECONDS: '0' })).toMatchObject({
      minSpacingSeconds: 0,
    });
    expect(fields({ ...ENV, CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '31' })).toEqual([
      'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
    ]);
    expect(fields({ ...ENV, CAMOUFOX_GRID_SCROLL_CAP: '61' })).toEqual(['CAMOUFOX_GRID_SCROLL_CAP']);
  });
  it('reads the monthly page and scroll caps and the billing day with the app’s defaults (1500, 6000, 1; decision 82)', () => {
    expect(loadWorkerConfig(ENV)).toMatchObject({
      monthlyPageCap: 1500,
      monthlyScrollCap: 6000,
      billingDay: 1,
    });
    expect(
      loadWorkerConfig({
        ...ENV,
        CAMOUFOX_MONTHLY_PAGE_CAP: '900',
        CAMOUFOX_MONTHLY_SCROLL_CAP: '0',
        CAMOUFOX_BILLING_DAY: '28',
      }),
    ).toMatchObject({ monthlyPageCap: 900, monthlyScrollCap: 0, billingDay: 28 });
    for (const [name, value] of [
      ['CAMOUFOX_MONTHLY_PAGE_CAP', '-1'],
      ['CAMOUFOX_MONTHLY_SCROLL_CAP', 'many'],
      ['CAMOUFOX_BILLING_DAY', '29'],
      ['CAMOUFOX_BILLING_DAY', '0'],
    ] as const)
      expect(fields({ ...ENV, [name]: value }), `${name}=${value}`).toEqual([name]);
  });
  it('states its effective shared settings through core’s effectiveSharedSettings (spec §12): defaults applied, integers decimal', () => {
    expect(loadWorkerConfig(ENV).sharedSettings).toEqual(effectiveSharedSettings({}));
    expect(
      loadWorkerConfig({ ...ENV, CAMOUFOX_COOLDOWN_HOURS: '072', CAMOUFOX_MODE: 'grid', POINT_OF_SALE: 'US' })
        .sharedSettings,
    ).toEqual(
      effectiveSharedSettings({ CAMOUFOX_COOLDOWN_HOURS: '72', CAMOUFOX_MODE: 'grid', POINT_OF_SALE: 'US' }),
    );
  });
  it('a missing key refuses', () => {
    expect(fields({ HOME: '/h' })).toEqual(['CAMOUFOX_WORKER_KEY']);
  });
  it('R27: every typed shared field comes from the one record, so the worker refuses and defaults exactly as the app does', () => {
    const c = loadWorkerConfig({
      ...ENV,
      CAMOUFOX_COOLDOWN_HOURS: '0072',
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_GRID_SCROLL_CAP: '012',
      CAMOUFOX_BILLING_DAY: '15',
    });
    expect([c.cooldownHours, c.mode, c.gridScrollCap, c.billingDay, c.pointOfSale]).toEqual([
      72,
      'grid',
      12,
      15,
      'GB',
    ]);
    for (const [name, value] of [
      ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '3e1'],
      ['CAMOUFOX_COOLDOWN_HOURS', '100001'],
    ] as const)
      expect(fields({ ...ENV, [name]: value }), `${name}=${value}`).toEqual([name]);
  });
});
