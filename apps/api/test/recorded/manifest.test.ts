// The committed recorded tree for the worked example (brief WP4b section 7): what WP5, WP6 and WP13 replay.
// Skipped visibly while the local-only recordings are absent (plan decision 61).
import { defaultRecordedRoot } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { RECORDED_BY } from '../../src/tools/record.js';
import { recordingsPresent, skipTitle } from '../helpers/recordings.js';
import { checkWorkedExampleTree } from '../helpers/workedExampleTree.js';

const present = recordingsPresent(defaultRecordedRoot());

describe.skipIf(!present)(skipTitle('committed recorded tree for the worked example', present), () => {
  it('is one live recording session of the worked example, under the record tool signature, with no stand-in data', () => {
    expect(
      checkWorkedExampleTree(defaultRecordedRoot(), { recordedBy: RECORDED_BY, standInsAllowed: false }),
    ).toEqual([]);
  });
});
