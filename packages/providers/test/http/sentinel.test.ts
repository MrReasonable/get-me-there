import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock, ProviderError } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecorder } from '../../src/http/recorder.js';
import { containsSecret } from '../../src/http/scrub.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS, TP } from '../fakes.js';
import { hangUntilAborted, server } from '../support/msw.js';
import { tempDir } from '../support/tempdirs.js';
import { drive, useFakeTime } from '../support/time.js';

const key = SENTINELS.searchapi.reveal();
const token = SENTINELS.travelpayouts.reveal();
// every distinct form of every sentinel (raw, URL-encoded, form-encoded, JSON-escaped, base64, base64url); the SMTP
// sentinel's reserved characters make those forms differ (test-r2-003), and each must reach a scrub site.
const echoes = [
  ...new Set(
    ALL_SECRETS.flatMap((s) => {
      const v = s.reveal();
      return [
        v,
        encodeURIComponent(v),
        new URLSearchParams({ v }).toString().slice(2),
        JSON.stringify(v).slice(1, -1),
        Buffer.from(v).toString('base64'),
        Buffer.from(v).toString('base64url'),
      ];
    }),
  ),
];

describe('sentinel-key test (spec §5.3 secret scrubbing, §14)', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('no secret, in any form, reaches the ledger, cache, errors, bodies, recorder output or logs on any path', async () => {
    const root = join(tempDir('gmt-sen-'), 'fixtures', 'recorded');
    mkdirSync(root, { recursive: true });
    const recorder = createRecorder({
      root,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')),
      recordedBy: 'sentinel',
    });
    const main = makeKit({ recorder, overrides: { searchapi: { requestTimeoutSeconds: 5 } } });
    const echoing = makeKit({
      overrides: {
        searchapi: {
          classifyError: (f) =>
            new ProviderError({
              kind: 'auth',
              retryable: false,
              message: `vendor said ${JSON.stringify(f.body)}; key ${key}; ${encodeURIComponent(key)}`,
            }),
        },
      },
    });

    server.use(
      http.get(SEARCH, ({ request }) => {
        const scenario = new URL(request.url).searchParams.get('s');
        if (scenario === 'echo')
          return HttpResponse.json({ echoes, search_metadata: { request_url: `${SEARCH}?api_key=${key}` } });
        if (scenario === 'meta')
          return HttpResponse.json({
            search_metadata: { request_url: `${SEARCH}?engine=x&id=s1` },
            price: 1,
          });
        if (scenario === '401')
          return HttpResponse.json(
            { error: `Invalid API key ${key}`, echoes },
            { status: 401, headers: { 'x-echo': key } },
          );
        if (scenario === '400')
          return HttpResponse.json({ error: `bad request for ${encodeURIComponent(key)}` }, { status: 400 });
        if (scenario === 'socket') return HttpResponse.error();
        return hangUntilAborted(request); // 'hang'
      }),
      http.get(TP, () => HttpResponse.json({ success: true, data: [], echo: token })),
    );

    const results: unknown[] = [];
    const errors: unknown[] = [];
    const run = async (p: Promise<unknown>) => {
      try {
        results.push(await drive(p));
      } catch (e) {
        errors.push(e);
      }
    };
    const k = main.kit;
    await run(k.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } })));
    await run(k.request(req({ url: `${SEARCH}?s=echo`, cache: { ttlSeconds: 600 } }))); // cache hit
    await run(k.request(req({ url: `${SEARCH}?s=meta`, recordFixtures: true }))); // recorded (+ .raw.json)
    await run(k.request(req({ url: `${SEARCH}?s=echo`, recordFixtures: true }))); // recorder refuses
    await run(k.request(req({ url: `${SEARCH}?s=401` })));
    await run(k.request(req({ url: `${SEARCH}?s=400` })));
    await run(k.request(req({ url: `${SEARCH}?s=socket` })));
    await run(k.request(req({ url: `${SEARCH}?s=hang` }))); // timeout
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    await run(k.request(req({ url: `${SEARCH}?s=hang&a=1`, signal: ac.signal }))); // abort
    await run(k.request(req({ url: `${SEARCH}?api_key=${key}` }))); // egress refusal
    await run(k.request(req({ url: `${SEARCH}?s=x`, endpointPath: `/api/v1/search?api_key=${key}` })));
    await run(
      k.request(
        req({
          url: `${TP}?origin=LON`,
          providerId: 'travelpayouts',
          headers: { 'x-access-token': token },
          cache: { ttlSeconds: 600 },
        }),
      ),
    );
    await run(echoing.kit.request(req({ url: `${SEARCH}?s=401` }))); // adapter classifier copies vendor text and the key

    // positive controls
    const sent = [...main.events, ...echoing.events]
      .flatMap((e) => (e.type === 'fetch' ? [JSON.stringify(e.headers)] : []))
      .join('\n');
    expect(sent).toContain(key);
    expect(sent).toContain(token);
    expect(JSON.stringify(results[0]).split('[redacted]').length - 1).toBeGreaterThanOrEqual(echoes.length);
    expect(errors.length).toBeGreaterThanOrEqual(9);
    for (const kit of [main, echoing]) {
      expect(kit.log.lines.filter((l) => l.includes('"msg":"http attempt')).length).toBeGreaterThanOrEqual(
        kit.budget.reserveCalls,
      );
    }

    const errorText = JSON.stringify(
      errors.map((e) => (e instanceof Error ? { ...e, name: e.name, message: e.message } : e)),
    );
    const sinks = {
      ledger: JSON.stringify([...main.events, ...echoing.events].filter((e) => e.type !== 'fetch')),
      cacheKeys: JSON.stringify([...main.cache.entries.keys(), ...echoing.cache.entries.keys()]),
      cacheBodies: JSON.stringify([...main.cache.entries.values(), ...echoing.cache.entries.values()]),
      bodies: JSON.stringify(results),
      errors: errorText,
      recorder: readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => readFileSync(join(d.parentPath, d.name), 'utf8'))
        .join('\n'),
      logs: [...main.log.lines, ...echoing.log.lines].join('\n'),
    };
    expect(sinks.recorder).toContain('"price": 1');
    for (const [name, text] of Object.entries(sinks))
      expect({ sink: name, leaks: containsSecret(text, ALL_SECRETS) }).toEqual({ sink: name, leaks: false });
    expect(sinks.logs).not.toMatch(/https?:\/\/\S*\?/);
  });
});
