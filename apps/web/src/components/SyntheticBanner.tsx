import { COPY } from '../copy.js';

/**
 * Spec §5.5: red and data-driven. App shows it when /providers says `synthetic`; a view also shows
 * it when any price it received has the synthetic source kind, whatever /providers said.
 */
export function SyntheticBanner() {
  return (
    <div role="alert" className="alarm px-[var(--gutter)] py-2">
      {COPY.syntheticBanner}
    </div>
  );
}
