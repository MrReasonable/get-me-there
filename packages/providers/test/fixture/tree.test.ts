import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultFixtureRoot, loadFixtureTree } from '../../src/fixture/tree.js';
import {
  createRecorder,
  loadRecordedFixture,
  loadRecordedJson,
  withContentHash,
} from '../../src/http/recorder.js';
import { containsSecret } from '../../src/http/scrub.js';
import { loadParamsAllowlist } from '../../src/params/allowlist.js';
import { isRecord } from '../../src/util.js';
import { ALL_SECRETS, req, SEARCH, SENTINELS } from '../fakes.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
// why: a recording's request must target its provider's real host (prov-003 cross-check); vendor hosts, not airports.
const PROVIDER_HOST: Record<string, string> = {
  searchapi: 'www.searchapi.io',
  travelpayouts: 'api.travelpayouts.com',
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/** Every problem in a fixtures root (spec §9 item 2 fixture-tree rules); empty means clean. */
function scanFixtures(root: string): string[] {
  const problems: string[] = [];
  const recordedRoot = join(root, 'recorded');
  const files = walk(root).filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('.raw.json'));
  for (const f of files) {
    const rel = relative(root, f);
    const fail = (why: string): void => {
      problems.push(`${rel}: ${why}`);
    };
    if (!f.endsWith('.json')) {
      fail('not a JSON file');
      continue;
    }
    const text = readFileSync(f, 'utf8');
    if (containsSecret(text, ALL_SECRETS)) fail('holds a sentinel');
    const parsed: unknown = JSON.parse(text);
    if (rel.startsWith(`synthetic${sep}fixture${sep}`)) {
      if (!isRecord(parsed) || parsed.synthetic !== true) fail('synthetic file without "synthetic": true');
      else if ('recordedAt' in parsed || 'contentSha256' in parsed)
        fail('synthetic file with recording fields');
    } else if (rel.startsWith(`recorded${sep}`)) {
      try {
        if (rel.split(sep).at(-1)?.startsWith('params-')) loadParamsAllowlist(f, recordedRoot);
        else {
          const rec = loadRecordedFixture(f, recordedRoot);
          if (new URL(rec.request.url).hostname !== PROVIDER_HOST[rec.providerId])
            fail(`request host is not ${rec.providerId}'s`);
        }
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    } else fail('outside synthetic/fixture and recorded');
  }
  return problems;
}

describe('fixture-tree scan (spec §9 item 2: every committed fixture scanned)', () => {
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
    expect(problems.some((p) => p.includes('AAA-CCC.json') && p.endsWith('holds a sentinel'))).toBe(true);
    expect(problems.some((p) => p.includes('notes.txt') && p.endsWith('not a JSON file'))).toBe(true);
    expect(
      problems.some(
        (p) => p.includes(relative(root, wrongHost)) && p.endsWith("request host is not searchapi's"),
      ),
    ).toBe(true);
    expect(problems.some((p) => p.includes(relative(root, good)))).toBe(false);
    expect(problems.some((p) => p.includes('params-2026-10-14.json'))).toBe(false);
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
