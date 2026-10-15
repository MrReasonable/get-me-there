// Spec §5.5 / §9 item 2 / §16 WP4b first failing test: a fixture recorded through the real http-kit and recorder
// carries a content hash, session and allowlisted response headers that WP4's verifier accepts, and an edit fails it.
import { readFileSync, writeFileSync } from 'node:fs';
import { asIsoDateTime, fixedClock, parseConfig, Secret } from '@gmt/core';
import {
  applyMigrations,
  budgetConfigFromConfig,
  MIGRATIONS_DIR,
  openDatabase,
  SqliteBudgetGuard,
  SqliteResponseCache,
} from '@gmt/db';
import { createHttpKit, createRecorder } from '@gmt/providers';
import { loadRecorded, verifyRecordedFile } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { recordingLimits, tpUrl } from '../../src/tools/recordRequests.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { onCleanup, tempRecordedRoot } from '../helpers/tmp.js';
import { stubVendors } from '../helpers/vendors.js';

const AT = asIsoDateTime('2026-10-20T09:00:00.000Z');
const SECRETS = [new Secret(SENTINEL_TP), new Secret(SENTINEL_SA)];

async function recordOneTile(): Promise<{ root: string; path: string }> {
  const parsed = parseConfig(testEnv(), { realpath: (p) => p });
  if (!parsed.ok) throw new Error('test env should parse');
  const { travelpayouts: tp, searchapi: sa } = parsed.config.providers;
  if (tp === null || sa === null) throw new Error('both providers are configured in testEnv');
  const db = openDatabase(':memory:');
  onCleanup(() => db.close());
  applyMigrations(db, MIGRATIONS_DIR);
  const clock = fixedClock(AT);
  const { root } = tempRecordedRoot();
  const written: string[] = [];
  const inner = createRecorder({
    root,
    secrets: SECRETS,
    clock,
    recordedBy: '@gmt/api record:fixtures (test)',
  });
  const http = createHttpKit({
    budget: new SqliteBudgetGuard(db, budgetConfigFromConfig(parsed.config), clock),
    cache: new SqliteResponseCache(db, clock),
    limits: recordingLimits(tp, sa, parsed.config),
    clock,
    log: silentLog,
    secrets: SECRETS,
    syntheticAllowed: false,
    recorder: {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    },
  });
  stubVendors();
  const url = tpUrl('LON', 'JFK', '2027-03', 1);
  const res = await http.request({
    providerId: 'travelpayouts',
    executionId: null,
    tileIndex: 0,
    endpointPath: url.pathname,
    method: 'GET',
    url,
    headers: { 'X-Access-Token': SENTINEL_TP },
    cache: 'never',
    signal: new AbortController().signal,
    recordFixtures: true,
  });
  expect(res.status).toBe(200);
  const path = written[0];
  if (path === undefined) throw new Error('nothing recorded');
  return { root, path };
}

describe('recorded fixture content hash (spec §5.5, WP4b first failing test)', () => {
  it('a tile recorded through http-kit verifies, with recordedAt = fetchedAt, a session and allowlisted response headers', async () => {
    const { root, path } = await recordOneTile();
    expect(path).toMatch(
      /[/\\]travelpayouts[/\\]_aviasales_v3_prices_for_dates[/\\]2026-10-20-[0-9a-f]{12}\.json$/,
    );
    expect(verifyRecordedFile(path, root, SECRETS)).toEqual([]);
    const [file] = loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates');
    expect(file?.recordedAt).toBe(AT);
    expect(file?.session).toMatch(/\S/);
    expect(file?.responseHeaders).toEqual({
      'content-type': 'application/json',
      'x-ratelimit-remaining': '599',
    });
    expect(new URL(file?.request.url ?? '').searchParams.get('departure_at')).toBe('2027-03'); // query kept
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain(SENTINEL_TP);
    // why: the WP0 secret scan rejects the literal header name, so credential headers are dropped, not scrubbed
    expect(text).not.toMatch(/X-Access-Token/i);
  });

  it('a hand-edited file fails verification', async () => {
    const { root, path } = await recordOneTile();
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    writeFileSync(path, JSON.stringify({ ...parsed, status: 201 }));
    expect(verifyRecordedFile(path, root, SECRETS).join('\n')).toMatch(/hash/i);
  });
});
