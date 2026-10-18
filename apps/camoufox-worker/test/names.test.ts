import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { GRAMMAR_VERSION, group, parseOptionName } from '../src/names.js';

// The feasibility load's one-stop option name of 2026-10-18, verbatim (brief introduction).
const ONE_STOP =
  'From 478 British pounds round trip total. 1 stop flight with Tap Air Portugal. Leaves Heathrow Airport at 12:25 on Thursday, November 5 and arrives at John F. Kennedy International Airport at 20:05 on Thursday, November 5. Total duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select flight';

beforeEach(() => {
  expect.hasAssertions();
});

describe('parseOptionName (dated grammar)', () => {
  it('parses the feasibility one-stop name, airports included', () => {
    expect(parseOptionName(ONE_STOP)).toEqual({
      amountMinor: 47800,
      stops: 1,
      carriers: 'Tap Air Portugal',
      departsOn: { month: 11, day: 5 },
      from: 'Heathrow Airport',
      to: 'John F. Kennedy International Airport',
      interstitials: [],
      durationMinutes: 760,
    });
  });
  it('thousands separators are exact', () => {
    expect(parseOptionName(ONE_STOP.replace('From 478', 'From 1,204'))?.amountMinor).toBe(120400);
  });
  it('reads a non-stop name with a whole-hour and a minutes-only duration, and two stops', () => {
    const nonstop = ONE_STOP.replace(
      '1 stop flight with Tap Air Portugal',
      'Nonstop flight with Example Air',
    ).replace(
      'Total duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon.',
      'Total duration 8 hrs.',
    );
    expect(parseOptionName(nonstop)).toMatchObject({
      stops: 0,
      durationMinutes: 480,
      carriers: 'Example Air',
    });
    expect(
      parseOptionName(nonstop.replace('Total duration 8 hrs.', 'Total duration 55 min.'))?.durationMinutes,
    ).toBe(55);
    expect(parseOptionName(ONE_STOP.replace('1 stop flight', '2 stops flight'))?.stops).toBe(2);
    expect(parseOptionName(nonstop.replace('Nonstop', 'Non-stop'))?.stops).toBe(0);
  });
  // why: fix round 1 (prov-int M3): after the duration only the stopover sentences may follow, then the end
  it('reads two stopover sentences in the tail', () => {
    const two = ONE_STOP.replace('1 stop flight', '2 stops flight').replace(
      'Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon.',
      'Stopover (1 of 2) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Stopover (2 of 2) is a 55 min stopover at Example Airport in Example City.',
    );
    expect(parseOptionName(two)).toMatchObject({ stops: 2, durationMinutes: 760 });
  });
  it.each([
    [
      'an unknown appended sentence',
      ONE_STOP.replace(' Select flight', ' This flight has free wifi. Select flight'),
    ],
    [
      'an unknown sentence before the stopover',
      ONE_STOP.replace('min. Stopover', 'min. Lower emissions. Stopover'),
    ],
    ['text after Select flight', `${ONE_STOP} now`],
    ['a stopover sentence of another form', ONE_STOP.replace('Stopover (1 of 1) is a', 'Stopover 1 is a')],
  ])('refuses %s', (_n, name) => {
    expect(parseOptionName(name)).toBeNull();
  });
  it.each([
    ['a decimal price', ONE_STOP.replace('From 478', 'From 478.50')],
    ['another currency phrase', ONE_STOP.replace('British pounds', 'US dollars')],
    ['no round-trip clause', ONE_STOP.replace(' round trip total', '')],
    ['a missing duration', ONE_STOP.replace(/ Total duration [^.]*\./, '')],
    ['an unknown month', ONE_STOP.replaceAll('November', 'Novembre')],
    [
      'an unlisted interstitial sentence',
      ONE_STOP.replace('total. 1 stop', 'total. This price does not include overhead bin access. 1 stop'),
    ],
    ['an empty name', ''],
  ])('%s → null, never partly read', (_n, name) => {
    expect(parseOptionName(name)).toBeNull();
  });
  it('an interstitial is accepted only when passed in, and reported', () => {
    const sentence = 'This price does not include overhead bin access.';
    const name = ONE_STOP.replace('total. 1 stop', `total. ${sentence} 1 stop`);
    expect(parseOptionName(name)).toBeNull();
    const table = [{ sentence, recorded: '2026-10-20' }];
    expect(parseOptionName(name, table)).toMatchObject({ amountMinor: 47800, interstitials: [sentence] });
    expect(parseOptionName(ONE_STOP, table)?.interstitials).toEqual([]);
  });
  it('a group missing on a match is a grammar bug, thrown, never a fallback (TS2-04)', () => {
    const m = /x/.exec('x');
    if (m === null) throw new Error('no match');
    expect(() => group(m, 'price')).toThrow(/group price missing/);
  });
  it('is dated', () => {
    expect(GRAMMAR_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

const ROOT = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));
const present = recordingsPresentForKind(ROOT, 'results');
describe.skipIf(!present)(skipTitle('recorded result names parse (Task 14.2 results kind)', present), () => {
  it('a recorded non-stop name parses', () => {
    const names: string[] = [];
    const dir = join(ROOT, 'results');
    for (const day of existsSync(dir) ? readdirSync(dir) : [])
      for (const f of readdirSync(join(dir, day)).filter((x) => x.endsWith('.facts.json'))) {
        const raw: unknown = JSON.parse(readFileSync(join(dir, day, f), 'utf8'));
        if (typeof raw === 'object' && raw !== null && 'names' in raw && Array.isArray(raw.names))
          for (const n of raw.names)
            if (typeof n === 'string' && /^From .* (Nonstop|Non-stop) flight/.test(n)) names.push(n);
      }
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(parseOptionName(n)?.stops).toBe(0);
  });
});
