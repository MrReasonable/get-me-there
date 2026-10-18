// The year anchor for a recorded grid page (fix round 1, TS 13): the recordings hold no query, so the year rule is
// anchored on the selected pair's return date as the page's own range line printed it (its year when printed, else the
// recording's year), never on a guessed offset from the recording time.
import { asIsoDate, type IsoDate } from '@gmt/core';
import { parseSelectedRange } from '../../src/gridNames.js';

/** The range line the stored snapshot holds ("14 – 24 Mar 2027"), run into the price line as the page prints it. */
export const rangeOf = (snapshot: string): string =>
  /text: (\d{1,2}(?: \w{3})?(?: \d{4})? – \d{1,2} \w{3}(?: \d{4})?)£/.exec(snapshot)?.[1] ?? '';

/** The selected return date of a recorded first view, from its range line. */
export function recordedAnchor(snapshot: string, recordedAt: string): IsoDate {
  const r = parseSelectedRange(rangeOf(snapshot));
  if (r === null) throw new Error('the recorded first view has no range line');
  const year = r.ret.year ?? Number(recordedAt.slice(0, 4));
  return asIsoDate(`${year}-${String(r.ret.month).padStart(2, '0')}-${String(r.ret.day).padStart(2, '0')}`);
}
