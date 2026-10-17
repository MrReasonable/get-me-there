import { COPY } from '../../copy.js';
import type { Coverage } from './marker.js';

/**
 * The day's visible, non-colour coverage cue (plan decision 38): "S/M searched" at 11 px beside a solid swatch when the
 * whole day was searched and a striped one when part was not, so thin coverage is visible without reading counts.
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
      <span aria-hidden="true" className={`cov-swatch ${full ? 'cov-full' : 'cov-partial'}`} />
      {C.searchedFraction(coverage.searched, coverage.total)}
    </span>
  );
}
