// The estimate sentence's and a refused Search now's strings (src/copy/estimate.ts, src/copy/refused.ts; WP20 Task
// 20.5) under the same spec §11 rules as COPY: no banned word, "verified" as a whole word nowhere, and never a word
// that reads the coverage as prices found.
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ESTIMATE_COPY } from '../../src/copy/estimate.js';
import { REFUSED_COPY } from '../../src/copy/refused.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[][]> = {
  'estimate.aboutMinutes': [[1], [12]],
  'estimate.aboutHours': [
    [1, false],
    [2, true],
  ],
  'estimate.about': [['£1.20']],
  'estimate.asksAll': [['1'], ['405']],
  'estimate.asksSome': [['300', '405']],
  'estimate.partly': [['20']],
  'estimate.reused': [['105']],
  'estimate.restNext': [['Monday']],
  'estimate.nothingNew': [['1'], ['405']],
  'estimate.billed': [
    ['120', '9,880', 'SearchApi', 'month'],
    ['12', '91', 'SearchApi', 'lifetime'],
  ],
  'estimate.billedNoCap': [['120', 'SearchApi']],
  'estimate.searchesTag': [['120', 'SearchApi']],
  'estimate.withTag': [['Search now', 'about £1.20']],
  'estimate.monthlyPages': [['110', '1,400']],
  'estimate.notUsed': [
    ['Google Flights via SearchApi', 'no calls left this month', '£3.40'],
    ['The browser worker', 'over its page limit for one run', null],
  ],
  'estimate.softCost': [['£1.20', '£1.00', 'Search now']],
  'estimate.softShare': [
    ['SearchApi', 'month', 'Search now'],
    ['SearchApi', 'lifetime', 'Search again'],
  ],
  'refused.capResets': [['1 Nov 2026']],
};

interface Collected {
  strings: Array<{ path: string; text: string }>;
  fns: string[];
  problems: string[];
}

function collect(value: unknown, path: string, out: Collected): void {
  if (typeof value === 'string') out.strings.push({ path, text: value });
  else if (typeof value === 'function') {
    out.fns.push(path);
    const calls = SAMPLES[path];
    if (calls === undefined) out.problems.push(`${path} has no entry in SAMPLES`);
    for (const args of calls ?? []) {
      const produced: unknown = Reflect.apply(value, undefined, args);
      if (typeof produced === 'string') out.strings.push({ path, text: produced });
      else out.problems.push(`${path} did not return a string`);
    }
  } else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) collect(v, `${path}.${k}`, out);
  else out.problems.push(`${path} is neither a string, a function nor a group`);
}

describe('the estimate and refusal catalogues (spec §11 banned words)', () => {
  const out: Collected = { strings: [], fns: [], problems: [] };
  collect(ESTIMATE_COPY, 'estimate', out);
  collect(REFUSED_COPY, 'refused', out);

  it('finds strings and functions (a vacuous pass is a failure), each function with samples', () => {
    expect(out.strings.length).toBeGreaterThan(40);
    expect(out.problems).toEqual([]);
    expect(Object.keys(SAMPLES).filter((k) => !out.fns.includes(k))).toEqual([]);
  });

  it('no string contains a banned word, none says "verified", and none reads coverage as prices found', () => {
    const hits = out.strings.flatMap(({ path, text }) =>
      findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${path}: "${h.word}" in "${text}"`),
    );
    expect(hits).toEqual([]);
    expect(out.strings.filter(({ text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text))).toEqual([]);
    for (const word of ['priced', 'prices for', 'all combinations', 'will find'])
      expect(out.strings.filter(({ text }) => text.includes(word))).toEqual([]);
  });

  it('reads as the spec words it (spec rev 55 §11)', () => {
    const L = ESTIMATE_COPY;
    expect(L.withTag('Search now', 'about £1.20')).toBe('Search now · about £1.20');
    expect(L.billed('120', '9,880', 'SearchApi', 'month')).toBe(
      'uses about 120 of the 9,880 SearchApi searches left this month',
    );
    expect(L.billed('12', '91', 'SearchApi', 'lifetime')).toBe(
      'uses about 12 of the 91 SearchApi searches left on your trial',
    );
    expect(L.aboutHours(1, false)).toBe('about 1 hour');
    expect(L.aboutHours(1, true)).toBe('about 1½ hours');
    expect(L.nothingNew('1')).toBe('Nothing new to ask: 1 date pair reused from earlier runs');
    expect(REFUSED_COPY.capResets('1 Nov 2026')).toBe(
      "This month's limit is used up; it resets on 1 Nov 2026",
    );
  });
});
