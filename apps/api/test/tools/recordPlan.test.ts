import { asIsoMonth } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  formatPlan,
  freeCallMisfit,
  monthAfter,
  parseRecordArgs,
  planCalls,
  planTotals,
  type RecordArgs,
  rectangle,
} from '../../src/tools/recordPlan.js';

const ROUTE = ['--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03'];

function args(budget = '5'): RecordArgs {
  const r = parseRecordArgs(['--budget', budget, ...ROUTE]);
  if (!r.ok) throw new Error(r.message);
  return r.value.args;
}

describe('parseRecordArgs refuses to run without an explicit budget (spec §9 item 7)', () => {
  it.each([
    [[...ROUTE], '--budget is required'],
    [['--budget', '0', ...ROUTE], 'positive integer'],
    [['--budget', '-3', ...ROUTE], 'positive integer'],
    [['--budget', 'ten', ...ROUTE], 'positive integer'],
    [['--budget', '12abc', ...ROUTE], 'positive integer'],
    [['--budget', '4', ...ROUTE], 'at least 5'],
    [['--budget', ...ROUTE], '--budget needs a value'],
    [['--budget', '5', '--budget', '6', ...ROUTE], '--budget is given twice'],
    [['--budget', '5', '--month', '2027-03'], '--route is required'],
    [['--budget', '5', '--route', 'LHR:LHR', '--month', '2027-03'], 'both origin and destination'],
    [['--budget', '5', '--route', 'LHR,LHR:JFK', '--month', '2027-03'], 'distinct three-letter codes'],
    [['--budget', '5', '--route', 'LHR', '--month', '2027-03'], 'O1,O2:D1,D2'],
    [['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-13'], '--month'],
    [['--budget', '5', ...ROUTE, '--bogus', '1'], 'unknown flag --bogus'],
    [['--budget', '5', ...ROUTE, '--metro', 'LON'], 'unknown flag --metro'],
    [['--budget', '5', ...ROUTE, 'stray'], 'unexpected argument stray'],
  ])('%j → %s', (argv, message) => {
    const r = parseRecordArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(message);
  });

  it('accepts lower-case codes, the --flag=value form, a pnpm "--" separator, --dry-run and --confirm-rerun', () => {
    expect(
      parseRecordArgs(['--', '--budget=5', '--route', 'lhr,lgw:jfk,ewr', '--month=2027-03', '--dry-run']),
    ).toEqual({
      ok: true,
      value: {
        args: { budget: 5, origins: ['LHR', 'LGW'], destinations: ['JFK', 'EWR'], month: '2027-03' },
        dryRun: true,
        confirmRerun: false,
        out: null,
      },
    });
    expect(
      parseRecordArgs(['--budget', '5', ...ROUTE, '--confirm-rerun', '--out', '/tmp/rec']),
    ).toMatchObject({
      ok: true,
      value: { dryRun: false, confirmRerun: true, out: '/tmp/rec' },
    });
  });
});

describe('date steps use core helpers (ts-011)', () => {
  it.each([
    ['2027-03', 0, '2027-03'],
    ['2027-03', 6, '2027-09'],
    ['2027-12', 1, '2028-01'],
    ['2027-03', 11, '2028-02'],
    ['2027-03', 12, '2028-03'],
    ['2028-01', 1, '2028-02'],
    ['2027-08', 12, '2028-08'],
  ])('monthAfter(%s, %i) = %s', (m, k, want) => {
    expect(monthAfter(asIsoMonth(m), k)).toBe(want);
  });
  it('monthAfter agrees with year·12 + month arithmetic for every start month of 2027–2028 and k = 0..12 (r2-ts-010)', () => {
    for (let y = 2027; y <= 2028; y++)
      for (let m = 1; m <= 12; m++)
        for (let k = 0; k <= 12; k++) {
          const idx = y * 12 + (m - 1) + k;
          const want = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
          expect(monthAfter(asIsoMonth(`${y}-${String(m).padStart(2, '0')}`), k), `${y}-${m} + ${k}`).toBe(
            want,
          );
        }
  });
  it('monthAfter refuses more than 12 months', () => {
    expect(() => monthAfter(asIsoMonth('2027-03'), 13)).toThrow(RangeError);
  });
  it.each([
    [
      '2027-03',
      {
        outFrom: '2027-03-01',
        outTo: '2027-03-09',
        retFrom: '2027-03-11',
        retTo: '2027-03-30',
        combinations: 180,
      },
    ],
    [
      '2028-02',
      {
        outFrom: '2028-02-01',
        outTo: '2028-02-09',
        retFrom: '2028-02-11',
        retTo: '2028-03-01',
        combinations: 180,
      },
    ],
    [
      '2027-02',
      {
        outFrom: '2027-02-01',
        outTo: '2027-02-09',
        retFrom: '2027-02-11',
        retTo: '2027-03-02',
        combinations: 180,
      },
    ],
    [
      '2027-12',
      {
        outFrom: '2027-12-01',
        outTo: '2027-12-09',
        retFrom: '2027-12-11',
        retTo: '2027-12-30',
        combinations: 180,
      },
    ],
  ])(
    'rectangle(%s) for the 10–21-night band is 9 × 20 = 180, the production tiling shape (spec §5.2, plan decision 29)',
    (m, want) => {
      expect(rectangle(asIsoMonth(m), 9, 20, 10)).toEqual(want);
    },
  );
  it('the over-limit rectangle is 9 × 24 = 216', () => {
    expect(rectangle(asIsoMonth('2027-03'), 9, 24, 10)).toEqual({
      outFrom: '2027-03-01',
      outTo: '2027-03-09',
      retFrom: '2027-03-11',
      retTo: '2027-04-03',
      combinations: 216,
    });
  });
});

describe('planCalls: the exact live call list of brief section 7', () => {
  it('with the shared metro LON: 20 Travelpayouts calls, 6 SearchApi calls, ≤5 credits (4 expected)', () => {
    const plan = planCalls(args(), 'LON');
    expect(plan.map((c) => c.id)).toEqual([
      ...Array.from({ length: 20 }, (_, i) => `TP-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 6 }, (_, i) => `SA-${String(i + 1).padStart(2, '0')}`),
    ]);
    expect(plan.map((c) => c.label)).toEqual([
      'travelpayouts prices_for_dates LON→JFK 2027-03 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-03 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-04 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-04 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-05 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-05 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-06 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-06 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-07 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-07 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-08 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-08 (metro)',
      'travelpayouts prices_for_dates LON→JFK 2027-09 (metro)',
      'travelpayouts prices_for_dates LON→EWR 2027-09 (metro)',
      'travelpayouts prices_for_dates LHR→JFK 2027-03 (airport)',
      'travelpayouts prices_for_dates LHR→EWR 2027-03 (airport)',
      'travelpayouts prices_for_dates LGW→JFK 2027-03 (airport)',
      'travelpayouts prices_for_dates LGW→EWR 2027-03 (airport)',
      'travelpayouts prices_for_dates LON→JFK 2028-02 (empty-probe)',
      'travelpayouts prices_for_dates LON→JFK 2028-03 with an invalid token (401 body)',
      'searchapi google_flights step 1 LHR→JFK 2027-03-10/2027-03-31 with an invalid key (401 body)',
      'searchapi google_flights_calendar LHR→JFK out 2027-03-01..2027-03-09 × ret 2027-03-11..2027-03-30 (180)',
      'searchapi google_flights_calendar LHR→JFK out 2027-03-01..2027-03-09 × ret 2027-03-11..2027-04-03 (216) over the limit (400, or an empty 200 per the docs)',
      'searchapi google_flights step 1 LHR→JFK, cheapest priced in-band cell of SA-02',
      'searchapi google_flights step 2, departure_token of the cheapest priced step-1 option',
      'searchapi google_flights step 3, booking_token of the cheapest priced step-2 option',
    ]);
    expect(plan.filter((c) => !c.required).map((c) => c.id)).toEqual(['TP-19']);
    expect(planTotals(plan)).toEqual({
      saCalls: 6,
      worstCaseCredits: 5,
      expectedCredits: 4,
      freeCalls: 20,
      worstCaseFreeCalls: 58,
    });
    const lines = formatPlan(plan);
    expect(lines[19]).toContain('Travelpayouts 1 (running 20)');
    expect(lines[20]).toContain('SearchApi ≤0 (running ≤0)');
    expect(lines[25]).toContain('SearchApi ≤1 (running ≤5)');
    expect(lines[26]).toBe(
      'total: SearchApi 6 calls, ≤5 credits (4 expected); Travelpayouts 20 free calls, ≤58 with up to 3 pages per tile',
    );
  });

  it('no error probe sends the same credential-free request as a success call (prov-wp04b-004, decision 20)', () => {
    for (const metro of ['LON', null]) {
      const plan = planCalls(args(), metro);
      const key = (c: (typeof plan)[number]): string =>
        JSON.stringify(
          c.spec.kind.startsWith('sa-') && 'cell' in c.spec
            ? c.spec.cell
            : 'month' in c.spec
              ? [c.spec.origin, c.spec.destination, c.spec.month]
              : c.id,
        );
      const probes = plan.filter((c) => c.spec.kind === 'tp-auth' || c.spec.kind === 'sa-auth').map(key);
      const others = plan.filter((c) => c.spec.kind !== 'tp-auth' && c.spec.kind !== 'sa-auth').map(key);
      for (const p of probes) expect(others).not.toContain(p);
      // why: the chain's cell comes from the calendar rectangle, so the 401 probe's cell must lie outside it (r2-ts-008)
      const auth = plan.find((c) => c.spec.kind === 'sa-auth')?.spec;
      const cal = plan.find((c) => c.spec.kind === 'sa-calendar')?.spec;
      if (auth?.kind !== 'sa-auth' || cal?.kind !== 'sa-calendar')
        throw new Error('plan lacks the probe or the calendar');
      expect(auth.cell.departure > cal.rect.outTo).toBe(true);
      expect(auth.cell.return > cal.rect.retTo).toBe(true);
    }
  });

  it('without a shared metro: every origin airport for 7 months, no separate airport tiles, 30 free calls', () => {
    const plan = planCalls(args(), null);
    expect(plan.filter((c) => c.spec.kind === 'tp-tile')).toHaveLength(2 * 2 * 7 + 1);
    expect(planTotals(plan).freeCalls).toBe(30);
  });

  it('freeCallMisfit compares the worst case (3 pages per tile) with the configured cap (ruling 13, cost-wp4b-r2-002)', () => {
    expect(freeCallMisfit(planCalls(args(), null), 88)).toBeNull();
    expect(freeCallMisfit(planCalls(args(), null), 87)).toContain(
      'the plan needs up to 88 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 87',
    );
  });
});
