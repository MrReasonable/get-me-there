import type { VerdictClass } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<VerdictClass | 'unchecked', string> = {
  verified: 'border-green-800 bg-green-100 text-green-900',
  'partially-verified': 'border-amber-800 bg-amber-100 text-amber-900',
  failed: 'border-red-800 bg-red-100 text-red-900 line-through decoration-1',
  unchecked: 'border-dashed border-slate-600 bg-white text-slate-800',
};

/**
 * Verdict class in words, never colour alone (spec §11); stays in the 375px primary row. The visible
 * word is the accessible text, with a spoken-only prefix naming what it is.
 */
export function ClassBadge({ cls }: { cls: VerdictClass | 'unchecked' }) {
  return (
    <span data-testid="class-badge" className={`inline-block rounded border px-1 text-xs ${STYLE[cls]}`}>
      <span className="sr-only">{COPY.classSpoken} </span>
      {COPY.classLabel[cls]}
    </span>
  );
}
