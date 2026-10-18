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
      binaryBuild: '152.0.4-beta.28',
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
        CAMOUFOX_BINARY_BUILD: '152.0.5-beta.1',
        POINT_OF_SALE: 'US',
      }),
    ).toMatchObject({
      port: 9000,
      minSpacingSeconds: 45,
      cooldownHours: 72,
      pageTimeoutSeconds: 120,
      binaryBuild: '152.0.5-beta.1',
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
    ['CAMOUFOX_MIN_SPACING_SECONDS', '29'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '601'],
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '29'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '241'],
    ['CAMOUFOX_INSTALL_DIR', '/elsewhere'],
    ['CAMOUFOX_BINARY_BUILD', 'latest'],
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
  it('a missing key refuses', () => {
    expect(fields({ HOME: '/h' })).toEqual(['CAMOUFOX_WORKER_KEY']);
  });
});
