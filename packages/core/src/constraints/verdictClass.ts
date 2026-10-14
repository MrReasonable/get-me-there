import type { ConstraintName, VerdictClass, Verdicts } from '../types/itinerary.js';
import { CONSTRAINT_NAMES } from './labels.js';

/**
 * Spec §3, §6.2: `failed` iff any verdict is `fail`; `verified` iff every verdict is `pass`;
 * otherwise `partially-verified`. The word "verified" is reserved for this class.
 * `evaluateConstraints` always judges `cabin`, so verdicts without it were never evaluated (a
 * calendar row's `{}`, for instance); classing them would call unchecked data verified, so this
 * throws RangeError instead (review prov-001).
 */
export function verdictClass(v: Verdicts): VerdictClass {
  if (v.cabin === undefined) throw new RangeError('verdicts not evaluated: cabin missing');
  const values = CONSTRAINT_NAMES.flatMap((name) => {
    const x = v[name];
    return x === undefined ? [] : [x];
  });
  if (values.includes('fail')) return 'failed';
  return values.every((x) => x === 'pass') ? 'verified' : 'partially-verified';
}

/** The constraints judged `unverified`, in `CONSTRAINT_NAMES` order; rows and firings list these. */
export function unverifiedNames(v: Verdicts): ConstraintName[] {
  return CONSTRAINT_NAMES.filter((name) => v[name] === 'unverified');
}
