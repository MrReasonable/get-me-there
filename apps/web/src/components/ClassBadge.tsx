import type { VerdictClass } from '@gmt/core';
import { COPY } from '../copy.js';

// why: state tags, black chips in the board's lamp inks: white for verified, amber for partly verified and not checked
// (dashed, as a calendar price is), red and struck through for failed; the word carries the meaning, never the ink
const STYLE: Record<VerdictClass | 'unchecked', string> = {
  verified: 'tag',
  'partially-verified': 'tag tag-warn',
  failed: 'tag tag-bad line-through decoration-1',
  unchecked: 'tag tag-warn border-dashed border-amber',
};

/**
 * Verdict class in words, never colour alone (spec §11); stays in the 375px primary row. The visible
 * word is the accessible text, with a spoken-only prefix naming what it is.
 */
export function ClassBadge({ cls }: { cls: VerdictClass | 'unchecked' }) {
  return (
    <span data-testid="class-badge" className={STYLE[cls]}>
      <span className="sr-only">{COPY.classSpoken} </span>
      {COPY.classLabel[cls]}
    </span>
  );
}
