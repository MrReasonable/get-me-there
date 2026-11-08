// Spec revision 55 §8.1, §10: `rankedPairsFor` is the board's ranking (the date-pairs route decoded and ranked by
// core's `rankDatePairs`), departed date pairs left out, the journey limit applied.
import { asIsoDateTime, rankDatePairs } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { rankedPairsFor } from '../../src/read/ranked.js';
import { currentSpace } from '../../src/read/space.js';
import { datesOf, seedDatesWorld } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const FOUR = { origins: [LHR, LGW], destinations: [JFK, EWR], window: SMALL_WINDOW };

async function world() {
  h = await createHarness();
  const x = h;
  const def = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
  seedDatesWorld(x, def, () => true);
  return { x, def };
}

describe('rankedPairsFor (revision 55 §8.1, §10)', () => {
  it("equals the board's ranked rows for the same data, with each figure's airport pair and source", async () => {
    const { x, def } = await world();
    const board = rankDatePairs((await datesOf(x, def.id)).pairs, x.clock.now());
    const ranked = rankedPairsFor(x.ports, {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      maxJourneyMinutes: null,
      now: x.clock.now(),
    });
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked).toEqual(
      board.map((p) => ({
        departureDate: p.departureDate,
        returnDate: p.returnDate,
        origin: p.figure?.origin,
        destination: p.figure?.destination,
        pricePence: p.figure?.price.pricePence,
        providerId: p.figure?.price.provenance.providerId,
        sourceKind: p.figure?.price.provenance.sourceKind,
        basis: p.figure?.basis,
        current: p.figure?.superseded === false && p.figure.notSeenInLatest === null,
        stale: p.figure?.price.stale !== false,
      })),
    );
  });

  // why: design 2026-11-08 §4.2: the step queues only current calendar prices and stale verified ones, so the reader says
  // which each figure is; the seeded world holds a verified figure, a superseded calendar one and current calendar ones
  it('states each figure basis, whether it is current, and whether its price is stale', async () => {
    const { x, def } = await world();
    const ranked = rankedPairsFor(x.ports, {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      maxJourneyMinutes: null,
      now: x.clock.now(),
    });
    const of = (dep: string, ret: string) =>
      ranked.find((p) => p.departureDate === dep && p.returnDate === ret);
    // 2 Nov, 10 nights: the fresh verified LHR→JFK figure of the latest run
    expect(of('2026-11-02', '2026-11-12')).toMatchObject({ basis: 'verified', current: true, stale: false });
    // 3 Nov, 11 nights: a verified price the latest itinerary search did not return
    expect(of('2026-11-03', '2026-11-14')).toMatchObject({ basis: 'verified', current: false });
    // 2 Nov, 11 nights: a calendar price of the latest run
    expect(of('2026-11-02', '2026-11-13')).toMatchObject({ basis: 'calendar', current: true, stale: false });
  });

  it('applies the journey limit as the board does, and leaves out date pairs departing on or before today in London', async () => {
    const { x, def } = await world();
    const q = {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      now: x.clock.now(),
    };
    const limited = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: 600 });
    const board = rankDatePairs((await datesOf(x, def.id, '?maxJourneyMinutes=600')).pairs, x.clock.now());
    expect(limited.map((p) => [p.departureDate, p.returnDate, p.pricePence])).toEqual(
      board.map((p) => [p.departureDate, p.returnDate, p.figure?.price.pricePence]),
    );
    const all = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: null });
    const firstDay = all.map((p) => p.departureDate).sort()[0];
    if (firstDay === undefined) throw new Error('no ranked pairs');
    // why: the clock moved to the first departure day: every pair leaving that day is now departed
    x.clock.set(asIsoDateTime(`${firstDay}T12:00:00.000Z`));
    const later = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: null });
    expect(later.length).toBeLessThan(all.length);
    expect(later.every((p) => p.departureDate > firstDay)).toBe(true);
    expect(
      rankedPairsFor(x.ports, { ...q, definitionId: 'no-such-definition', maxJourneyMinutes: null }),
    ).toEqual([]);
  });
});
