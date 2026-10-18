import { describe, expect, it } from 'vitest';
import { assertEgress } from '../../src/http/egress.js';
import { req, SENTINELS, testLimits } from '../fakes.js';

const camoufoxLimits = (host: string, port: number, scheme: 'http:' | 'https:') =>
  testLimits({
    camoufox: { hosts: [host], workerPort: port, workerScheme: scheme },
    'camoufox-status': { hosts: [host], workerPort: port, workerScheme: scheme },
  });
const at = (
  url: string,
  providerId: 'camoufox' | 'camoufox-status' | 'searchapi' = 'camoufox',
  method: 'GET' | 'POST' = 'POST',
) => req({ url, providerId, method, headers: { 'x-gmt-worker-key': SENTINELS.camoufox.reveal() } });
const denied = (f: () => void): string => {
  try {
    f();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return 'allowed';
};

describe('egress for the camoufox worker (arch-012: camoufoxWorkerUrlOk’s accepted examples)', () => {
  it.each([
    ['http://127.0.0.1:8090', '127.0.0.1', 8090, 'http:'],
    ['http://localhost:8090', 'localhost', 8090, 'http:'],
    ['http://[::1]:8090', '[::1]', 8090, 'http:'],
    ['https://127.0.0.1:8443', '127.0.0.1', 8443, 'https:'],
    ['http://host.docker.internal:8090', 'host.docker.internal', 8090, 'http:'],
  ] as const)('%s passes for camoufox and its status route', (base, host, port, scheme) => {
    const l = camoufoxLimits(host, port, scheme);
    expect(() => assertEgress(at(`${base}/v1/page`), l.camoufox, [SENTINELS.camoufox])).not.toThrow();
    expect(() =>
      assertEgress(at(`${base}/v1/status`, 'camoufox-status', 'GET'), l['camoufox-status'], [
        SENTINELS.camoufox,
      ]),
    ).not.toThrow();
  });
  it.each([
    ['another port', 'http://127.0.0.1:9377/v1/page'],
    ['no port', 'http://127.0.0.1/v1/page'],
    ['another host', 'http://192.168.1.10:8090/v1/page'],
    ['another scheme', 'https://127.0.0.1:8090/v1/page'],
    ['Google directly', 'https://www.google.com/travel/flights'],
  ])('refuses %s', (_n, url) => {
    expect(
      denied(() =>
        assertEgress(at(url), camoufoxLimits('127.0.0.1', 8090, 'http:').camoufox, [SENTINELS.camoufox]),
      ),
    ).toMatch(/egress denied/);
  });
  it('the status id is GET /v1/status only', () => {
    const l = camoufoxLimits('127.0.0.1', 8090, 'http:')['camoufox-status'];
    expect(
      denied(() => assertEgress(at('http://127.0.0.1:8090/v1/page', 'camoufox-status', 'GET'), l, [])),
    ).toMatch(/GET \/v1\/status only/);
    expect(
      denied(() => assertEgress(at('http://127.0.0.1:8090/v1/status', 'camoufox-status', 'POST'), l, [])),
    ).toMatch(/GET \/v1\/status only/);
  });
  it('a worker id without a configured port is refused', () => {
    const { workerPort: _p, ...noPort } = testLimits().camoufox;
    expect(denied(() => assertEgress(at('http://127.0.0.1:8090/v1/page'), noPort, []))).toMatch(/port/);
  });
  it('any searchapi request to the worker URL is refused', () => {
    expect(
      denied(() =>
        assertEgress(at('http://127.0.0.1:8090/v1/page', 'searchapi', 'GET'), testLimits().searchapi, []),
      ),
    ).toMatch(/explicit port|scheme/);
  });
});
