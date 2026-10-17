// Spec §9 item 7: the smoke, offline, against the vendor stand-ins (test/helpers/smokeVendors.ts) through the
// real adapters, http-kit, recorder and SqliteBudgetGuard. The run against the vendors is an operator step (WP13 Task 13.8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDateTime, BANNED_WORD_ALLOWLIST, findBannedWords, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import { runSmoke, type SmokeCli, type SmokeResult } from '../../src/tools/smoke.js';
import { EXIT } from '../../src/tools/types.js';
import { buildPorts, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, testEnv } from '../helpers/env.js';
import { type SmokeVendorOptions, stubSmokeVendors } from '../helpers/smokeVendors.js';
import { onCleanup, tempRecordedRoot } from '../helpers/tmp.js';

/** The smoke's clock: a February day, so the query is the first nine days of March 2027. */
const NOW = asIsoDateTime('2027-02-10T09:00:00.000Z');
const LHR = asIata('LHR');
const JFK = asIata('JFK');
const TEST_SMOKE_BY = '@gmt/api smoke:live (test)';

function smokePorts(env: Record<string, string> = {}): Ports {
  const ports = buildPorts(loadConfigFromEnv(testEnv(env)), {
    log: silentLog,
    clock: fixedClock(NOW),
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => ports.db.close());
  seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  return ports;
}

const cli = (
  budget = 4,
  confirmRerun = false,
  origin = LHR,
  destination = JFK,
  dryRun = false,
): SmokeCli => ({
  args: { origin, destination, budget },
  confirmRerun,
  dryRun,
});

async function smoke(
  ports: Ports,
  c: SmokeCli = cli(),
  vendors: SmokeVendorOptions = {},
): Promise<{ r: SmokeResult; root: string; urls: URL[] }> {
  const log = stubSmokeVendors(vendors);
  const { root } = tempRecordedRoot();
  const r = await runSmoke(ports, c, {
    signal: new AbortController().signal,
    fixtures: { root, recordedBy: TEST_SMOKE_BY },
  });
  return { r, root, urls: log.urls };
}

const status = (r: SmokeResult) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
const lineOf = (r: SmokeResult, start: string): string => r.lines.find((l) => l.startsWith(start)) ?? '';

describe('runSmoke (spec §9 item 7)', () => {
  it('exits 0 with provenance: one tile per provider, one chain, the confirmed price as headline, every check passed, dated fixtures outside the recorded tree', async () => {
    const ports = smokePorts();
    const { r, root, urls } = await smoke(ports);

    expect(r.exitCode).toBe(EXIT.ok);
    expect(r.reports.map((p) => [p.providerId, p.stage, p.status])).toEqual([
      ['travelpayouts', 'discovery', 'priced'],
      ['searchapi', 'discovery', 'priced'],
      ['searchapi', 'itinerary', 'priced'],
    ]);
    expect(status(r)).toEqual({
      'one tile per provider': 'pass',
      'tiles read whole': 'pass',
      ledger: 'pass',
      provenance: 'pass',
      'age labels': 'look',
      'airport pairs (metro rule)': 'pass',
      'open-jaw drop': 'look',
      '9-day rectangle': 'pass',
      'step 1 = step 2': 'pass',
      sellers: 'pass',
      'route history': 'look',
      'separate tickets excluded': 'look',
    });
    expect(r.lines).toContain(
      '  [look] route history: 2 point(s) from 2027-02-10 to 2027-02-20, lowest £610',
    );
    // why: decision 66: the headline is the cheapest price a seller listing confirmed (the agent's £573 at step 3)
    expect(r.summary).toBe(
      "cheapest confirmed price £573 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Google Flights via SearchApi, sold by Synthetic Travel Agent · fetched just now · vendor's cache age unknown",
    );
    expect(r.lines).toContain(r.summary);
    // why: Travelpayouts' £412 row is its cheapest; the £377 row flew back to another airport and was dropped (decision 39)
    expect(lineOf(r, 'travelpayouts discovery: priced')).toContain(
      'cheapest £412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · observed 10d ago',
    );
    expect(r.lines).toContain(
      '  [look] open-jaw drop: 1 open-jaw row(s) dropped in 1 cell(s) (2027-03-03–2027-03-15); 1 row(s) dropped in all',
    );
    expect(r.lines.some((l) => l.includes('£603 at step 1, £603 at step 2'))).toBe(true);
    expect(
      r.lines.some((l) => l.includes('SearchApi credits counted by the guard 4 of the frozen cap 4')),
    ).toBe(true);
    // one Travelpayouts page, one calendar rectangle, step 1, step 2, step 3: five requests, five dated files
    expect(urls).toHaveLength(5);
    expect(r.fixturesWritten).toHaveLength(5);
    expect(r.fixturesWritten.every((f) => /^(travelpayouts|searchapi)\//.test(f))).toBe(true);
    const counts = ports.repos.ledger.countsFor(r.executionId ?? '');
    expect(counts.perProvider.map((p) => [p.providerId, p.stage, p.tiles, p.calls, p.cacheHits])).toEqual([
      ['searchapi', 'discovery', 1, 1, 0],
      ['searchapi', 'verification', 0, 3, 0],
      ['travelpayouts', 'discovery', 1, 1, 0],
    ]);
    const ex = ports.repos.executions.get(r.executionId ?? '');
    expect([ex?.trigger, ex?.status, ex?.errorText]).toEqual(['tool', 'completed', null]);
    // why: the stored estimate is the stated worst case, so ledger-vs-estimate parity holds (cost-wp4b-010)
    expect(ex?.estimate?.perProvider.map((l) => [l.providerId, l.stage, l.calls])).toEqual([
      ['travelpayouts', 'discovery', 3],
      ['searchapi', 'discovery', 1],
      ['searchapi', 'verification', 3],
    ]);
    expect(ex?.snapshot.budget.maxCalls).toBe(4);
    const everything = [
      ...r.lines,
      ...r.fixturesWritten.map((f) => readFileSync(join(root, f), 'utf8')),
    ].join('\n');
    for (const s of [SENTINEL_SA, SENTINEL_TP]) expect(everything).not.toContain(s);
    for (const l of r.lines) expect(findBannedWords(l, BANNED_WORD_ALLOWLIST), l).toEqual([]);
  });
});
