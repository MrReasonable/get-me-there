// The "Plan a search" strings (src/copy/plan.ts) under the same spec §11 rules as COPY: no banned word, and
// "verified" as a whole word nowhere (none of these strings sits beside a class-verified value).
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { PLAN_COPY } from '../../src/copy/plan.js';

/** Sample arguments for every function entry. A missing key fails the test. */
const SAMPLES: Record<string, unknown[][]> = {
  editSearch: [['Worked example']],
  preset: [[3], [12]],
  rolling: [
    [1, 1],
    [7, 182],
  ],
  nameArrow: [['Origin city', 'Destination city']],
  airportOption: [['Some Field', 'AAA', 'Some City', 'ZZ']],
  listbox: [['From']],
  placeLine: [['Some City', 'ZZ']],
  metroOption: [['Some City', ['AAA', 'AAB']]],
  noMatch: [['xyz']],
  noMatchCode: [['xyz']],
  remove: [['AAA']],
  added: [['Some Field (AAA)']],
};

describe('PLAN_COPY catalogue (spec §11 banned words)', () => {
  const strings: Array<{ key: string; text: string }> = [];
  const problems: string[] = [];
  const fns: string[] = [];
  for (const [key, value] of Object.entries(PLAN_COPY)) {
    if (typeof value === 'string') strings.push({ key, text: value });
    else if (typeof value === 'function') {
      fns.push(key);
      const calls = SAMPLES[key];
      if (calls === undefined) problems.push(`PLAN_COPY.${key} has no entry in SAMPLES`);
      for (const args of calls ?? []) {
        const produced: unknown = Reflect.apply(value, undefined, args);
        if (typeof produced === 'string') strings.push({ key, text: produced });
        else problems.push(`PLAN_COPY.${key} did not return a string`);
      }
    } else problems.push(`PLAN_COPY.${key} is neither a string nor a function`);
  }

  it('finds strings and functions (a vacuous pass is a failure), each function with samples', () => {
    expect(strings.length).toBeGreaterThan(40);
    expect(problems).toEqual([]);
    expect(Object.keys(SAMPLES).filter((k) => !fns.includes(k))).toEqual([]);
  });

  it('no string contains a banned word, and none says "verified"', () => {
    const hits = strings.flatMap(({ key, text }) =>
      findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${key}: "${h.word}" in "${text}"`),
    );
    expect(hits).toEqual([]);
    expect(strings.filter(({ text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text))).toEqual([]);
  });

  it('reads as intended', () => {
    expect(PLAN_COPY.metroOption('Some City', ['AAA', 'AAB'])).toBe('Some City, all airports (AAA, AAB)');
    expect(PLAN_COPY.airportOption('Some Field', 'AAA', 'Some City', 'ZZ')).toBe(
      'Some Field (AAA) · Some City, ZZ',
    );
    expect(PLAN_COPY.rolling(1, 1)).toMatch(
      /^Rolling window: each run searches departures from 1 day ahead, for 1 day\./,
    );
  });
});
