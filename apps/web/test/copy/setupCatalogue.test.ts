// The set-up screens' own strings (src/copy/setup.ts) under the same spec §11 rules as COPY: no banned word, and
// "verified" as a whole word nowhere (none of these strings sits beside a class-verified value).
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { SETUP_COPY } from '../../src/copy/setup.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[][]> = {
  'definitions.runTakes': [['45m']],
  'definitions.expandTopHint': [[1], [5]],
  'definitions.hardStopZero': [[1], [140]],
  'definitions.journeyPart': [['max journey time', 'hours']],
  'schedule.daily': [['05:00', 'Europe/London']],
  'schedule.weekly': [
    [[1], '05:00', 'Europe/London'],
    [[1, 4, 0], '05:00', 'Europe/London'],
    [[1, 2, 3, 4, 5, 6, 0], '05:00', 'Europe/London'],
  ],
  'schedule.custom': [['*/15 * * * *', 'Europe/London']],
  'providers.markLine': [['SA']],
  'history.runsWithoutPrice': [
    [1, 4, 'route'],
    [2, 2, 'itinerary'],
  ],
};

interface Collected {
  strings: Array<{ path: string; text: string }>;
  fns: string[];
  problems: string[];
}

function collect(value: unknown, path: string, out: Collected): void {
  if (typeof value === 'string') {
    out.strings.push({ path, text: value });
    return;
  }
  if (typeof value === 'function') {
    out.fns.push(path);
    const calls = SAMPLES[path];
    if (calls === undefined) {
      out.problems.push(`SETUP_COPY.${path} is a function with no entry in SAMPLES`);
      return;
    }
    for (const args of calls) {
      const produced: unknown = Reflect.apply(value, undefined, args);
      if (typeof produced !== 'string') out.problems.push(`SETUP_COPY.${path} did not return a string`);
      else out.strings.push({ path, text: produced });
    }
    return;
  }
  if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) collect(v, path === '' ? k : `${path}.${k}`, out);
}

describe('SETUP_COPY catalogue (spec §11 banned words)', () => {
  const collected: Collected = { strings: [], fns: [], problems: [] };
  collect(SETUP_COPY, '', collected);

  it('finds strings and functions (a vacuous pass is a failure)', () => {
    expect(collected.strings.length).toBeGreaterThan(40);
    expect(collected.fns.length).toBe(Object.keys(SAMPLES).length);
  });

  it('every function entry has sample arguments and every sample names a real entry', () => {
    expect(collected.problems).toEqual([]);
    expect(Object.keys(SAMPLES).filter((k) => !collected.fns.includes(k))).toEqual([]);
  });

  it('no string contains a banned word', () => {
    const hits = collected.strings.flatMap(({ path, text }) =>
      findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${path}: "${h.word}" in "${text}"`),
    );
    expect(hits).toEqual([]);
  });

  it('"verified" as a whole word appears in none of them', () => {
    const VERIFIED = /(?<![\p{L}])verified(?![\p{L}])/u;
    expect(collected.strings.filter(({ text }) => VERIFIED.test(text))).toEqual([]);
  });

  it('the plain readings read as intended', () => {
    expect(SETUP_COPY.schedule.weekly([1, 4], '05:00', 'Europe/London')).toBe(
      'Mondays and Thursdays at 05:00 (Europe/London)',
    );
    expect(SETUP_COPY.history.runsWithoutPrice(1, 2, 'route')).toBe(
      '1 of the 2 runs named above has no price for this route.',
    );
  });
});
