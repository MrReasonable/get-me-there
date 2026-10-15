// The committed recorded tree for the worked example (brief WP4b section 7): what WP5, WP6 and WP13 replay.
// Red until the operator's live run (WP4b Task 12b) commits the tree.
import { defaultRecordedRoot } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { RECORDED_BY } from '../../src/tools/record.js';
import { checkWorkedExampleTree } from '../helpers/workedExampleTree.js';

describe('committed recorded tree for the worked example', () => {
  it('is one live recording session of the worked example, under the record tool signature, with no stand-in data', () => {
    expect(
      checkWorkedExampleTree(defaultRecordedRoot(), { recordedBy: RECORDED_BY, standInsAllowed: false }),
    ).toEqual([]);
  });
});
