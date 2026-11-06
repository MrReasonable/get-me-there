import type { ProviderId, Stage } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { EstimateResponse } from '../../../../src/api/types.js';
import { ESTIMATE_COPY } from '../../../../src/copy/estimate.js';
import { COPY } from '../../../../src/copy.js';
import {
  aboutDuration,
  estimateSentence,
  plainDuration,
} from '../../../../src/views/Searches/estimateLine.js';
import { estimate, estimateResponse } from '../../../fixtures.js';

// Spec rev 55 §11 "The estimate sentence" (WP20 Task 20.5): one sentence beside Search now, built from the estimate
// response's figures and codes (rulings A22, A31; po-011; prov-int-014; 20.4 minor 7). Pure: ESTIMATE_COPY is passed in, and the
// money formatter is stubbed so the test sees exactly the amounts the sentence asks it for.

const money = (p: number) => `£${(p / 100).toFixed(2)}`;

interface Line {
  providerId: ProviderId;
  stage?: Stage;
  calls?: number;
  costMicroGbp?: number;
  blocked?: string | null;
}

/** An estimate response of the given lines and date-pair figures; every figure not named is the quiet default. */
function resp(o: {
  seconds?: number;
  lines?: Line[];
  datePairs?: number;
  covered?: number;
  partly?: number;
  reused?: number;
  billed?: EstimateResponse['billedCalls'];
  softConfirm?: EstimateResponse['softConfirm'];
  flightLists?: {
    pages: number;
    seconds: number;
    pairs?: number;
    returns?: boolean;
    pagesMax?: number;
    secondsMax?: number;
  };
}): EstimateResponse {
  const lines = (o.lines ?? [{ providerId: 'camoufox' }]).map((l) => ({
    providerId: l.providerId,
    stage: l.stage ?? 'discovery',
    calls: l.calls ?? 100,
    planCalls: l.calls ?? 100,
    costMicroGbp: l.costMicroGbp ?? 0,
    costPence: Math.ceil((l.costMicroGbp ?? 0) / 10_000),
    seconds: o.seconds ?? 9000,
    blocked: l.blocked ?? null,
  }));
  const runs = lines.filter((l) => l.blocked === null);
  const micro = runs.reduce((a, l) => a + l.costMicroGbp, 0);
  return estimateResponse({
    estimate: estimate({
      perProvider: lines,
      totalCalls: runs.reduce((a, l) => a + l.calls, 0),
      totalPlanCalls: runs.reduce((a, l) => a + l.planCalls, 0),
      totalCostMicroGbp: micro,
      totalCostPence: Math.ceil(micro / 10_000),
      seconds: o.seconds ?? 9000,
      ...(o.flightLists === undefined ? {} : { flightLists: o.flightLists }),
    }),
    datePairs: o.datePairs ?? 405,
    datePairsCovered: o.covered ?? 405,
    datePairsPartly: o.partly ?? 0,
    datePairsReused: o.reused ?? 0,
    softConfirm: o.softConfirm ?? null,
    billedCalls: o.billed ?? [],
  });
}

const sentence = (e: EstimateResponse, cron: string | null = null) =>
  estimateSentence(e, cron === null ? null : { cron, tz: 'Europe/London' }, ESTIMATE_COPY, money);

const paid = { providerId: 'searchapi', costMicroGbp: 1_200_000, calls: 300 } satisfies Line;

describe('estimateSentence: the line', () => {
  it('a free run asking every date pair: "About 2½ hours · free · asks about all 405 date pairs"', () => {
    const s = sentence(resp({ seconds: 9000 }));
    expect(s.line).toBe('About 2½ hours · free · asks about all 405 date pairs');
    expect(s.button).toBe('Search now');
    expect(s.notes).toEqual([]);
  });

  it('a paid run asking part of the space now, unscheduled: the rest when you search again (po-011)', () => {
    const s = sentence(resp({ seconds: 10_800, lines: [paid], covered: 300 }));
    expect(s.line).toBe(
      'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest when you search again',
    );
    expect(s.button).toBe('Search now · about £1.20');
  });

  it('the same on a search repeating on Mondays: the rest next Monday', () => {
    const s = sentence(resp({ seconds: 10_800, lines: [paid], covered: 300 }), '0 5 * * 1');
    expect(s.line).toBe(
      'About 3 hours · about £1.20 · asks about 300 of 405 date pairs this run, the rest next Monday',
    );
  });

  it('a schedule of several days, every day or a custom cron: the rest at the next scheduled run', () => {
    for (const cron of ['0 5 * * 1,4', '0 5 * * *', '*/5 * * * *'])
      expect(sentence(resp({ covered: 300 }), cron).line).toMatch(/, the rest at the next scheduled run$/);
  });

  it('date pairs asked on some airports only are counted as asked and said so', () => {
    expect(sentence(resp({ covered: 300, partly: 20 })).line).toBe(
      'About 2½ hours · free · asks about 320 of 405 date pairs this run (20 on some airports only), the rest when you search again',
    );
  });

  it('reused date pairs are worded beside the ones still asked, honestly (20.4 minor 7)', () => {
    expect(sentence(resp({ covered: 300, reused: 105 })).line).toBe(
      'About 2½ hours · free · asks about 300 of 405 date pairs (105 reused from earlier runs)',
    );
    expect(sentence(resp({ covered: 200, reused: 105 })).line).toBe(
      'About 2½ hours · free · asks about 200 of 405 date pairs this run (105 reused from earlier runs), the rest when you search again',
    );
  });

  it('nothing asked and everything reused: "Nothing new to ask: 405 date pairs reused from earlier runs"', () => {
    expect(sentence(resp({ covered: 0, reused: 405 })).line).toBe(
      'Nothing new to ask: 405 date pairs reused from earlier runs',
    );
  });

  it('nothing new to ask while the run still spends keeps the duration, the cost and the calls (fix round 1, finding 7)', () => {
    const s = sentence(
      resp({
        covered: 0,
        reused: 405,
        lines: [{ providerId: 'searchapi', stage: 'verification', calls: 100, costMicroGbp: 1_200_000 }],
        billed: [{ providerId: 'searchapi', calls: 100, left: 9880, window: 'month' }],
      }),
    );
    expect(s.line).toBe(
      'Nothing new to ask: 405 date pairs reused from earlier runs · about 2½ hours · about £1.20 · uses about 100 of the 9,880 SearchApi searches left this month',
    );
    expect(s.button).toBe('Search now · about £1.20');
    const calls = sentence(
      resp({
        covered: 0,
        reused: 405,
        lines: [{ providerId: 'searchapi', stage: 'verification', calls: 100 }],
        billed: [{ providerId: 'searchapi', calls: 100, left: null, window: 'month' }],
      }),
    );
    expect(calls.line).toBe(
      'Nothing new to ask: 405 date pairs reused from earlier runs · about 2½ hours · uses about 100 SearchApi searches',
    );
    // a cost alone, with no billed-plan calls named, is spending too
    expect(
      sentence(
        resp({
          covered: 0,
          reused: 405,
          lines: [{ providerId: 'searchapi', stage: 'verification', calls: 100, costMicroGbp: 1_200_000 }],
        }),
      ).line,
    ).toBe('Nothing new to ask: 405 date pairs reused from earlier runs · about 2½ hours · about £1.20');
  });

  it('nothing asked and nothing reused says nothing can be asked this run', () => {
    expect(sentence(resp({ covered: 0, reused: 0 })).line).toBe('Nothing can be asked this run');
  });

  it('the Aviasales cache as the only source used ends the line with the cached-prices caveat (prov-int-014)', () => {
    expect(sentence(resp({ lines: [{ providerId: 'travelpayouts' }] })).line).toBe(
      'About 2½ hours · free · asks about all 405 date pairs · cached prices only where travellers searched recently',
    );
    // a second source that also reaches the date pairs lifts the caveat; a blocked one does not
    expect(
      sentence(resp({ lines: [{ providerId: 'travelpayouts' }, { providerId: 'camoufox' }] })).line,
    ).not.toMatch(/cached prices only/);
    expect(
      sentence(
        resp({
          lines: [{ providerId: 'travelpayouts' }, { providerId: 'camoufox', blocked: 'provider-execution' }],
        }),
      ).line,
    ).toMatch(/cached prices only where travellers searched recently$/);
  });

  it('capped calls on a billable plan are named, and the run is never "free" (cost-003)', () => {
    const s = sentence(
      resp({
        lines: [{ providerId: 'searchapi', calls: 120, costMicroGbp: 0 }],
        billed: [{ providerId: 'searchapi', calls: 120, left: 9880, window: 'month' }],
      }),
    );
    expect(s.line).toBe(
      'About 2½ hours · asks about all 405 date pairs · uses about 120 of the 9,880 SearchApi searches left this month',
    );
    expect(s.line).not.toMatch(/free/);
    expect(s.button).toBe('Search now · 120 SearchApi searches');
  });

  it('on the trial, whose balance is one-off, the calls left are the trial’s', () => {
    expect(
      sentence(
        resp({
          lines: [{ providerId: 'searchapi', calls: 12 }],
          billed: [{ providerId: 'searchapi', calls: 12, left: 91, window: 'lifetime' }],
        }),
      ).line,
    ).toMatch(/· uses about 12 of the 91 SearchApi searches left on your trial$/);
  });

  it('a billable plan without a cap names the calls alone; a paid run’s button carries the money, not the calls', () => {
    const s = sentence(
      resp({
        lines: [paid],
        billed: [{ providerId: 'searchapi', calls: 300, left: null, window: 'month' }],
      }),
    );
    expect(s.line).toMatch(/· about £1\.20 · .* · uses about 300 SearchApi searches$/);
    expect(s.button).toBe('Search now · about £1.20');
  });

  it('the duration is capitalised at the start of the line, and a blocked line costs nothing in it', () => {
    expect(sentence(resp({ seconds: 720 })).line).toMatch(/^About 12 minutes · /);
    expect(sentence(resp({ seconds: 30 })).line).toMatch(/^Under a minute · /);
    const s = sentence(
      resp({
        lines: [{ providerId: 'camoufox' }, { ...paid, blocked: 'provider-month' }],
      }),
    );
    expect(s.line).toMatch(/· free ·/);
    expect(s.button).toBe('Search now');
  });

  it('the line never words the coverage as prices found', () => {
    const lines = [
      sentence(resp({})).line,
      sentence(resp({ covered: 300, partly: 20, reused: 50 })).line,
      sentence(resp({ covered: 0, reused: 405 })).line,
      sentence(resp({ lines: [{ providerId: 'travelpayouts' }] })).line,
    ];
    for (const l of lines)
      for (const banned of ['priced', 'prices for', 'all combinations', 'will find'])
        expect(l).not.toContain(banned);
  });

  it('the press verb comes from the caller, on the button and in the confirmation note', () => {
    const s = estimateSentence(
      resp({
        lines: [paid],
        softConfirm: { reason: 'cost', estimatePence: 120, thresholdPence: 100 },
      }),
      null,
      ESTIMATE_COPY,
      money,
      COPY.searchAgain.label,
    );
    expect(s.button).toBe('Search again · about £1.20');
    expect(s.notes).toContain(
      'This costs about £1.20, above your £1.00 check; pressing Search again confirms it',
    );
  });
});

describe('estimateSentence: the edges of each clause', () => {
  it('a schedule with no cron is no schedule: the rest when you search again', () => {
    expect(
      estimateSentence(resp({ covered: 300 }), { cron: null, tz: 'Europe/London' }, ESTIMATE_COPY, money)
        .line,
    ).toMatch(/, the rest when you search again$/);
  });

  it('date pairs asked on some airports alone are still asked: the line keeps its duration and cost', () => {
    expect(sentence(resp({ covered: 20, partly: 20 })).line).toBe(
      'About 2½ hours · free · asks about 40 of 405 date pairs this run (20 on some airports only), the rest when you search again',
    );
  });

  it('a billable source that makes no call this run leaves the run free and names no searches', () => {
    const s = sentence(
      resp({ billed: [{ providerId: 'searchapi', calls: 0, left: 9880, window: 'month' }] }),
    );
    expect(s.line).toBe('About 2½ hours · free · asks about all 405 date pairs');
    expect(s.button).toBe('Search now');
  });

  it('only the first pass reaches the date pairs: a source checking fares does not lift the cached-prices caveat', () => {
    expect(
      sentence(
        resp({
          lines: [{ providerId: 'travelpayouts' }, { providerId: 'searchapi', stage: 'verification' }],
        }),
      ).line,
    ).toMatch(/· cached prices only where travellers searched recently$/);
  });
});

describe('estimateSentence: the notes under it', () => {
  // why: ruling 20.5 concern 2 (Task 20.9): the flight-list step's pages, worded from Estimate.flightLists
  it('the browser worker reading flights adds "+ flights for up to 10 date pairs, about 12 minutes"', () => {
    const line = sentence(resp({ flightLists: { pages: 10, seconds: 700 } })).line;
    expect(line).toBe(
      'About 2½ hours · free · asks about all 405 date pairs · + flights for up to 10 date pairs, about 12 minutes',
    );
    expect(sentence(resp({ flightLists: { pages: 1, seconds: 30 } })).line).toContain(
      '+ flights for up to 1 date pair, under a minute',
    );
  });

  // why: spec rev 56 §8.1 "Estimate" (R-estimate): the date pairs and the pages are two figures; out and back states
  // the typical pages and minutes and the bound
  it('out and back: "+ flights, out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at most 20 pages and 50 minutes"', () => {
    const e = resp({
      flightLists: { pairs: 10, pages: 15, seconds: 2450, pagesMax: 20, secondsMax: 3000, returns: true },
    });
    expect(sentence(e).line).toBe(
      'About 2½ hours · free · asks about all 405 date pairs · + flights, out and back, for up to 10 date pairs: usually about 15 pages and 41 minutes, at most 20 pages and 50 minutes',
    );
    // one date pair out and back (21.7 code I1: a real one-pair plan, 2 pages at most): the singulars
    const one = resp({
      flightLists: { pairs: 1, pages: 2, seconds: 245, pagesMax: 2, secondsMax: 300, returns: true },
    });
    expect(sentence(one).line).toContain(
      '+ flights, out and back, for up to 1 date pair: usually about 2 pages and 4 minutes, at most 2 pages and 5 minutes',
    );
  });
  it('21.7 code I1: a plan the month cut to outbound-only (returns false, its bound kept) words no return leg', () => {
    // why: the engine's line with 1 page left: the plan reads returns where pages allow, none goes out and back
    const cut = resp({
      flightLists: { pairs: 1, pages: 1, seconds: 70, pagesMax: 1, secondsMax: 70, returns: false },
    });
    expect(sentence(cut).line).toContain('+ flights for up to 1 date pair, about 1 minute');
    expect(sentence(cut).line).not.toContain('out and back');
  });
  it('outbound only: "+ flights for up to 10 date pairs, about 12 minutes", the pairs from pairs, never the pages', () => {
    const e = resp({ flightLists: { pairs: 10, pages: 10, seconds: 700, returns: false } });
    expect(sentence(e).line).toContain('+ flights for up to 10 date pairs, about 12 minutes');
    // why: a plan of 6 pairs out and back that the month cut to 6 pages: the pairs are said, the pages are its own
    const fewer = resp({
      flightLists: { pairs: 6, pages: 9, seconds: 1470, pagesMax: 12, secondsMax: 1800, returns: true },
    });
    expect(sentence(fewer).line).toContain('for up to 6 date pairs: usually about 9 pages');
  });
  it('out and back with no bound stated (an older line) states the typical figures as the bound', () => {
    const e = resp({ flightLists: { pairs: 4, pages: 6, seconds: 980, returns: true } });
    expect(sentence(e).line).toContain(
      '+ flights, out and back, for up to 4 date pairs: usually about 6 pages and 16 minutes, at most 6 pages and 16 minutes',
    );
  });

  it('nothing new to ask keeps the flights clause: the browser worker still reads them (20.9 review finding 7)', () => {
    const e = resp({ covered: 0, reused: 405, flightLists: { pages: 10, seconds: 700 } });
    expect(sentence(e).line).toBe(
      'Nothing new to ask: 405 date pairs reused from earlier runs · + flights for up to 10 date pairs, about 12 minutes',
    );
  });

  it('no flight clause without flight pages', () => {
    expect(sentence(resp({ flightLists: { pages: 0, seconds: 0 } })).line).not.toContain('flights');
    expect(sentence(resp({})).line).not.toContain('flights');
  });

  it('a blocked paid line: the source not used, why, and its cost as not included', () => {
    expect(
      sentence(
        resp({
          lines: [
            { providerId: 'camoufox' },
            { providerId: 'searchapi', costMicroGbp: 3_400_000, blocked: 'provider-month' },
            { providerId: 'searchapi', stage: 'verification', costMicroGbp: 0, blocked: 'provider-month' },
          ],
        }),
      ).notes,
    ).toEqual([
      'Google Flights via SearchApi is not used: no calls left this month (about £3.40 not included)',
    ]);
  });

  it.each<[string, ProviderId, string]>([
    [
      'execution-calls',
      'searchapi',
      "Google Flights via SearchApi is not used: over this search's limit of paid calls a run",
    ],
    [
      'execution-free-calls',
      'travelpayouts',
      "The Aviasales cache is not used: over this search's limit of free calls a run",
    ],
    [
      'execution-cost',
      'searchapi',
      "Google Flights via SearchApi is not used: over this search's spending limit a run",
    ],
    ['provider-execution', 'camoufox', 'The browser worker is not used: over its page limit for one run'],
    ['provider-month', 'searchapi', 'Google Flights via SearchApi is not used: no calls left this month'],
    ['provider-lifetime', 'searchapi', 'Google Flights via SearchApi is not used: no trial searches left'],
    [
      'global-month',
      'searchapi',
      "Google Flights via SearchApi is not used: this month's spending limit is reached",
    ],
    ['something-new', 'searchapi', 'Google Flights via SearchApi is not used: a limit stops it this run'],
  ])('a line blocked by %s is said in words', (scope, providerId, words) => {
    const s = sentence(resp({ lines: [{ providerId: 'fixture' }, { providerId, blocked: scope }] }));
    expect(s.notes).toEqual([words]);
  });

  it('the soft confirmation in words, from its code and figures, never engine English (ruling A22)', () => {
    expect(
      sentence(
        resp({ lines: [paid], softConfirm: { reason: 'cost', estimatePence: 120, thresholdPence: 100 } }),
      ).notes,
    ).toEqual(['This costs about £1.20, above your £1.00 check; pressing Search now confirms it']);
    expect(
      sentence(
        resp({
          softConfirm: {
            reason: 'call-share',
            providerId: 'searchapi',
            calls: 2100,
            cap: 10_000,
            window: 'month',
          },
        }),
      ).notes,
    ).toEqual([
      "This uses more than a fifth of this month's SearchApi searches; pressing Search now confirms it",
    ]);
    expect(
      sentence(
        resp({
          softConfirm: {
            reason: 'call-share',
            providerId: 'searchapi',
            calls: 30,
            cap: 100,
            window: 'lifetime',
          },
        }),
      ).notes,
    ).toEqual([
      'This uses more than a fifth of your SearchApi trial searches; pressing Search now confirms it',
    ]);
  });
});

describe('estimateSentence: covers', () => {
  it('is the runnable totals (unblocked lines): what the press confirms and the server recomputes', () => {
    const s = sentence(
      resp({
        lines: [
          { providerId: 'searchapi', calls: 300, costMicroGbp: 1_195_000 },
          { providerId: 'travelpayouts', calls: 14 },
          {
            providerId: 'searchapi',
            stage: 'verification',
            calls: 40,
            costMicroGbp: 900_000,
            blocked: 'execution-cost',
          },
        ],
      }),
    );
    // µGBP to pence is rounded up, as core's microGbpToPence: 1,195,000 µGBP is 119.5 pence → 120
    expect(s.covers).toEqual({ pence: 120, calls: 314 });
  });
});

describe('aboutDuration (lower case; the sentence capitalises its first letter)', () => {
  it.each<[number, string]>([
    [0, 'under a minute'],
    [30, 'under a minute'],
    [59, 'under a minute'],
    [60, 'about 1 minute'],
    [720, 'about 12 minutes'],
    [3569, 'about 59 minutes'],
    [3570, 'about 1 hour'],
    [4000, 'about 1 hour'],
    [5400, 'about 1½ hours'],
    [9000, 'about 2½ hours'],
    [10_799, 'about 3 hours'],
    [100_000, 'about 28 hours'],
  ])('%i s is "%s"', (seconds, words) => {
    expect(aboutDuration(seconds)).toBe(words);
  });
});

describe('plainDuration: a length without "about", by aboutDuration\'s rounding (spec rev 56 §8.1 R-estimate)', () => {
  it('under a minute below 60 s; whole minutes under an hour; the nearest half hour from an hour', () => {
    expect(plainDuration(59)).toBe('under a minute');
    expect(plainDuration(60)).toBe('1 minute');
    expect(plainDuration(2450)).toBe('41 minutes');
    expect(plainDuration(3569)).toBe('59 minutes');
    expect(plainDuration(3570)).toBe('1 hour');
    expect(plainDuration(5400)).toBe('1½ hours');
    expect(plainDuration(9000)).toBe('2½ hours');
    expect(plainDuration(7200)).toBe('2 hours');
    expect(plainDuration(10_740)).toBe('3 hours');
  });
});
