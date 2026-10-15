import { Writable } from 'node:stream';
import { asIsoDateTime, fixedClock, Secret } from '@gmt/core';
import { MIGRATIONS_DIR } from '@gmt/db';
import { createHttpKit, type HttpKitRequest } from '@gmt/providers';
import { describe, expect, it, vi } from 'vitest';
import { createLogger, REDACT_PATHS, SPEC_REDACT_PATHS } from '../src/logger.js';
import { recordingLimits, saUrl, tpUrl } from '../src/tools/recordRequests.js';
import { buildPorts, loadConfigFromEnv } from '../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from './helpers/env.js';
import { onCleanup } from './helpers/tmp.js';

function sink(): { destination: Writable; text(): string; lines(): string[] } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return {
    destination,
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((l) => l !== ''),
  };
}

describe('createLogger (spec §14 redact paths, sec-001, sec-002)', () => {
  it('keeps the spec list and redacts credential headers in every casing, nested, plus err.config and smtp.pass', () => {
    expect(REDACT_PATHS.slice(0, SPEC_REDACT_PATHS.length)).toEqual([
      'apiKey',
      'token',
      'authorization',
      'url.query',
      'req.headers.authorization',
    ]);
    const s = sink();
    const log = createLogger({ logLevel: 'debug' }, { destination: s.destination });
    log.info(
      {
        apiKey: SENTINEL_SA,
        token: SENTINEL_SA,
        authorization: SENTINEL_SA,
        url: { query: SENTINEL_SA },
        req: { headers: { authorization: SENTINEL_SA } },
      },
      'spec',
    );
    log.info(
      {
        headers: {
          Authorization: SENTINEL_SA,
          'X-Access-Token': SENTINEL_TP,
          'x-api-key': SENTINEL_SA,
          COOKIE: SENTINEL_SA,
        },
      },
      'top',
    );
    log.info(
      {
        request: {
          headers: {
            authorization: SENTINEL_SA,
            'x-access-token': SENTINEL_TP,
            'Proxy-Authorization': SENTINEL_SA,
          },
        },
      },
      'nested',
    );
    log.error(
      {
        err: { message: 'boom', config: { headers: { Authorization: `Bearer ${SENTINEL_SA}` } } },
        smtp: { pass: SENTINEL_SA },
      },
      'library error',
    );
    log.child({ tool: 'record' }).warn({ token: SENTINEL_SA }, 'child');
    log.debug({}, 'd');
    const text = s.text();
    expect(s.lines()).toHaveLength(6);
    expect(text).not.toContain(SENTINEL_SA);
    expect(text).not.toContain(SENTINEL_TP);
    expect(s.lines()[4]).toContain('"tool":"record"');
  });

  it('scrubs configured secret values from any field the paths do not name, including messages', () => {
    const s = sink();
    const log = createLogger(
      { logLevel: 'info' },
      { destination: s.destination, secrets: [new Secret(SENTINEL_SA)] },
    );
    log.warn(
      { error: `upstream said: ${SENTINEL_SA}`, nested: { deep: [encodeURIComponent(SENTINEL_SA)] } },
      `message with ${SENTINEL_SA}`,
    );
    expect(s.text()).not.toContain(SENTINEL_SA);
    expect(s.text()).toContain('[redacted]');
  });

  it.each([
    ["without the scrubbing sink: only pino redact and http-kit's own stripping stand", false],
    ['with the scrubbing sink', true],
  ] as const)(
    'the real pino logger behind http-kit at debug level leaks no credential on success, retry, 401 and 400 paths, %s (sec-001, r2-ts-003)',
    async (_name, scrub) => {
      // why: fake timers drive http-kit's retry backoff, so the test is deterministic and fast
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      onCleanup(() => vi.useRealTimers());
      const config = loadConfigFromEnv(testEnv());
      const { travelpayouts: tp, searchapi: sa } = config.providers;
      if (tp === null || sa === null) throw new Error('both providers configured');
      const ports = buildPorts(config, {
        log: silentLog,
        clock: fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z')),
        migrationsDir: MIGRATIONS_DIR,
      });
      onCleanup(() => ports.db.close());
      const s = sink();
      const log = createLogger(
        { logLevel: 'debug' },
        { destination: s.destination, ...(scrub ? { secrets: ports.secrets } : {}) },
      );
      const http = createHttpKit({
        budget: ports.budget,
        cache: ports.cache,
        clock: ports.clock,
        log,
        secrets: ports.secrets,
        syntheticAllowed: false,
        limits: recordingLimits(tp, sa, config),
      });
      let calls = 0;
      vi.stubGlobal('fetch', async (input: string | URL | Request): Promise<Response> => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        calls++;
        if (url.hostname === 'api.travelpayouts.com')
          return calls === 1
            ? new Response(`upstream overloaded for token ${SENTINEL_TP}`, { status: 503 })
            : new Response(JSON.stringify({ success: true, data: [], currency: 'gbp' }), { status: 200 });
        if (url.searchParams.get('engine') === 'google_flights_calendar')
          return new Response(JSON.stringify({ error: 'Too many date combinations.' }), { status: 400 });
        return new Response(JSON.stringify({ error: `Invalid API key: Bearer ${SENTINEL_SA}` }), {
          status: 401,
        });
      });
      onCleanup(() => vi.unstubAllGlobals());
      const req = (
        providerId: 'travelpayouts' | 'searchapi',
        url: URL,
        headers: Record<string, string>,
      ): HttpKitRequest => ({
        providerId,
        executionId: null,
        tileIndex: 0,
        endpointPath: url.pathname,
        method: 'GET',
        url,
        headers,
        cache: 'never',
        signal: new AbortController().signal,
        recordFixtures: false,
      });
      // why: the limiter's spacing and the retry backoff are timers; each request is driven by advancing fake time
      const drive = async <T>(p: Promise<T>): Promise<PromiseSettledResult<T>> => {
        const settled = Promise.allSettled([p]);
        await vi.advanceTimersByTimeAsync(10_000);
        const [r] = await settled;
        if (r === undefined) throw new Error('no result');
        return r;
      };
      const ok = await drive(
        http.request(
          req('travelpayouts', tpUrl('LON', 'JFK', '2027-03', 1), { 'X-Access-Token': SENTINEL_TP }),
        ),
      ); // 503, retried, then 200
      expect(ok.status).toBe('fulfilled');
      expect(
        (
          await drive(
            http.request(
              req('searchapi', saUrl({ engine: 'google_flights_calendar' }), {
                Authorization: `Bearer ${SENTINEL_SA}`,
              }),
            ),
          )
        ).status,
      ).toBe('rejected');
      expect(
        (
          await drive(
            http.request(
              req('searchapi', saUrl({ engine: 'google_flights' }), {
                Authorization: `Bearer ${SENTINEL_SA}`,
              }),
            ),
          )
        ).status,
      ).toBe('rejected');
      const text = s.text();
      expect(calls).toBe(4);
      expect(text).toContain('"level":20'); // debug lines were written
      expect(text).toContain('http request failed');
      for (const banned of [SENTINEL_SA, SENTINEL_TP, 'Bearer ', 'api_key=', 'departure_at='])
        expect(text).not.toContain(banned);
      if (!scrub) expect(text).not.toContain('[redacted]'); // nothing here needed the sink: http-kit logged no credential at all
    },
  );
});
