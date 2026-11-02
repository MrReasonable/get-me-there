// Spec revision 55 §2 "The flight-list read" (WP20 Task 20.7; decision 61: the recordings are local-only and
// gitignored, so each kind's suite runs only where that kind's recordings exist and otherwise reports itself skipped).
// Every recorded option the grammar reads states its times and arrival date; the flights reader keeps the 30 cheapest
// of each results page's cell and accounts for every other option. Only counts and shapes are asserted: nothing of a
// page is written here (each request is rebuilt at run time, test/support/recordedList.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, FLIGHT_LIST_MAX_FLIGHTS, listedFlightSchema } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { dayOffset, readFlights } from '../src/flights.js';
import { readList } from '../src/list.js';
import { parseOptionName } from '../src/names.js';
import { RECORDED_ROOT, recordedLists } from './support/recordedList.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const recSchema = z.object({ list: z.object({ names: z.array(z.string().nullable()) }).loose() }).loose();
const metaSchema = z.object({ recordedAt: z.string() }).loose();

/** Every name of every recording of `kind`, with the year its pages were recorded in. */
function namesOf(kind: string): Array<{ key: string; name: string; recordedAt: string }> {
  const dir = join(RECORDED_ROOT, kind);
  if (!existsSync(dir)) return [];
  const out: Array<{ key: string; name: string; recordedAt: string }> = [];
  for (const day of readdirSync(dir).filter((x) => statSync(join(dir, x)).isDirectory()))
    for (const f of readdirSync(join(dir, day)).filter((x) => x.endsWith('.facts.json'))) {
      const rec = recSchema.parse(JSON.parse(readFileSync(join(dir, day, f), 'utf8')));
      const meta = metaSchema.parse(
        JSON.parse(readFileSync(join(dir, day, f.replace(/\.facts\.json$/, '.meta.json')), 'utf8')),
      );
      for (const name of rec.list.names)
        if (name !== null && name !== '')
          out.push({ key: `${kind}/${day}/${f}`, name, recordedAt: meta.recordedAt });
    }
  return out;
}

/** The departure's own date: the recording's year, or the next one for a month before the recording's. */
function departureDateOf(on: { month: number; day: number }, recordedAt: string) {
  const year = Number(recordedAt.slice(0, 4));
  const month = Number(recordedAt.slice(5, 7));
  const y = on.month < month ? year + 1 : year;
  return asIsoDate(`${y}-${String(on.month).padStart(2, '0')}-${String(on.day).padStart(2, '0')}`);
}

beforeEach(() => {
  expect.hasAssertions();
});

for (const kind of ['results', 'cheapest', 'view-more'] as const) {
  const present = recordingsPresentForKind(RECORDED_ROOT, kind);
  describe.skipIf(!present)(
    skipTitle(`recorded ${kind} options state their times (Task 20.7)`, present),
    () => {
      it('every option the grammar reads has HH:MM times and an arrival 0 to 3 days after its departure', () => {
        const names = namesOf(kind);
        let read = 0;
        for (const { key, name, recordedAt } of names) {
          const p = parseOptionName(name);
          if (p === null) continue;
          read++;
          expect(p.departsAt, key).toMatch(HHMM);
          expect(p.arrivesAt, key).toMatch(HHMM);
          expect(p.arrivesOn, key).not.toBeNull();
          const offset =
            p.arrivesOn === null
              ? null
              : dayOffset(p.departsOn, p.arrivesOn, departureDateOf(p.departsOn, recordedAt));
          expect(offset, key).not.toBeNull();
          expect(offset ?? -1, key).toBeGreaterThanOrEqual(0);
          expect(offset ?? 4, key).toBeLessThanOrEqual(3);
        }
        expect(read).toBeGreaterThan(0);
      });
    },
  );
}

{
  const present = recordingsPresentForKind(RECORDED_ROOT, 'results');
  describe.skipIf(!present)(skipTitle('recorded results pages read as flights (Task 20.7)', present), () => {
    it('keeps min(30, the cell’s options) flights, each one valid, and accounts for every other option', () => {
      const lists = recordedLists('results');
      expect(lists.length).toBeGreaterThan(0);
      for (const l of lists) {
        const r = readFlights(l.facts, l.req);
        const list = readList(l.facts, l.req);
        // why: every recorded option of the cell reads as a flight, so the cell's options are the list read's
        expect(r.parsedForThisCell, l.key).toBe(list.parsedForThisCell);
        expect(r.flights.length, l.key).toBe(Math.min(FLIGHT_LIST_MAX_FLIGHTS, list.parsedForThisCell));
        const dropped = r.parsedForThisCell - r.flights.length;
        expect(r.flights.length + r.optionsUnparsed + r.optionsOtherCell + dropped, l.key).toBe(
          l.facts.names.length,
        );
        expect(r.listed, l.key).toBe(r.flights.length > 0 ? 'flights' : 'none-for-cell');
        expect([r.minMinor, r.tabMinor, r.optionsOtherCell], l.key).toEqual([
          list.minMinor,
          list.tabMinor,
          list.optionsOtherCell,
        ]);
        for (const f of r.flights) expect(listedFlightSchema.safeParse(f).success, l.key).toBe(true);
      }
    });
  });
}
