// Spec revision 56 §2 "The returns": a return option's name is read by the one option grammar (the outbound's), with no
// alias and no second version. Every name here is synthetic (the recorded name form on the worked example's airports,
// with the synthetic carrier QQ Air), never a recording's.
import { beforeEach, describe, expect, it } from 'vitest';
import * as names from '../src/names.js';
import { GRAMMAR_VERSION, parseOptionName } from '../src/names.js';

/** A return name in the recorded form: "From <price> British pounds round trip total.", JFK to Heathrow on the return day. */
const RETURN_NAME =
  'From 1,180 British pounds round trip total. 1 stop flight with QQ Air. Leaves John F. Kennedy International Airport ' +
  'at 18:30 on Sunday, November 15 and arrives at Heathrow Airport at 9:45 on Monday, November 16. Total duration ' +
  '10 hrs 15 min. Stopover (1 of 1) is a 1 hr 20 min stopover at Dublin Airport in Dublin. Select flight';

beforeEach(() => {
  expect.hasAssertions();
});

describe('a return name through parseOptionName (spec rev 56 §2: one grammar)', () => {
  it('reads every field, the "From" figure in pence', () => {
    expect(parseOptionName(RETURN_NAME)).toEqual({
      amountMinor: 118_000,
      stops: 1,
      carriers: 'QQ Air',
      departsOn: { month: 11, day: 15 },
      from: 'John F. Kennedy International Airport',
      to: 'Heathrow Airport',
      interstitials: [],
      operatedBy: null,
      durationMinutes: 615,
      departsAt: '18:30',
      arrivesAt: '09:45',
      arrivesOn: { month: 11, day: 16 },
    });
  });
  it('has no alias and no second version (no parseReturnName; the outbound grammar’s date stands)', () => {
    expect(Object.keys(names)).not.toContain('parseReturnName');
    expect(GRAMMAR_VERSION).toBe('2026-11-03-emissions');
  });
});
