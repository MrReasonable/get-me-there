import { COPY } from '../../copy.js';
import type { Coverage } from './marker.js';

/**
 * A priced day's visible, non-colour coverage cue (plan decision 38, ruling 4 of decision 67): the buckets that apply,
 * "3 priced, 9 no cached data", at 11 px, with a striped swatch when part of the day was not searched. The "searched"
 * umbrella appears only in View D beside its breakdown (spec §3, §6.6), so a day of cached misses never reads covered.
 */
export function CoverageCue({ coverage }: { coverage: Coverage }) {
  const C = COPY.calendarView;
  if (coverage.kind === 'none') return null;
  if (coverage.kind !== 'fraction') {
    return (
      <span data-testid="coverage-cue" className="block text-[11px] italic">
        {C.countsInconsistent}
      </span>
    );
  }
  const full = coverage.searched === coverage.total;
  return (
    <span
      data-testid="coverage-cue"
      data-coverage={full ? 'full' : 'partial'}
      className="flex items-center gap-1 text-[11px]"
    >
      {full ? null : <span aria-hidden="true" className="cov-swatch cov-partial" />}
      {C.bucketBreakdown(coverage.buckets)}
    </span>
  );
}
