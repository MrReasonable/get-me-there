import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import { loadRecordedJson } from '../../src/http/recordedFiles.js';
import { createRecorder, withContentHash } from '../../src/http/recorder.js';
import { verifyFixturesTree, verifyRecordedFile, verifyRecordedTree } from '../../src/testing/verify.js';
import { ALL_SECRETS, req, SEARCH, SENTINELS } from '../fakes.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const scanFixtures = (root: string): string[] => verifyFixturesTree(root, ALL_SECRETS);

// why: ruling 11: lists the committed tree through git and scans every fixture file; 30 s survives a loaded runner.
describe('fixture-tree scan (spec §9 item 2: every committed fixture scanned)', { timeout: 30_000 }, () => {
  it('reports each planted fault in a temporary tree (positive control, test-008)', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'gmt-scan-')), 'fixtures');
    cpSync(defaultFixtureRoot(), join(root, 'synthetic', 'fixture'), { recursive: true });
    const recordedRoot = join(root, 'recorded');
    mkdirSync(recordedRoot, { recursive: true });
    const recorder = createRecorder({
      root: recordedRoot,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')),
      recordedBy: 'scan-test',
    });
    const fetchedAt = asIsoDateTime('2026-10-14T15:00:00.000Z');
    const good = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: req({ url: `${SEARCH}?engine=google_flights` }),
      status: 200,
      body: { price: 1 },
      fetchedAt,
    });
    const edited = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: req({ url: `${SEARCH}?engine=google_flights_calendar` }),
      status: 200,
      body: { price: 41200 },
      fetchedAt,
    });
    // a recording whose request went to another provider's host (prov-003 cross-check, test-r2-002)
    const wrongHost = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/aviasales/v3/prices_for_dates',
      request: req({ url: 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=LON' }),
      status: 200,
      body: { price: 2 },
      fetchedAt,
    });
    writeFileSync(edited, readFileSync(edited, 'utf8').replace('41200', '1'));
    writeFileSync(
      join(recordedRoot, 'searchapi', 'params-2026-10-14.json'),
      JSON.stringify(
        withContentHash({
          provider: 'searchapi',
          recordedAt: '2026-10-14',
          endpoints: { '/api/v1/search': { names: ['gl'], values: { gl: ['gb'] } } },
        }),
      ),
    );
    writeFileSync(
      join(root, 'synthetic', 'fixture', 'calendar', 'AAA-BBB.json'),
      JSON.stringify({ currency: 'GBP' }),
    );
    writeFileSync(
      join(root, 'synthetic', 'fixture', 'itinerary', 'AAA-CCC.json'),
      JSON.stringify({ synthetic: true, note: SENTINELS.smtp.reveal() }),
    );
    writeFileSync(join(root, 'synthetic', 'notes.txt'), 'stray');
    const problems = scanFixtures(root);
    expect(
      problems.some((p) => p.includes(relative(root, edited)) && p.includes('content hash mismatch')),
    ).toBe(true);
    expect(
      problems.some(
        (p) => p.includes('AAA-BBB.json') && p.endsWith('synthetic file without "synthetic": true'),
      ),
    ).toBe(true);
    expect(problems.some((p) => p.includes('AAA-CCC.json') && p.endsWith('holds a secret'))).toBe(true);
    expect(problems.some((p) => p.includes('notes.txt') && p.endsWith('not a JSON file'))).toBe(true);
    expect(
      problems.some(
        (p) => p.includes(relative(root, wrongHost)) && p.endsWith("request host is not searchapi's"),
      ),
    ).toBe(true);
    expect(problems.some((p) => p.includes(relative(root, good)))).toBe(false);
    expect(problems.some((p) => p.includes('params-2026-10-14.json'))).toBe(false);
  });

  it('verifyRecordedTree and verifyRecordedFile check a recorded root on its own (WP4b record tool)', async () => {
    const recordedRoot = join(mkdtempSync(join(tmpdir(), 'gmt-vr-')), 'fixtures', 'recorded');
    mkdirSync(recordedRoot, { recursive: true });
    const recorder = createRecorder({
      root: recordedRoot,
      secrets: ALL_SECRETS,
      clock: fixedClock(asIsoDateTime('2026-10-14T15:00:00.000Z')),
      recordedBy: 'verify-test',
    });
    const good = await recorder.record({
      providerId: 'searchapi',
      endpointPath: '/api/v1/search',
      request: req({ url: `${SEARCH}?engine=google_flights` }),
      status: 200,
      body: { price: 1 },
      fetchedAt: asIsoDateTime('2026-10-14T15:00:00.000Z'),
    });
    expect(verifyRecordedFile(good, recordedRoot, ALL_SECRETS)).toEqual([]);
    expect(verifyRecordedTree(recordedRoot, ALL_SECRETS)).toEqual([]);
    writeFileSync(good, readFileSync(good, 'utf8').replace('"price": 1', '"price": 2'));
    expect(verifyRecordedFile(good, recordedRoot, ALL_SECRETS).join()).toMatch(/content hash mismatch/);
    expect(verifyRecordedTree(recordedRoot, ALL_SECRETS)).toEqual([
      expect.stringMatching(/^searchapi\/_api_v1_search\/.*: .*content hash mismatch/),
    ]);
  });

  it('the committed fixtures tree is clean and the synthetic tree loads', () => {
    expect(scanFixtures(FIXTURES)).toEqual([]);
    expect(loadFixtureTree(join(FIXTURES, 'synthetic', 'fixture')).calendar.size).toBe(4);
  });

  it('no .raw.json file is tracked by git anywhere in the repository (sec-008)', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
      .split('\n')
      .filter((f) => f.endsWith('.raw.json'));
    expect(tracked).toEqual([]);
  });

  it('loaders refuse the wrong tree in both directions', () => {
    expect(() => loadFixtureTree(join(FIXTURES, 'recorded'))).toThrow(/fixtures\/synthetic\/fixture/);
    expect(() =>
      loadRecordedJson(
        join(FIXTURES, 'synthetic', 'fixture', 'calendar', 'LHR-JFK.json'),
        join(FIXTURES, 'recorded'),
      ),
    ).toThrow(/recorded root/);
  });
});
