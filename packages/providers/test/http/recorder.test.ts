import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalJson,
  contentHash,
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  RecorderRefusedError,
  verifyContentHash,
  withContentHash,
} from '../../src/http/recorder.js';
import { ALL_SECRETS, makeKit, req, SEARCH, SENTINELS } from '../fakes.js';
import { obj } from '../support/guards.js';
import { server } from '../support/msw.js';
import { drive, driveError, useFakeTime } from '../support/time.js';

const T0 = '2026-10-14T15:00:00.000Z';
const key = SENTINELS.searchapi.reveal();
function tree(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'gmt-rec-')), 'fixtures', 'recorded');
  mkdirSync(root, { recursive: true });
  return root;
}
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.endsWith('.raw.json'))
    .map((d) => join(d.parentPath, d.name))
    .sort();
}
const recorder = (root: string, at = T0) =>
  createRecorder({
    root,
    secrets: ALL_SECRETS,
    clock: fixedClock(asIsoDateTime(at)),
    recordedBy: 'wp04-test',
  });
const call = (url: string, body: unknown, over: Partial<Parameters<typeof req>[0]> = {}, status = 200) => ({
  providerId: 'searchapi' as const,
  endpointPath: '/api/v1/search',
  request: req({ url, headers: { accept: 'application/json', authorization: `Bearer ${key}` }, ...over }),
  status,
  body,
  fetchedAt: asIsoDateTime(T0),
});
const SESSION = /^20261014T150000000Z-[0-9a-f]{6}$/;
const refusedAndEmpty = async (root: string, p: Promise<string>) => {
  expect(await p.catch((e: unknown) => e)).toBeInstanceOf(RecorderRefusedError);
  expect(readdirSync(root)).toEqual([]);
};
function parsed(path: string): Record<string, unknown> {
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return obj(v);
}

describe('createRecorder (spec §5.3 "Recorder", §5.5)', () => {
  it('writes <root>/<provider>/<endpointPath with / → _>/<date>-<sha12>.json plus a .raw.json, drops credential headers, returns the path', async () => {
    const root = tree();
    const path = await recorder(root).record(
      call(`${SEARCH}?engine=google_flights&departure_id=LHR`, { price: 41200 }),
    );
    expect(path).toMatch(/searchapi\/_api_v1_search\/2026-10-14-[0-9a-f]{12}\.json$/);
    expect(files(root)).toEqual([path]);
    expect(existsSync(path.replace(/\.json$/, '.raw.json'))).toBe(true);
    const f = loadRecordedFixture(path, root);
    expect(f).toEqual({
      recordedAt: T0,
      recordedBy: 'wp04-test',
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: {
        method: 'GET',
        url: `${SEARCH}?engine=google_flights&departure_id=LHR`,
        headers: { accept: 'application/json' },
        body: null,
      },
      status: 200,
      body: { price: 41200 },
      placeholders: {},
      session: expect.stringMatching(SESSION),
      contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const { contentSha256, ...rest } = f;
    expect(contentHash(rest)).toBe(contentSha256);
    expect(readFileSync(path, 'utf8')).not.toMatch(/authorization|x-access-token/i);
  });

  it.each([
    ['raw in the response body', () => call(SEARCH, { echo: `Invalid key ${key}` })],
    [
      'URL-encoded in the response body',
      () => call(SEARCH, { next: `https://x.example/?k=${encodeURIComponent(SENTINELS.smtp.reveal())}` }),
    ],
    [
      'base64 in the response body',
      () => call(SEARCH, { blob: Buffer.from(SENTINELS.basicAuth.reveal()).toString('base64') }),
    ],
    ['in the request URL', () => call(`${SEARCH}?api_key=${key}`, {})],
    ['in the request body', () => call(SEARCH, {}, { method: 'POST', body: JSON.stringify({ key }) })],
    ['in a non-credential header value', () => call(SEARCH, {}, { headers: { 'x-custom': key } })],
  ])('fails closed on a secret %s: throws and writes nothing (test-005, sec-002)', async (_label, make) => {
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record(make()));
  });

  it('strips search_metadata URLs to origin + path; a raw body carrying a key is refused, not written', async () => {
    const root = tree();
    const path = await recorder(root).record(
      call(SEARCH, { search_metadata: { request_url: `${SEARCH}?engine=google_flights&id=s1`, id: 's1' } }),
    );
    expect(obj(loadRecordedFixture(path, root).body).search_metadata).toEqual({
      request_url: SEARCH,
      id: 's1',
    });
    const other = tree();
    await refusedAndEmpty(
      other,
      recorder(other).record(call(SEARCH, { search_metadata: { request_url: `${SEARCH}?api_key=${key}` } })),
    );
  });

  it('replaces tokens with session placeholders, consistent from a response to the next request', async () => {
    const root = tree();
    const rec = recorder(root);
    const p1 = await rec.record(
      call(`${SEARCH}?engine=google_flights`, {
        best_flights: [{ departure_token: 'RAW-TOKEN-AAAA' }, { departure_token: 'RAW-TOKEN-BBBB' }],
      }),
    );
    const p2 = await rec.record(
      call(`${SEARCH}?engine=google_flights&departure_token=RAW-TOKEN-BBBB`, {
        booking_options: [{ booking_token: 'RAW-TOKEN-CCCC' }],
      }),
    );
    const [one, two] = [loadRecordedFixture(p1, root), loadRecordedFixture(p2, root)];
    expect(JSON.stringify([one, two])).not.toContain('RAW-TOKEN');
    const s = one.session;
    expect(s).toMatch(SESSION);
    expect(two.session).toBe(s);
    expect(one.body).toEqual({
      best_flights: [
        { departure_token: `<departure_token:0@${s}>` },
        { departure_token: `<departure_token:1@${s}>` },
      ],
    });
    expect(one.placeholders).toEqual({
      [`<departure_token:0@${s}>`]: 'departure_token',
      [`<departure_token:1@${s}>`]: 'departure_token',
    });
    expect(new URL(two.request.url).searchParams.get('departure_token')).toBe(`<departure_token:1@${s}>`);
    expect(two.body).toEqual({ booking_options: [{ booking_token: `<booking_token:0@${s}>` }] });
  });

  it('rewrites only token positions, including token-named parameters inside URL strings; other text is untouched (prov-007)', async () => {
    const root = tree();
    const t = 'RAW-LONG-TOKEN-0001';
    const path = await recorder(root).record(
      call(SEARCH, {
        departure_token: t,
        next: `${SEARCH}?departure_token=${t}&engine=google_flights`,
        label: 'flight 0001 on page 2',
      }),
    );
    const body = obj(loadRecordedFixture(path, root).body);
    expect(body.label).toBe('flight 0001 on page 2');
    expect(String(body.departure_token)).toMatch(/^<departure_token:0@/);
    expect(new URL(String(body.next)).searchParams.get('departure_token')).toBe(body.departure_token);
  });

  it('refuses rather than rewrite when a token value also appears outside a token position (prov-007)', async () => {
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record(call(SEARCH, { next_page_token: 'A1', seat: 'A1' })));
  });

  it('two sessions never share a session id or a placeholder, even when started at the same instant (prov-r2-001)', async () => {
    const r1 = tree();
    const r2 = tree();
    const a = loadRecordedFixture(
      await recorder(r1).record(call(SEARCH, { departure_token: 'RAW-TOKEN-AAAA' })),
      r1,
    );
    const b = loadRecordedFixture(
      await recorder(r2).record(call(SEARCH, { departure_token: 'RAW-TOKEN-AAAA' })),
      r2,
    );
    expect(a.session).not.toBe(b.session);
    expect(Object.keys(a.placeholders)).not.toEqual(Object.keys(b.placeholders));
  });

  it('is deterministic apart from the session id: a fresh recorder at the same instant writes the same recording', async () => {
    const run = async () => {
      const root = tree();
      const f = loadRecordedFixture(
        await recorder(root).record(call(SEARCH, { best_flights: [{ departure_token: 'RAW-TOKEN-AAAA' }] })),
        root,
      );
      const { session, contentSha256: _hash, ...rest } = f;
      return JSON.stringify(rest).replaceAll(session, '<session>');
    };
    expect(await run()).toEqual(await run());
  });

  it('refuses a root outside fixtures/recorded, an empty recordedBy, an unsafe endpointPath and the synthetic fixture provider', async () => {
    const clock = fixedClock(asIsoDateTime(T0));
    expect(() =>
      createRecorder({
        root: mkdtempSync(join(tmpdir(), 'gmt-x-')),
        secrets: ALL_SECRETS,
        clock,
        recordedBy: 'x',
      }),
    ).toThrow(RecorderRefusedError);
    expect(() => createRecorder({ root: tree(), secrets: ALL_SECRETS, clock, recordedBy: ' ' })).toThrow(
      RecorderRefusedError,
    );
    const root = tree();
    await refusedAndEmpty(root, recorder(root).record({ ...call(SEARCH, {}), providerId: 'fixture' }));
    await refusedAndEmpty(
      root,
      recorder(root).record({ ...call(SEARCH, {}), endpointPath: '/api/../x?y=1' }),
    );
  });

  it('refuses a provider or endpoint directory that is a symlink, creating nothing outside the tree (review I1)', async () => {
    const root = tree();
    const outside = mkdtempSync(join(tmpdir(), 'gmt-out-'));
    symlinkSync(outside, join(root, 'searchapi'));
    expect(
      await recorder(root)
        .record(call(SEARCH, { price: 1 }))
        .catch((e: unknown) => e),
    ).toBeInstanceOf(RecorderRefusedError);
    expect(readdirSync(outside)).toEqual([]);

    const root2 = tree();
    const outside2 = mkdtempSync(join(tmpdir(), 'gmt-out-'));
    mkdirSync(join(root2, 'searchapi'));
    symlinkSync(outside2, join(root2, 'searchapi', '_api_v1_search'));
    expect(
      await recorder(root2)
        .record(call(SEARCH, { price: 1 }))
        .catch((e: unknown) => e),
    ).toBeInstanceOf(RecorderRefusedError);
    expect(readdirSync(outside2)).toEqual([]);
  });

  it('refuses a root that is a symlink ending in fixtures/recorded whose real path does not (review I1)', () => {
    const real = mkdtempSync(join(tmpdir(), 'gmt-real-'));
    const parent = join(mkdtempSync(join(tmpdir(), 'gmt-lnk-')), 'fixtures');
    mkdirSync(parent);
    symlinkSync(real, join(parent, 'recorded'));
    expect(() =>
      createRecorder({
        root: join(parent, 'recorded'),
        secrets: ALL_SECRETS,
        clock: fixedClock(asIsoDateTime(T0)),
        recordedBy: 'x',
      }),
    ).toThrow(RecorderRefusedError);
  });

  it('canonicalJson has a known answer: keys sorted at every level, undefined dropped (prov-009)', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null, u: undefined } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('withContentHash has a known answer computed outside the code (prov-009)', () => {
    // printf '%s' '{"provider":"fixture","recordedAt":"2026-10-14"}' | shasum -a 256
    expect(withContentHash({ recordedAt: '2026-10-14', provider: 'fixture' }).contentSha256).toBe(
      'de30e2add53421370edd2145b64e66cc9ef3809b91667c70d0e694e4cfd58c73',
    );
  });
});

describe('recorded-tree loaders (spec §9 item 2 fixture-tree rules)', () => {
  const rewrite = (
    path: string,
    mutate: (o: Record<string, unknown>) => Record<string, unknown>,
    to = path,
  ): string => {
    writeFileSync(to, JSON.stringify(withContentHash(mutate(parsed(path)))));
    return to;
  };

  it('round-trips a recording and refuses it once hand-edited (tamper-evidence)', async () => {
    const root = tree();
    const path = await recorder(root).record(call(SEARCH, { price: 41200 }));
    expect(loadRecordedFixture(path, root).body).toEqual({ price: 41200 });
    writeFileSync(path, readFileSync(path, 'utf8').replace('41200', '1'));
    expect(() => loadRecordedFixture(path, root)).toThrow(/content hash mismatch/);
  });

  it('refuses a file outside the recorded root and a synthetic file inside it', () => {
    const root = tree();
    const outside = join(mkdtempSync(join(tmpdir(), 'gmt-o-')), 'x.json');
    writeFileSync(outside, JSON.stringify(withContentHash({ recordedAt: T0, recordedBy: 'x' })));
    expect(() => loadRecordedJson(outside, root)).toThrow(/recorded root/);
    const syn = join(root, 'syn.json');
    writeFileSync(syn, JSON.stringify(withContentHash({ synthetic: true, recordedAt: T0 })));
    expect(() => loadRecordedJson(syn, root)).toThrow(/synthetic/);
  });

  it.each([
    [
      'a missing recordedBy',
      (o: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'recordedBy')),
      /recordedBy/,
    ],
    ['an empty recordedBy', (o: Record<string, unknown>) => ({ ...o, recordedBy: '  ' }), /recordedBy/],
    [
      'a malformed recordedAt',
      (o: Record<string, unknown>) => ({ ...o, recordedAt: '2026-10-14T15:00:00Z' }),
      /recordedAt/,
    ],
    [
      'a providerId that is not its directory',
      (o: Record<string, unknown>) => ({ ...o, providerId: 'travelpayouts' }),
      /not under/,
    ],
    [
      'a recordedAt whose date is not the file name’s',
      (o: Record<string, unknown>) => ({ ...o, recordedAt: '2026-10-15T15:00:00.000Z' }),
      /file name/,
    ],
    [
      'a missing session',
      (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'session')),
      /session/,
    ],
    [
      'headers that are not all strings',
      (o: Record<string, unknown>) => ({ ...o, request: { ...obj(o.request), headers: { accept: 1 } } }),
      /headers/,
    ],
  ])('loadRecordedFixture refuses %s (prov-002)', async (_label, mutate, message) => {
    const root = tree();
    const path = rewrite(await recorder(root).record(call(SEARCH, { price: 1 })), mutate);
    expect(() => loadRecordedFixture(path, root)).toThrow(message);
  });

  it('refuses a file whose name does not carry its hash prefix', async () => {
    const root = tree();
    const path = await recorder(root).record(call(SEARCH, { price: 1 }));
    const renamed = path.replace(/-[0-9a-f]{12}\.json$/, '-000000000000.json');
    copyFileSync(path, renamed);
    expect(() => loadRecordedFixture(renamed, root)).toThrow(/file name/);
  });

  it('loadRecordedJson accepts a hashed allowlist file (no recordedBy); verifyContentHash rejects an unhashed object', () => {
    const root = tree();
    mkdirSync(join(root, 'searchapi'));
    const p = join(root, 'searchapi', 'params-2026-10-14.json');
    writeFileSync(
      p,
      JSON.stringify(withContentHash({ provider: 'searchapi', recordedAt: '2026-10-14', endpoints: {} })),
    );
    expect(loadRecordedJson(p, root)).toMatchObject({ provider: 'searchapi' });
    expect(verifyContentHash({ provider: 'searchapi' })).toBe(false);
    expect(() => loadRecordedFixture(p, root)).toThrow();
  });
});

describe('http-kit recording hook', () => {
  beforeEach(useFakeTime);
  afterEach(() => vi.useRealTimers());

  it('records every attempt that got a response, error bodies included, only when recordFixtures is true; recordedAt is when the kit received it (prov-r2-003)', async () => {
    const root = tree();
    // why: the recorder's own clock is an hour off and the kit's has moved on, so only fetchedAt can produce the asserted instant.
    const { kit, clock } = makeKit({ recorder: recorder(root, '2026-10-14T16:00:00.000Z') });
    clock.advance(30 * 60_000);
    let n = 0;
    server.use(
      http.get(SEARCH, () =>
        ++n === 1
          ? HttpResponse.json({ error: 'slow down' }, { status: 429, headers: { 'Retry-After': '1' } })
          : HttpResponse.json({ ok: n }),
      ),
    );
    await drive(kit.request(req({ url: `${SEARCH}?engine=a`, recordFixtures: true })));
    await drive(kit.request(req({ url: `${SEARCH}?engine=b`, recordFixtures: false })));
    const recorded = files(root).map((f) => loadRecordedFixture(f, root));
    expect(recorded.map((f) => f.status).sort()).toEqual([200, 429]);
    expect(recorded.every((f) => f.recordedAt === clock.now())).toBe(true);
  });

  it('a recorder refusal fails the request loudly', async () => {
    const { kit } = makeKit({ recorder: recorder(tree()) });
    server.use(http.get(SEARCH, () => HttpResponse.json({ echo: key })));
    expect(await driveError(kit.request(req({ url: SEARCH, recordFixtures: true })))).toBeInstanceOf(
      RecorderRefusedError,
    );
  });
});
