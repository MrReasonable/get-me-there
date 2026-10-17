// Spec §9 item 7: the smoke, offline, against the vendor stand-ins (test/helpers/smokeVendors.ts) through the
// real adapters, http-kit, recorder and SqliteBudgetGuard. The run against the vendors is an operator step (WP13 Task 13.8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  BANNED_WORD_ALLOWLIST,
  type DiscoveryTileResult,
  findBannedWords,
  fixedClock,
  type Provenance,
} from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { describe, expect, it } from 'vitest';
import {
  type Discovery,
  runSmoke,
  type SmokeCli,
  type SmokeProviderReport,
  type SmokeResult,
  smokeQuery,
  type Vendor,
} from '../../src/tools/smoke.js';
import { type ChecklistInput, checklist, type Seen, type SmokeCheck } from '../../src/tools/smokeChecks.js';
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
const billed = (ports: Ports, r: SmokeResult): number =>
  ports.budget.usage({ kind: 'execution-calls', executionId: r.executionId ?? '' }).calls;

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

  it('2: no provider configured, nothing sent, no execution', async () => {
    const ports = smokePorts({ TRAVELPAYOUTS_TOKEN: '', SEARCHAPI_KEY: '' });
    const { r, urls } = await smoke(ports);
    expect(r.exitCode).toBe(EXIT.smokeNoProviders);
    expect(r.lines).toEqual(['no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY']);
    expect([urls, r.executionId]).toEqual([[], null]);
  });

  it.each([
    ['LON', 'JFK', 'LON is a city code; the smoke takes one airport'],
    ['QQQ', 'JFK', 'unknown airport QQQ'],
    ['LHR', 'LHR', 'origin and destination must differ'],
  ])('64: %s→%s is refused before anything is sent', async (o, d, message) => {
    const ports = smokePorts();
    const { r, urls } = await smoke(ports, cli(4, false, asIata(o), asIata(d)));
    expect(r.exitCode).toBe(EXIT.usage);
    expect(r.summary).toContain(message);
    expect(urls).toEqual([]);
  });

  it('65: the same cross-run rule as recording; a higher --budget lifts it, --confirm-rerun too', async () => {
    const ports = smokePorts();
    const short = await smoke(ports, cli(3));
    expect(short.r.exitCode).toBe(EXIT.spendRefused);
    expect(short.urls).toEqual([]);
    expect((await smoke(ports, cli(4))).r.exitCode).toBe(EXIT.ok);
    // why: the first run ledgered 4 credits to a tool execution; 4 + 4 > 4
    const again = await smoke(ports, cli(4));
    expect(again.r.exitCode).toBe(EXIT.spendRefused);
    expect(again.r.summary).toContain('raise --budget only if you mean to spend more');
    // why: the route returns these lines in its body, so spec §11's banned words apply to them too
    for (const l of again.r.lines) expect(findBannedWords(l, BANNED_WORD_ALLOWLIST), l).toEqual([]);
    expect((await smoke(ports, cli(8))).r.exitCode).toBe(EXIT.ok);
    expect((await smoke(ports, cli(4, true))).r.exitCode).toBe(EXIT.ok);
  });

  it("the cap is frozen at min(--budget, worst case): --budget 3 --confirm-rerun lets the guard refuse the chain's last step before the fetch (decision 66, cost-wp4b-011)", async () => {
    const ports = smokePorts();
    const { r, urls } = await smoke(ports, cli(3, true));
    expect(urls.filter((u) => u.hostname === 'www.searchapi.io')).toHaveLength(3);
    expect(billed(ports, r)).toBe(3);
    expect(ports.repos.executions.get(r.executionId ?? '')?.snapshot.budget.maxCalls).toBe(3);
    expect(r.exitCode).toBe(EXIT.failed);
  });

  it('65: a SearchApi window with less room than the worst case refuses even with --confirm-rerun', async () => {
    const ports = smokePorts({ SEARCHAPI_PLAN: 'trial', SEARCHAPI_TRIAL_USED: '97' });
    const { r, urls } = await smoke(ports, cli(4, true));
    expect(r.exitCode).toBe(EXIT.spendRefused);
    expect(r.summary).toContain('the SearchApi window has room for');
    expect(urls).toEqual([]);
  });

  it('1: a SearchApi 401 is an error; Travelpayouts still prices, no chain credit is spent, the headline is a labelled calendar price', async () => {
    const ports = smokePorts();
    const { r } = await smoke(ports, cli(), {
      failOn: (u) =>
        u.hostname === 'www.searchapi.io' ? { status: 401, body: { error: 'Invalid API key.' } } : undefined,
    });
    expect(r.exitCode).toBe(EXIT.failed);
    expect(r.reports.map((p) => [p.providerId, p.stage, p.status])).toEqual([
      ['travelpayouts', 'discovery', 'priced'],
      ['searchapi', 'discovery', 'error'],
      ['searchapi', 'itinerary', 'skipped'],
    ]);
    expect(r.reports[1]?.detail).toMatch(/^auth/);
    const sa = ports.repos.ledger
      .countsFor(r.executionId ?? '')
      .perProvider.filter((p) => p.providerId === 'searchapi');
    expect(sa.map((p) => [p.stage, p.calls])).toEqual([['discovery', 1]]);
    expect(r.summary).toBe(
      'cheapest calendar price £412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched just now · observed 10d ago · not checked by an itinerary search',
    );
  });

  it('1: step 2 showing another price than step 1 fails the check', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step2Price: 610 });
    expect(r.exitCode).toBe(EXIT.failed);
    expect(status(r)['step 1 = step 2']).toBe('fail');
    expect(r.lines.some((l) => l.includes('£603 at step 1, £610 at step 2'))).toBe(true);
  });

  it('an unconfirmed step-2 price is never "sold by": it names the airline and carries the decision-44 label', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step3Dearer: true });
    expect(lineOf(r, 'searchapi itinerary: priced')).toContain(
      "cheapest £603 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Google Flights via SearchApi, airline stated by the vendor: Synthetic Air One · fetched just now · vendor's cache age unknown · price not confirmed by the final step",
    );
    expect(r.summary.startsWith('cheapest confirmed price £650 ·')).toBe(true);
    expect(r.exitCode).toBe(EXIT.ok);
  });

  it('1: no seller listing at step 3: the sellers check fails and the headline falls back to the labelled calendar price', async () => {
    const { r } = await smoke(smokePorts(), cli(), { step3Empty: true });
    expect(status(r).sellers).toBe('fail');
    expect(r.summary.startsWith('cheapest calendar price £412 ·')).toBe(true);
    expect(r.exitCode).toBe(EXIT.failed);
  });

  it.each([
    ['a tile stopped at the page cap', { tpTruncated: true }, 'travelpayouts stopped at the page cap'],
    ['a row with an unusable price', { tpBadPrice: true }, 'travelpayouts 2027-03-02–2027-03-16 parse'],
  ] as const)(
    '1: %s fails "tiles read whole" (decision 30, prov-wp13-r1-003)',
    async (_label, vendors, detail) => {
      const { r } = await smoke(smokePorts(), cli(), vendors);
      expect(status(r)['tiles read whole']).toBe('fail');
      expect(r.checks.find((c) => c.name === 'tiles read whole')?.detail).toContain(detail);
      expect(r.exitCode).toBe(EXIT.failed);
    },
  );

  it('a truncated tile\'s cheapest reads "cheapest of the rows read" (decision 30)', async () => {
    const { r, urls } = await smoke(smokePorts(), cli(), { tpTruncated: true });
    expect(urls.filter((u) => u.hostname === 'api.travelpayouts.com')).toHaveLength(3);
    expect(lineOf(r, 'travelpayouts discovery: priced')).toContain('(cheapest of the rows read)');
  });

  it('3: no error, but the Travelpayouts tile held no price (Travelpayouts only: no credit)', async () => {
    const ports = smokePorts({ SEARCHAPI_KEY: '' });
    const { r, urls } = await smoke(ports, cli(1), { tpEmpty: true });
    expect(r.exitCode).toBe(EXIT.smokeEmpty);
    expect(r.reports.map((p) => p.status)).toEqual(['empty']);
    expect(r.reports[0]?.detail).toContain('no row in the Aviasales cache for these days');
    expect(r.summary).toBe('no price found');
    expect(urls.map((u) => u.hostname)).toEqual(['api.travelpayouts.com']);
  });

  it('0: a dry run prints the query, the frozen cap and the spend position, sends nothing and opens no execution (decision 66)', async () => {
    const ports = smokePorts();
    // why: --budget 3 is below the worst case, so a run that called the vendors would need --confirm-rerun; the dry run
    // still answers 0 and shows the cap the guard would freeze
    const { r, urls } = await smoke(ports, cli(3, false, LHR, JFK, true));
    expect([r.exitCode, r.summary, r.executionId]).toEqual([EXIT.ok, 'dry run: nothing sent', null]);
    expect(urls).toEqual([]);
    expect(r.fixturesWritten).toEqual([]);
    expect(r.lines).toContain(
      'this run: at most 4 SearchApi credit(s), frozen at 3 by --budget 3; at most 3 free Travelpayouts call(s)',
    );
    expect(r.lines.some((l) => l.includes('(a run that calls the vendors needs --confirm-rerun)'))).toBe(
      true,
    );
    expect(r.lines.at(-1)).toBe('dry run: nothing sent, no execution opened');
    expect(ports.repos.executions.listByStatus(['running', 'completed', 'cancelled'])).toEqual([]);
  });
});

/**
 * Negative controls for the checklist's FAIL branches (provenance review, fix round 1): a vendor answer cannot be made
 * to break these through the real adapters, so each case hands `checklist` the inputs a dishonest answer would produce
 * on top of one real run's ledger. Every case asserts `fail`; each was shown to pass vacuously under a mutation that
 * turns its branch into `pass`.
 */
describe('checklist FAIL branches (negative controls)', () => {
  async function base(): Promise<{ ports: Ports; input: ChecklistInput; tp: SmokeProviderReport }> {
    const ports = smokePorts();
    const { r } = await smoke(ports);
    const tp = r.reports[0];
    if (tp === undefined || tp.cheapest === null) throw new Error('the base run priced no Travelpayouts row');
    const input: ChecklistInput = {
      ports,
      q: smokeQuery(asIsoDate('2027-02-10'), LHR, JFK),
      executionId: r.executionId ?? '',
      runStart: NOW,
      cap: 4,
      configured: ['travelpayouts'],
      found: new Map(),
      itinerary: null,
      seen: [],
    };
    return { ports, input, tp };
  }
  const check = (checks: SmokeCheck[], name: string): SmokeCheck | undefined =>
    checks.find((c) => c.name === name);
  /** The base run's Travelpayouts report with its cheapest price's provenance patched. */
  function withProvenance(tp: SmokeProviderReport, patch: Partial<Provenance>): Map<Vendor, Discovery> {
    const cheapest = tp.cheapest;
    if (cheapest === null) throw new Error('no cheapest');
    return new Map([
      [
        'travelpayouts',
        {
          report: { ...tp, cheapest: { ...cheapest, provenance: { ...cheapest.provenance, ...patch } } },
          plans: [],
          tile: null,
        },
      ],
    ]);
  }

  it.each([
    [
      'a synthetic source kind',
      { sourceKind: 'synthetic' },
      'source kind synthetic, expected authorised-cached',
    ],
    ['the wrong source kind for the stage', { sourceKind: 'scraped-search' }, 'source kind scraped-search'],
    [
      'a point of sale the provider does not declare',
      { pointOfSale: 'GB' },
      'point of sale GB, expected unknown',
    ],
    [
      'a fetch before this run',
      { fetchedAt: asIsoDateTime('2027-02-10T08:00:00.000Z') },
      'fetched before this run',
    ],
  ] as const)('provenance fails on %s', async (_label, patch, detail) => {
    const { input, tp } = await base();
    const c = check(checklist({ ...input, found: withProvenance(tp, patch) }), 'provenance');
    expect(c?.status).toBe('fail');
    expect(c?.detail).toContain(detail);
  });

  it('step 1 = step 2 fails when step 2 expanded another outbound than step 1 priced cheapest', async () => {
    const { input } = await base();
    const url = (extra: string) =>
      new URL(
        `https://www.searchapi.io/api/v1/search?engine=google_flights&departure_id=LHR&arrival_id=JFK${extra}`,
      );
    const seen: Seen[] = [
      {
        providerId: 'searchapi',
        tileIndex: null,
        url: url(''),
        body: {
          other_flights: [
            { price: 603, departure_token: 'DT-cheapest' },
            { price: 655, departure_token: 'DT-dearer' },
          ],
        },
      },
      {
        providerId: 'searchapi',
        tileIndex: null,
        url: url('&departure_token=DT-dearer'),
        body: { other_flights: [{ price: 603, booking_token: 'BT' }] },
      },
    ];
    const c = check(checklist({ ...input, seen }), 'step 1 = step 2');
    expect(c).toEqual({
      name: 'step 1 = step 2',
      status: 'fail',
      detail: 'step 2 expanded another outbound than step 1 priced cheapest',
    });
  });

  it('open-jaw drop fails when the issues count more rows than the tile dropped', async () => {
    const { input, tp } = await base();
    const cell = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2027-03-03'),
      returnDate: asIsoDate('2027-03-15'),
    };
    const tile: Extract<DiscoveryTileResult, { kind: 'tile' }> = {
      kind: 'tile',
      index: 0,
      coveredCells: [cell],
      fetchedAt: NOW,
      pointOfSale: 'unknown',
      prices: [],
      noFares: [],
      notes: ['offers-dropped:1'],
      cellIssues: [
        {
          cell,
          reason: 'parse',
          offersDropped: 2,
          detail: 'travelpayouts: 2 rows were not the closed round trip LHR to JFK and back [open-jaw]',
        },
      ],
    };
    const found = new Map<Vendor, Discovery>([['travelpayouts', { report: tp, plans: [], tile }]]);
    const c = check(checklist({ ...input, found }), 'open-jaw drop');
    expect(c?.status).toBe('fail');
    expect(c?.detail).toContain('the issues count more rows than the tile dropped');
  });
});
