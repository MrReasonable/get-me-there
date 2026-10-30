// The year anchor for a recorded grid page (fix round 1, TS 13): the recordings hold no query, so the year rule is
// anchored on the selected pair's return date as the page's own range line printed it (its year when printed, else the
// recording's year), never on a guessed offset from the recording time.
import { asIsoDate, type IsoDate } from '@gmt/core';
import { monthOf, parseSelectedRange } from '../../src/gridNames.js';
import { stillDrawing } from '../../src/gridView.js';

/** The range line the stored snapshot holds ("14 – 24 Mar 2027"), run into the price line as the page prints it. */
export const rangeOf = (snapshot: string): string =>
  /text: (\d{1,2}(?: \w{3})?(?: \d{4})? – \d{1,2} \w{3}(?: \d{4})?)£/.exec(snapshot)?.[1] ?? '';

/** The selected unpriced cell's return day and month ("no flights, 14 Nov to 22 Nov, selected"), when the snapshot has one. */
function unpricedSelectedReturn(snapshot: string): { day: number; month: number } | null {
  // why: the grid grammar's month tokens include "Sept" (CodeRabbit on PR #34)
  const m =
    /(?:no flights|price unknown), \d{1,2} [A-Z][a-z]{2,3} to (\d{1,2}) ([A-Z][a-z]{2,3}), selected/.exec(
      snapshot,
    );
  const month = m === null ? null : monthOf(m[2] ?? '');
  return m === null || month === null ? null : { day: Number(m[1]), month };
}

/**
 * The selected return date of a recorded first view, from its range line; a first view whose query pair is unpriced
 * prints no range line (grid/2026-10-27/2), so its selected cell's name gives the date, in the recording's year or,
 * for a month already past, the next.
 */
export function recordedAnchor(snapshot: string, recordedAt: string): IsoDate {
  const r = parseSelectedRange(rangeOf(snapshot));
  const at = Number(recordedAt.slice(0, 4));
  const ret =
    r !== null
      ? { day: r.ret.day, month: r.ret.month, year: r.ret.year ?? at }
      : (() => {
          const u = unpricedSelectedReturn(snapshot);
          if (u === null)
            throw new Error('the recorded first view has no range line and no selected unpriced cell');
          return { ...u, year: u.month < Number(recordedAt.slice(5, 7)) ? at + 1 : at };
        })();
  return asIsoDate(`${ret.year}-${String(ret.month).padStart(2, '0')}-${String(ret.day).padStart(2, '0')}`);
}

/** What a recording's views hold for the checks below. */
interface RecordedViews {
  osArch: string;
  views: ReadonlyArray<{ lines: { texts: string[] }; candidates: ReadonlyArray<unknown> }>;
}

/** Whether a recording was made under the settle that waits for every cell (spec §2 rev 46): its views carry `drawn`. */
export const underDrawnSettle = (rec: RecordedViews): boolean =>
  rec.views.length > 0 && rec.views.every((v) => Object.hasOwn(v, 'drawn'));

/**
 * Whether a recording is one the settle of spec §2 rev 46 supersedes: made before it, holding a view taken while still
 * drawing (which that settle would have waited on), on an entry since recorded under it (darwin-x64's grid 3 and 4 of
 * 2026-10-26, superseded by its grid 5 and 6). Such a recording is held to the wait-or-refuse checks of
 * gridRecorded.test.ts instead of the strict ones; an entry with no recording under the new settle is excused nothing.
 */
export function superseded(rec: RecordedViews, all: readonly RecordedViews[], anchor: IsoDate): boolean {
  return (
    !underDrawnSettle(rec) &&
    rec.views.some((v) => stillDrawing(v.lines.texts, v.candidates.length, anchor)) &&
    all.some((o) => o.osArch === rec.osArch && underDrawnSettle(o))
  );
}
