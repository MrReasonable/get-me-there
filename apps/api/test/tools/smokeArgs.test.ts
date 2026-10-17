// Spec §9 item 7: the smoke's arguments, its one-tile query, its fixture target and the metro-rule check.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIata, asIsoDate } from '@gmt/core';
import { defaultRecordedRoot } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import {
  parseSmokeArgs,
  SMOKE_RECORDED_BY,
  smokeFixtureTarget,
  smokeQuery,
} from '../../src/tools/smokeArgs.js';
import { metroRuleCheck } from '../../src/tools/smokeChecks.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

describe('parseSmokeArgs', () => {
  it('reads both flag forms through the shared reader, upper-cases the airports and takes the two switches', () => {
    expect(
      parseSmokeArgs([
        '--origin',
        'lhr',
        '--destination=JFK',
        '--budget',
        '8',
        '--confirm-rerun',
        '--dry-run',
      ]),
    ).toEqual({
      ok: true,
      value: { args: { origin: 'LHR', destination: 'JFK', budget: 8 }, confirmRerun: true, dryRun: true },
    });
    expect(parseSmokeArgs(['--', '--origin', 'LHR', '--destination', 'JFK', '--budget', '4'])).toMatchObject({
      ok: true,
      value: { confirmRerun: false, dryRun: false },
    });
  });
  it.each([
    [[], '--origin and --destination are required'],
    [['--origin', 'LHR', '--budget', '4'], '--origin and --destination are required'],
    [['--origin', 'L1R', '--destination', 'JFK', '--budget', '4'], '--origin and --destination are required'],
    [['--origin', 'LHR', '--destination', 'JFK'], '--budget is required'],
    [['--origin', 'LHR', '--destination', 'JFK', '--budget', '0'], '--budget must be a positive integer'],
    [['--origin', 'LHR', '--origin', 'LGW'], '--origin is given twice'],
    [['--month', '2027-03'], 'unknown flag --month'],
    [['LHR'], 'unexpected argument LHR'],
    [['--origin'], '--origin needs a value'],
  ])('refuses %j with a usage line', (argv, message) => {
    const r = parseSmokeArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(message);
      expect(r.message).toContain('usage: pnpm smoke:live');
    }
  });
});

describe('smokeQuery: one Travelpayouts month tile and one 9 × 20 SearchApi rectangle', () => {
  it.each([
    ['2026-10-14', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-01-31', '2028-02-01'],
    ['2026-11-01', '2026-12-01'],
  ])('today %s → departures from %s, nine days inside one month, 10–21 nights', (today, from) => {
    const q = smokeQuery(asIsoDate(today), asIata('LHR'), asIata('JFK'));
    expect(q.departureFrom).toBe(from);
    expect(q.departureTo).toBe(`${from.slice(0, 8)}09`);
    expect([q.minNights, q.maxNights, q.cabin, q.currency]).toEqual([10, 21, 'economy', 'GBP']);
  });
});

describe('smokeFixtureTarget (plan decision 61)', () => {
  it('writes beside the database under the smoke signature', () => {
    expect(smokeFixtureTarget('/srv/data/app.db', '/repo/packages/providers/fixtures/recorded')).toEqual({
      root: '/srv/data/smoke/fixtures/recorded',
      recordedBy: SMOKE_RECORDED_BY,
    });
  });
  it('never inside the repository recorded tree', () => {
    const r = smokeFixtureTarget(join(defaultRecordedRoot(), 'searchapi', 'dev.db'));
    expect('refusal' in r && r.refusal).toContain("would put the smoke's fixtures in the recorded tree");
  });
});

describe('metroRuleCheck (plan decision 34): every request on both vendors names the airports', () => {
  const q = { origin: asIata('LHR'), destination: asIata('JFK') };
  const tp = (o: string) => ({
    providerId: 'travelpayouts',
    url: new URL(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=${o}&destination=JFK`),
  });
  const sa = (d: string) => ({
    providerId: 'searchapi',
    url: new URL(
      `https://www.searchapi.io/api/v1/search?engine=google_flights&departure_id=LHR&arrival_id=${d}`,
    ),
  });
  it('passes when every request names the airports, fails on a city code on either vendor (positive controls), skips on none', () => {
    expect(metroRuleCheck(q, [tp('LHR'), sa('JFK')]).status).toBe('pass');
    expect(metroRuleCheck(q, [tp('LHR'), tp('LON')])).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('1 named another code'),
    });
    expect(metroRuleCheck(q, [sa('NYC')]).status).toBe('fail');
    expect(metroRuleCheck(q, []).status).toBe('skip');
  });
});

describe('smoke recordings stay out of git wherever the database lives (plan decision 61)', () => {
  it.each([
    'data/smoke/fixtures/recorded/searchapi/_api_v1_search/2027-02-10-0123456789ab.json',
    'smoke/fixtures/recorded/travelpayouts/_aviasales_v3_prices_for_dates/2027-02-10-0123456789ab.json',
  ])('%s is ignored', (p) => {
    expect(spawnSync('git', ['check-ignore', '-q', p], { cwd: REPO }).status).toBe(0);
  });
});
