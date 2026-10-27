import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
      operatedBy: null,
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
  // why: observed in the 2026-10-18 recordings: a name with no stopover sentence ends "… min.   Select flight", with
  // a run of spaces where the empty tail sits (synthetic carrier here)
  it('a non-stop name with a run of spaces before "Select flight" parses', () => {
    const nonstop = ONE_STOP.replace(
      '1 stop flight with Tap Air Portugal',
      'Non-stop flight with Example Air',
    ).replace(
      'Total duration 12 hrs 40 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Select flight',
      'Total duration 8 hrs 14 min.   Select flight',
    );
    expect(parseOptionName(nonstop)).toMatchObject({
      stops: 0,
      durationMinutes: 494,
      carriers: 'Example Air',
    });
  });
  // why: ruling of 2026-10-18 (the view-more recording): an "Operated by …." sentence may follow the carriers, in both
  // recorded forms; the marketing carrier stays the one named first (synthetic carriers here)
  it.each([
    [
      'Operated by Example Regional as Example Connect for Example Airlines.',
      'Example Regional as Example Connect for Example Airlines',
    ],
    ['Operated by EXAMPLE Airways.', 'EXAMPLE Airways'],
  ])('reads "%s" with the marketing carrier first', (sentence, operator) => {
    const name = ONE_STOP.replace(
      '1 stop flight with Tap Air Portugal.',
      `1 stop flight with Example Air and Other Air. ${sentence}`,
    );
    expect(parseOptionName(name)).toMatchObject({
      carriers: 'Example Air and Other Air',
      operatedBy: operator,
      stops: 1,
    });
  });
  it('a name without the sentence has no operator', () => {
    expect(parseOptionName(ONE_STOP)?.operatedBy).toBeNull();
  });
  it.each([
    ['an operator sentence of another form', 'Flown by Example Regional.'],
    ['two operator sentences', 'Operated by A. Operated by B.'],
    ['an empty operator', 'Operated by .'],
  ])('refuses %s', (_n, sentence) => {
    expect(
      parseOptionName(ONE_STOP.replace('Tap Air Portugal.', `Tap Air Portugal. ${sentence}`)),
    ).toBeNull();
  });
  it('reads two stopover sentences in the tail', () => {
    const two = ONE_STOP.replace('1 stop flight', '2 stops flight').replace(
      'Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon.',
      'Stopover (1 of 2) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon. Stopover (2 of 2) is a 55 min stopover at Example Airport in Example City.',
    );
    expect(parseOptionName(two)).toMatchObject({ stops: 2, durationMinutes: 760 });
  });
  // why: observed 2026-10-27 (results/2026-10-27/1): a stopover that changes airports names its city only, then the
  // transfer between the two airports, as its own sentence; the airports carry no full stop, as at every stopover
  const TRANSFER =
    'Stopover (1 of 1) is a 3 hrs 5 min stopover in Example City. Transfer here from Example North Airport to Example South Airport.';
  const AT = 'Stopover (1 of 1) is a 1 hr 20 min stopover at Humberto Delgado Airport in Lisbon.';
  it('reads a stopover that changes airports in its city', () => {
    expect(parseOptionName(ONE_STOP.replace(AT, TRANSFER))).toMatchObject({
      amountMinor: 47800,
      stops: 1,
      durationMinutes: 760,
    });
  });
  it('reads a transfer stopover beside a stopover at one airport, either order', () => {
    const second = 'Stopover (2 of 2) is a 55 min overnight stopover at Example Airport in Example City.';
    const firstTransfer = TRANSFER.replace('(1 of 1)', '(1 of 2)');
    for (const tail of [
      `${firstTransfer} ${second}`,
      `${AT.replace('(1 of 1)', '(1 of 2)')} ${TRANSFER.replace('(1 of 1)', '(2 of 2)')}`,
    ])
      expect(
        parseOptionName(ONE_STOP.replace('1 stop flight', '2 stops flight').replace(AT, tail)),
      ).toMatchObject({
        stops: 2,
      });
  });
  it.each([
    [
      'a transfer sentence with no stopover before it',
      ONE_STOP.replace(AT, 'Transfer here from Example North Airport to Example South Airport.'),
    ],
    [
      'a stopover in a city with no transfer after it',
      ONE_STOP.replace(AT, 'Stopover (1 of 1) is a 3 hrs stopover in Example City.'),
    ],
    [
      'a transfer with no destination airport',
      ONE_STOP.replace(
        AT,
        'Stopover (1 of 1) is a 3 hrs stopover in Example City. Transfer here from Example North Airport.',
      ),
    ],
    ['text appended to the transfer', ONE_STOP.replace(AT, `${TRANSFER} Bring your bags.`)],
    // why: CodeRabbit on PR #33: a field of spaces only is no airport or city; such a name is unparsed, never read
    [
      'a transfer to a blank airport',
      ONE_STOP.replace(AT, TRANSFER.replace('to Example South Airport.', 'to  .')),
    ],
    [
      'a transfer from a blank airport',
      ONE_STOP.replace(AT, TRANSFER.replace('from Example North Airport', 'from  ')),
    ],
    ['a stopover in a blank city', ONE_STOP.replace(AT, TRANSFER.replace('in Example City.', 'in  .'))],
    ['a stopover at a blank airport', ONE_STOP.replace('at Humberto Delgado Airport in', 'at   in')],
    ['a stopover at an airport in a blank city', ONE_STOP.replace('in Lisbon.', 'in  .')],
  ])('refuses %s', (_n, name) => {
    expect(parseOptionName(name)).toBeNull();
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
    // why: a kind directory also holds its tracked .gitkeep; only day directories are read
    for (const day of existsSync(dir)
      ? readdirSync(dir).filter((x) => statSync(join(dir, x)).isDirectory())
      : [])
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

// why: the ruling's evidence: the view-more recording's "Operated by" names parse, the marketing carrier first
const viewMore = recordingsPresentForKind(ROOT, 'view-more');
describe.skipIf(!viewMore)(
  skipTitle('recorded operated-by names parse (Task 14.2 view-more kind)', viewMore),
  () => {
    it('each recorded "Operated by" name parses with the carrier named after "flight with"', () => {
      const names: string[] = [];
      const dir = join(ROOT, 'view-more');
      for (const day of readdirSync(dir).filter((x) => statSync(join(dir, x)).isDirectory()))
        for (const f of readdirSync(join(dir, day)).filter((x) => x.endsWith('.facts.json'))) {
          const raw: unknown = JSON.parse(readFileSync(join(dir, day, f), 'utf8'));
          if (typeof raw === 'object' && raw !== null && 'names' in raw && Array.isArray(raw.names))
            for (const n of raw.names)
              if (typeof n === 'string' && n.includes('. Operated by ')) names.push(n);
        }
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) {
        const marketing = /flight with (.+?)\. Operated by /.exec(n)?.[1];
        expect(parseOptionName(n)?.carriers, n.slice(0, 60)).toBe(marketing);
      }
    });
  },
);
