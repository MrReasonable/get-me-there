// The year anchor for a recorded grid page (fix round 1, TS 13): the recordings hold no query, so the year rule is
// anchored on the selected pair's return date as the page's own range line printed it (its year when printed, else the
// recording's year), never on a guessed offset from the recording time.
import { asIsoDate, CAMOUFOX_BUILDS, type IsoDate } from '@gmt/core';
import { monthOf, parseSelectedRange } from '../../src/gridNames.js';
import { cellCandidates, stillDrawing } from '../../src/gridView.js';
import { selectorsFor } from '../../src/selectors.js';

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

/**
 * A recorded view's cell candidates as the reader takes them: its buttons less the grid's own controls (spec §2 rev 54;
 * a recording keeps "Reset back to centre" where the page showed it, grid/2026-10-30/1). The grid's names are the same
 * on every entry.
 */
export const recordedCells = (candidates: ReadonlyArray<string | null>): Array<string | null> =>
  cellCandidates(
    candidates,
    selectorsFor('darwin-arm64', CAMOUFOX_BUILDS['darwin-arm64'].build).results.dateGrid,
  );

/** What a recording's views hold for the checks below. */
interface RecordedViews {
  recordedAt: string;
  osArch: string;
  versions?: { binary: string } | undefined;
  views: ReadonlyArray<{
    lines: { texts: string[] };
    candidates: ReadonlyArray<string | null>;
    drawn?: unknown;
  }>;
}

/** Whether a recording was made under the settle that waits for every cell (spec §2 rev 46): its views carry `drawn`. */
export const underDrawnSettle = (rec: RecordedViews): boolean =>
  rec.views.length > 0 && rec.views.every((v) => Object.hasOwn(v, 'drawn'));

/** A view taken while still drawing, by the cells the reader counts (spec §2 rev 54), that its settle took as drawn. */
const takenEarly = (v: RecordedViews['views'][number], anchor: IsoDate): boolean =>
  v.drawn !== false && stillDrawing(v.lines.texts, recordedCells(v.candidates).length, anchor);

/**
 * Whether a recording is one a later settle supersedes: it holds a view taken while still drawing that the settle of
 * its day took as drawn, and its entry has been recorded whole since. Before spec §2 rev 46 the settle took a view that
 * held still (darwin-x64's grid 3 and 4 of 2026-10-26, superseded by its grid 5 and 6); before rev 54 it counted "Reset
 * back to centre" as a cell, so a view one cell short looked whole (grid/2026-10-30/1's view 6). Such a recording is
 * held to the wait-or-refuse checks of gridRecorded.test.ts instead of the strict ones. Only a later recording on the
 * same entry and browser build excuses it, and only one whose every view the settle marked drawn and which is drawn
 * whole by that count (CodeRabbit on PR #36); a view the settle marked not drawn is never excused.
 */
export function superseded<T extends RecordedViews>(
  rec: T,
  all: readonly T[],
  anchorOf: (r: T) => IsoDate,
): boolean {
  const anchor = anchorOf(rec);
  return (
    rec.views.some((v) => takenEarly(v, anchor)) &&
    all.some(
      (o) =>
        o !== rec &&
        o.recordedAt > rec.recordedAt &&
        o.osArch === rec.osArch &&
        o.versions?.binary === rec.versions?.binary &&
        underDrawnSettle(o) &&
        o.views.every((v) => v.drawn === true && !takenEarly(v, anchorOf(o))),
    )
  );
}
